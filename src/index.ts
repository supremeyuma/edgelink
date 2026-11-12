import { Hono } from "hono";
import type { ClickEvent, Env } from "./types";
import { RateLimiter } from "./durable/rate-limiter";

export { RateLimiter };

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.get("/readyz", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1").first();
    await c.env.LINKS_KV.get("healthz");
    return c.json({ status: "ready" });
  } catch (error) {
    console.error("readiness check failed", error);
    return c.json({ status: "unavailable" }, 503);
  }
});

app.get("/robots.txt", (c) =>
  c.text("User-agent: *\nDisallow: /\n", 200, { "Content-Type": "text/plain" }),
);

export default {
  fetch: app.fetch,
  async queue(_batch: MessageBatch<ClickEvent>, _env: Env): Promise<void> {
    // Implemented in Phase G3.
  },
  async scheduled(_controller: ScheduledController, _env: Env): Promise<void> {
    // Implemented in Phase G3.
  },
};
