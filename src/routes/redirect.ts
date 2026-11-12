import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types";
import { claimRedirect, getLinkBySlug } from "../db/queries";
import {
  isNegativeCached,
  markMissing,
  readCachedLink,
  toCachedLink,
  warmLink,
  type CachedLink,
} from "../lib/cache";
import { buildClickEvent } from "../lib/click";
import { getClientIp, hashIp } from "../lib/ip";
import type { RateLimitResult } from "../durable/rate-limiter";

const redirect = new Hono<{ Bindings: Env }>();

interface RateLimiterStub {
  check(nowMs?: number): Promise<RateLimitResult>;
}

/**
 * Per-IP token bucket. Fail-open: if the Durable Object is unavailable, the
 * redirect still works and the failure is logged. A rate-limited request is
 * rejected before any lookup or click counting.
 */
redirect.use("/:slug", async (c, next) => {
  try {
    const ipHash = await hashIp(getClientIp(c.req.raw), c.env.IP_HASH_SALT);
    const stub = c.env.RATE_LIMITER.get(
      c.env.RATE_LIMITER.idFromName(ipHash),
    ) as unknown as RateLimiterStub;
    const result = await stub.check(Date.now());
    if (!result.allowed) {
      return c.body(null, 429, {
        "Retry-After": String(result.retryAfter),
        "X-RateLimit-Limit": c.env.RATE_LIMIT_PER_MIN ?? "60",
        "X-RateLimit-Remaining": "0",
        "Cache-Control": "no-store",
        "X-Cache": "MISS",
      });
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "rate_limiter.fail_open", message: String(error) }));
  }
  await next();
});

type CacheState = "HIT" | "MISS" | "NEGATIVE";

interface Lookup {
  link: CachedLink | null;
  cache: CacheState;
}

/**
 * Read-through lookup. The cache only answers "does this slug exist and what
 * are its static attributes"; D1 remains the authority for the click counter,
 * so a stale cached `clicks` can never authorize a redirect past the cap.
 */
interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

async function lookupLink(env: Env, slug: string, ctx: WaitUntilContext): Promise<Lookup> {
  const cached = await readCachedLink(env.LINKS_KV, slug);
  if (cached) return { link: cached, cache: "HIT" };

  if (await isNegativeCached(env.LINKS_KV, slug)) {
    return { link: null, cache: "NEGATIVE" };
  }

  const row = await getLinkBySlug(env.DB, slug);
  if (!row) {
    ctx.waitUntil(markMissing(env.LINKS_KV, slug));
    return { link: null, cache: "MISS" };
  }

  ctx.waitUntil(warmLink(env.LINKS_KV, row));
  return { link: toCachedLink(row), cache: "MISS" };
}

function statusResponse(
  c: Context<{ Bindings: Env }>,
  status: 401 | 404 | 410,
  cache: CacheState,
  extraHeaders: Record<string, string> = {},
): Response {
  return c.body(null, status, {
    "Cache-Control": "no-store",
    "X-Cache": cache,
    ...extraHeaders,
  });
}

redirect.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const now = Math.floor(Date.now() / 1000);
  const { link, cache } = await lookupLink(c.env, slug, c.executionCtx);

  if (!link) {
    return statusResponse(c, 404, cache);
  }
  if (link.active !== 1) {
    return statusResponse(c, 410, cache);
  }
  if (link.expires_at !== null && link.expires_at <= now) {
    return statusResponse(c, 410, cache);
  }
  if (link.max_clicks !== null && link.clicks >= link.max_clicks) {
    return statusResponse(c, 410, cache);
  }
  if (link.password) {
    return statusResponse(c, 401, cache, {
      "WWW-Authenticate": 'Password realm="edgelink"',
    });
  }

  // Always hit D1: this UPDATE is both the click counter and the atomic
  // authority for active/expiry/cap. A stale cache cannot leak a redirect.
  const claimed = await claimRedirect(c.env.DB, slug, now);
  if (!claimed) {
    return statusResponse(c, 410, cache);
  }

  // Analytics never blocks the redirect. A queue failure is logged, not
  // surfaced: the link still resolves and the cap counter stays authoritative.
  const request = c.req.raw;
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const event = await buildClickEvent(request, claimed.id, c.env);
        await c.env.CLICKS.send(event);
      } catch (error) {
        console.error(JSON.stringify({ event: "queue.send_failed", message: String(error) }));
      }
    })(),
  );

  return c.body(null, 302, {
    Location: claimed.target,
    "Cache-Control": "no-store",
    "X-Cache": cache,
  });
});

export default redirect;
