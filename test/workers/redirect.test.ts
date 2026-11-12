import { beforeEach, describe, expect, it } from "vitest";
import { createLinkViaApi, fetchWorker, getLinkState, resetDb } from "../helpers";

beforeEach(resetDb);

async function createLink(body: Record<string, unknown>): Promise<void> {
  const res = await createLinkViaApi(body);
  expect(res.status).toBe(201);
}

describe("GET /:slug", () => {
  it("redirects with 302 and cache headers", async () => {
    await createLink({ slug: "go-here", target: "https://example.com/a" });
    const res = await fetchWorker("/go-here", {
      headers: { "X-Request-Id": "req-123" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/a");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(res.headers.get("x-request-id")).toBe("req-123");
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await fetchWorker("/nope-nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-cache")).toBe("MISS");
  });

  it("returns 410 for an expired link, repeatedly", async () => {
    await createLink({
      slug: "expired",
      target: "https://example.com",
      expires_at: Math.floor(Date.now() / 1000) - 10,
    });
    expect((await fetchWorker("/expired")).status).toBe(410);
    expect((await fetchWorker("/expired")).status).toBe(410);
    const state = await getLinkState("expired");
    expect(state?.clicks).toBe(0);
  });

  it("returns 401 for a password-protected link", async () => {
    await createLink({
      slug: "locked",
      target: "https://example.com",
      password: "hunter2",
    });
    const res = await fetchWorker("/locked");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Password");
    const state = await getLinkState("locked");
    expect(state?.clicks).toBe(0);
  });

  it("never exceeds max_clicks under concurrent requests", async () => {
    await createLink({
      slug: "capped",
      target: "https://example.com",
      max_clicks: 5,
    });

    const responses = await Promise.all(Array.from({ length: 10 }, () => fetchWorker("/capped")));
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((status) => status === 302)).toHaveLength(5);
    expect(statuses.filter((status) => status === 410)).toHaveLength(5);

    const state = await getLinkState("capped");
    expect(state?.clicks).toBe(5);

    // Once capped, subsequent requests stay 410 and do not increment.
    expect((await fetchWorker("/capped")).status).toBe(410);
    expect((await getLinkState("capped"))?.clicks).toBe(5);
  });

  it("increments clicks on each successful redirect", async () => {
    await createLink({ slug: "count-me", target: "https://example.com" });
    await fetchWorker("/count-me");
    await fetchWorker("/count-me");
    expect((await getLinkState("count-me"))?.clicks).toBe(2);
  });

  it("does not treat a multi-segment path as a slug", async () => {
    const res = await fetchWorker("/a/b");
    expect(res.status).toBe(404);
  });
});
