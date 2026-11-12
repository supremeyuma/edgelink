import { runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { RateLimiter } from "../../src/durable/rate-limiter";
import { createLinkViaApi, fetchWorker, getLinkState, resetDb, testEnv } from "../helpers";

beforeEach(resetDb);

async function burst(
  slug: string,
  ip: string,
  count: number,
  concurrency = 50,
): Promise<Response[]> {
  const responses: Response[] = [];
  for (let i = 0; i < count; i += concurrency) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(concurrency, count - i) }, () =>
        fetchWorker(`/${slug}`, {
          headers: {
            "CF-Connecting-IP": ip,
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0",
          },
        }),
      ),
    );
    responses.push(...batch);
  }
  return responses;
}

describe("rate limiting", () => {
  it("rejects a 500-request burst with 429 and Retry-After", async () => {
    await createLinkViaApi({ slug: "burst-target", target: "https://example.com" });

    const responses = await burst("burst-target", "198.51.100.201", 500);
    const allowed = responses.filter((res) => res.status === 302);
    const limited = responses.filter((res) => res.status === 429);

    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.length).toBeLessThan(100);
    expect(limited.length).toBeGreaterThan(400);
    for (const res of limited.slice(0, 5)) {
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }

    // Rejected requests are never counted as clicks.
    expect((await getLinkState("burst-target"))?.clicks).toBe(allowed.length);

    // A different IP has its own bucket and is unaffected.
    const other = await fetchWorker("/burst-target", {
      headers: {
        "CF-Connecting-IP": "198.51.100.202",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0",
      },
    });
    expect(other.status).toBe(302);
  });
});

describe("token bucket", () => {
  it("refills over time and persists state inside the DO", async () => {
    const id = testEnv.RATE_LIMITER.idFromName("refill-unit");
    const stub = testEnv.RATE_LIMITER.get(id);

    const outcome = await runInDurableObject(stub, async (instance: RateLimiter) => {
      const start = 1_000_000;
      const allowed: boolean[] = [];
      for (let i = 0; i < 30; i++) {
        allowed.push((await instance.check(start)).allowed);
      }
      const denied = await instance.check(start);
      const afterOneSecond = await instance.check(start + 1000);
      const immediateAgain = await instance.check(start + 1000);
      return { allowed, denied, afterOneSecond, immediateAgain };
    });

    expect(outcome.allowed.every(Boolean)).toBe(true);
    expect(outcome.denied.allowed).toBe(false);
    expect(outcome.denied.retryAfter).toBeGreaterThan(0);
    expect(outcome.afterOneSecond.allowed).toBe(true);
    expect(outcome.immediateAgain.allowed).toBe(false);
  });
});
