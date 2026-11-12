import { beforeEach, describe, expect, it } from "vitest";
import { adminHeaders, createLinkViaApi, fetchWorker, getLinkState, resetDb } from "../helpers";

beforeEach(resetDb);

async function createSlug(slug: string): Promise<void> {
  const res = await createLinkViaApi({ slug, target: "https://example.com/a" });
  expect(res.status).toBe(201);
}

describe("admin auth", () => {
  it("rejects missing and wrong tokens with 401", async () => {
    const missing = await fetchWorker("/v1/links");
    expect(missing.status).toBe(401);
    const wrong = await fetchWorker("/v1/links", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(wrong.status).toBe(401);
    const good = await fetchWorker("/v1/links", { headers: adminHeaders });
    expect(good.status).toBe(200);
  });
});

describe("POST /v1/links", () => {
  it("creates a link with a generated slug", async () => {
    const res = await createLinkViaApi({ target: "https://example.com/a" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      slug: string;
      short_url: string;
      link: { target: string; version: number; has_password: boolean };
    };
    expect(body.slug).toMatch(/^[a-z0-9]{8}$/);
    expect(body.short_url).toBe(`http://edgelink.test/${body.slug}`);
    expect(body.link.target).toBe("https://example.com/a");
    expect(body.link.version).toBe(1);
    expect(body.link.has_password).toBe(false);
  });

  it("accepts a custom slug", async () => {
    const res = await createLinkViaApi({ slug: "custom-slug", target: "https://example.com" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { slug: string }).slug).toBe("custom-slug");
  });

  it("rejects invalid targets", async () => {
    for (const target of ["ftp://example.com", "not-a-url", "javascript:alert(1)"]) {
      const res = await createLinkViaApi({ target });
      expect(res.status).toBe(400);
    }
  });

  it("rejects invalid and reserved slugs", async () => {
    for (const slug of ["ab", "has space", "x".repeat(33), "admin", "API", "robots.txt"]) {
      const res = await createLinkViaApi({ slug, target: "https://example.com" });
      expect(res.status).toBe(400);
    }
  });

  it("rejects duplicate slugs with 409", async () => {
    await createSlug("dupe");
    const res = await createLinkViaApi({ slug: "dupe", target: "https://example.org" });
    expect(res.status).toBe(409);
  });

  it("never echoes password_hash", async () => {
    const res = await createLinkViaApi({
      slug: "secret-link",
      target: "https://example.com",
      password: "hunter2",
    });
    expect(res.status).toBe(201);
    const raw = await res.text();
    expect(raw).not.toContain("password_hash");
    expect(raw).not.toContain("hunter2");
    expect((JSON.parse(raw) as { link: { has_password: boolean } }).link.has_password).toBe(true);

    const detail = await fetchWorker("/v1/links/secret-link", { headers: adminHeaders });
    const detailRaw = await detail.text();
    expect(detailRaw).not.toContain("password_hash");
    expect(detailRaw).not.toContain("hunter2");
  });
});

describe("GET /v1/links", () => {
  it("lists links", async () => {
    await createSlug("list-one");
    await createSlug("list-two");
    const res = await fetchWorker("/v1/links", { headers: adminHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: Array<{ slug: string }> };
    expect(body.links.map((link) => link.slug).sort()).toEqual(["list-one", "list-two"]);
  });

  it("returns 404 for unknown detail", async () => {
    const res = await fetchWorker("/v1/links/missing", { headers: adminHeaders });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /v1/links/:slug", () => {
  it("updates target and bumps version", async () => {
    await createSlug("patch-me");
    const before = await getLinkState("patch-me");
    const res = await fetchWorker("/v1/links/patch-me", {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ target: "https://example.com/b" }),
    });
    expect(res.status).toBe(200);
    const after = await getLinkState("patch-me");
    expect(after?.target).toBe("https://example.com/b");
    expect(after?.version).toBe((before?.version ?? 0) + 1);
  });

  it("rejects invalid patch bodies", async () => {
    await createSlug("bad-patch");
    const cases = [{ target: "nope" }, { active: "yes" }, { expires_at: -5 }, {}];
    for (const body of cases) {
      const res = await fetchWorker("/v1/links/bad-patch", {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it("returns 404 when the slug is missing", async () => {
    const res = await fetchWorker("/v1/links/nope", {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /v1/links/:slug", () => {
  it("soft deletes and stops redirecting", async () => {
    await createSlug("delete-me");
    const res = await fetchWorker("/v1/links/delete-me", {
      method: "DELETE",
      headers: adminHeaders,
    });
    expect(res.status).toBe(204);
    const state = await getLinkState("delete-me");
    expect(state?.active).toBe(false);
    const redirect = await fetchWorker("/delete-me");
    expect(redirect.status).toBe(410);
    const again = await fetchWorker("/v1/links/delete-me", {
      method: "DELETE",
      headers: adminHeaders,
    });
    expect(again.status).toBe(404);
  });
});

describe("unknown API routes", () => {
  it("returns JSON 404", async () => {
    const res = await fetchWorker("/v1/nope", { headers: adminHeaders });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
