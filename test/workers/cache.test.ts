import { beforeEach, describe, expect, it } from "vitest";
import {
  createLinkViaApi,
  fetchWorker,
  getCachedVersion,
  getLinkState,
  resetDb,
  testEnv,
  waitFor,
} from "../helpers";

beforeEach(resetDb);

async function createLink(body: Record<string, unknown>): Promise<void> {
  const res = await createLinkViaApi(body);
  expect(res.status).toBe(201);
}

async function warm(slug: string): Promise<void> {
  await waitFor(async () => (await getCachedVersion(slug)) !== null);
}

describe("KV read-through cache", () => {
  it("serves the first request cold and the next warm", async () => {
    await createLink({ slug: "warm-me", target: "https://example.com" });

    const cold = await fetchWorker("/warm-me");
    expect(cold.status).toBe(302);
    expect(cold.headers.get("x-cache")).toBe("MISS");

    await warm("warm-me");

    const warmRes = await fetchWorker("/warm-me");
    expect(warmRes.status).toBe(302);
    expect(warmRes.headers.get("x-cache")).toBe("HIT");
    expect(warmRes.headers.get("location")).toBe("https://example.com");
  });

  it("shows a PATCH on the very next request via version bump", async () => {
    await createLink({ slug: "patch-cache", target: "https://example.com/a" });
    expect((await fetchWorker("/patch-cache")).status).toBe(302);
    await warm("patch-cache");
    expect(await getCachedVersion("patch-cache")).toBe(1);

    const patch = await fetchWorker("/v1/links/patch-cache", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer test-admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target: "https://example.com/b" }),
    });
    expect(patch.status).toBe(200);

    expect(await getCachedVersion("patch-cache")).toBe(2);
    expect(await testEnv.LINKS_KV.get("link:v2:patch-cache")).not.toBeNull();

    const next = await fetchWorker("/patch-cache");
    expect(next.status).toBe(302);
    expect(next.headers.get("location")).toBe("https://example.com/b");
    expect(next.headers.get("x-cache")).toBe("HIT");
  });

  it("never caches an expired link as a successful redirect", async () => {
    await createLink({
      slug: "cached-expired",
      target: "https://example.com",
      expires_at: Math.floor(Date.now() / 1000) - 5,
    });
    expect((await fetchWorker("/cached-expired")).status).toBe(410);
    await warm("cached-expired");
    const again = await fetchWorker("/cached-expired");
    expect(again.status).toBe(410);
    expect(again.headers.get("x-cache")).toBe("HIT");
    expect((await getLinkState("cached-expired"))?.clicks).toBe(0);
  });

  it("does not serve a capped link as a successful redirect", async () => {
    await createLink({ slug: "cached-cap", target: "https://example.com", max_clicks: 1 });
    expect((await fetchWorker("/cached-cap")).status).toBe(302);
    await warm("cached-cap");
    const capped = await fetchWorker("/cached-cap");
    expect(capped.status).toBe(410);
    expect((await getLinkState("cached-cap"))?.clicks).toBe(1);
  });

  it("invalidates the cache on delete", async () => {
    await createLink({ slug: "cached-delete", target: "https://example.com" });
    expect((await fetchWorker("/cached-delete")).status).toBe(302);
    await warm("cached-delete");

    const del = await fetchWorker("/v1/links/cached-delete", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-admin-token" },
    });
    expect(del.status).toBe(204);

    const next = await fetchWorker("/cached-delete");
    expect(next.status).toBe(410);
  });
});

describe("negative cache", () => {
  it("caches 404s but a create clears the negative entry", async () => {
    const miss = await fetchWorker("/brand-new");
    expect(miss.status).toBe(404);
    await waitFor(async () => (await testEnv.LINKS_KV.get("miss:brand-new")) !== null);

    await createLink({ slug: "brand-new", target: "https://example.com" });

    const hit = await fetchWorker("/brand-new");
    expect(hit.status).toBe(302);
  });

  it("returns the negative entry for up to 60 seconds", async () => {
    expect((await fetchWorker("/ghost")).status).toBe(404);
    await waitFor(async () => (await testEnv.LINKS_KV.get("miss:ghost")) !== null);

    await testEnv.DB.prepare(
      "INSERT INTO links (id, slug, target, created_at) VALUES ('ghost-id', 'ghost', 'https://example.com', ?1)",
    )
      .bind(Math.floor(Date.now() / 1000))
      .run();

    const cachedMiss = await fetchWorker("/ghost");
    expect(cachedMiss.status).toBe(404);
    expect(cachedMiss.headers.get("x-cache")).toBe("NEGATIVE");
  });
});
