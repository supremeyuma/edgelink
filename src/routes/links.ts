import { Hono } from "hono";
import type { Env } from "../types";
import { isAuthorized } from "../lib/auth";
import { generateSlug, isValidSlug, isValidTarget, SLUG_PATTERN } from "../lib/slugs";
import { isBlockedTarget } from "../lib/target-blocklist";
import { hashPassword } from "../lib/password";
import {
  createLink,
  getLinkBySlug,
  listLinks,
  slugExists,
  softDeleteLink,
  updateLink,
} from "../db/queries";
import { toLinkDto } from "../db/types";
import { clearNegative, writeThroughLink } from "../lib/cache";
import analyticsRoutes from "./analytics";

const links = new Hono<{ Bindings: Env }>();

links.use("*", async (c, next) => {
  if (!isAuthorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

links.route("/", analyticsRoutes);

interface CreateBody {
  target: string;
  slug?: string;
  expires_at?: number | null;
  max_clicks?: number | null;
  password?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCreateBody(
  body: unknown,
): { ok: true; value: CreateBody } | { ok: false; error: string } {
  if (!isPlainObject(body)) return { ok: false, error: "body must be a JSON object" };
  const { target, slug, expires_at, max_clicks, password } = body;

  if (typeof target !== "string" || !isValidTarget(target)) {
    return { ok: false, error: "target must be an absolute http(s) URL" };
  }
  if (isBlockedTarget(target)) {
    return { ok: false, error: "target domain is blocked" };
  }
  if (slug !== undefined) {
    if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
      return { ok: false, error: "slug must match ^[a-zA-Z0-9_-]{3,32}$" };
    }
    if (!isValidSlug(slug)) return { ok: false, error: "slug is reserved" };
  }
  if (expires_at !== undefined && expires_at !== null) {
    if (!Number.isInteger(expires_at) || (expires_at as number) <= 0) {
      return { ok: false, error: "expires_at must be a positive unix timestamp in seconds" };
    }
  }
  if (max_clicks !== undefined && max_clicks !== null) {
    if (!Number.isInteger(max_clicks) || (max_clicks as number) <= 0) {
      return { ok: false, error: "max_clicks must be a positive integer" };
    }
  }
  if (password !== undefined) {
    if (typeof password !== "string" || password.length === 0 || password.length > 128) {
      return { ok: false, error: "password must be a string of 1-128 characters" };
    }
  }

  return {
    ok: true,
    value: {
      target,
      ...(slug !== undefined ? { slug } : {}),
      ...(expires_at !== undefined ? { expires_at: expires_at as number | null } : {}),
      ...(max_clicks !== undefined ? { max_clicks: max_clicks as number | null } : {}),
      ...(password !== undefined ? { password } : {}),
    },
  };
}

function parseUpdateBody(
  body: unknown,
):
  | { ok: true; value: { target?: string; expires_at?: number | null; active?: boolean } }
  | { ok: false; error: string } {
  if (!isPlainObject(body)) return { ok: false, error: "body must be a JSON object" };
  const { target, expires_at, active } = body;
  const value: { target?: string; expires_at?: number | null; active?: boolean } = {};

  if (target !== undefined) {
    if (typeof target !== "string" || !isValidTarget(target)) {
      return { ok: false, error: "target must be an absolute http(s) URL" };
    }
    if (isBlockedTarget(target)) {
      return { ok: false, error: "target domain is blocked" };
    }
    value.target = target;
  }
  if (expires_at !== undefined) {
    if (expires_at !== null && (!Number.isInteger(expires_at) || (expires_at as number) <= 0)) {
      return { ok: false, error: "expires_at must be a positive unix timestamp or null" };
    }
    value.expires_at = expires_at as number | null;
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") return { ok: false, error: "active must be a boolean" };
    value.active = active;
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, error: "no updatable fields provided" };
  }
  return { ok: true, value };
}

links.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const parsed = parseCreateBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const input = parsed.value;
  const now = Math.floor(Date.now() / 1000);

  let slug = input.slug ?? generateSlug();
  if (input.slug === undefined) {
    for (let attempt = 0; attempt < 5 && (await slugExists(c.env.DB, slug)); attempt++) {
      slug = generateSlug();
    }
  } else if (await slugExists(c.env.DB, slug)) {
    return c.json({ error: "slug already exists" }, 409);
  }

  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const row = await createLink(c.env.DB, {
    id: crypto.randomUUID(),
    slug,
    target: input.target,
    expiresAt: input.expires_at ?? null,
    maxClicks: input.max_clicks ?? null,
    passwordHash,
    createdAt: now,
  });
  // A slug may have been negative-cached before it existed.
  await clearNegative(c.env.LINKS_KV, row.slug);

  const url = new URL(c.req.url);
  return c.json(
    {
      slug: row.slug,
      short_url: `${url.origin}/${row.slug}`,
      link: toLinkDto(row),
    },
    201,
  );
});

links.get("/", async (c) => {
  const rows = await listLinks(c.env.DB);
  return c.json({ links: rows.map(toLinkDto) });
});

links.get("/:slug", async (c) => {
  const row = await getLinkBySlug(c.env.DB, c.req.param("slug"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ link: toLinkDto(row) });
});

links.patch("/:slug", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const parsed = parseUpdateBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const row = await updateLink(c.env.DB, c.req.param("slug"), parsed.value);
  if (!row) return c.json({ error: "not found" }, 404);
  await writeThroughLink(c.env.LINKS_KV, row);
  return c.json({ link: toLinkDto(row) });
});

links.delete("/:slug", async (c) => {
  const row = await softDeleteLink(c.env.DB, c.req.param("slug"));
  if (!row) return c.json({ error: "not found" }, 404);
  await writeThroughLink(c.env.LINKS_KV, row);
  return c.body(null, 204);
});

export default links;
