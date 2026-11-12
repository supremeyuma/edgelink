import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("health endpoints", () => {
  it("GET /healthz returns ok", async () => {
    const res = await SELF.fetch("http://edgelink.test/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /readyz checks D1 and KV", async () => {
    const res = await SELF.fetch("http://edgelink.test/readyz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready" });
  });

  it("GET /robots.txt disallows everything", async () => {
    const res = await SELF.fetch("http://edgelink.test/robots.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Disallow: /");
  });
});
