import { Hono } from "hono";
import type { Env } from "../types";

const health = new Hono<{ Bindings: Env }>();

health.get("/healthz", (c) => c.json({ status: "ok" }));

health.get("/readyz", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1").first();
    await c.env.LINKS_KV.get("healthz");
    return c.json({ status: "ready" });
  } catch (error) {
    console.error("readiness check failed", error);
    return c.json({ status: "unavailable" }, 503);
  }
});

health.get("/robots.txt", (c) =>
  c.text("User-agent: *\nDisallow: /\n", 200, { "Content-Type": "text/plain" }),
);

export default health;
