import { Hono } from "hono";
import type { ClickEvent, Env } from "./types";
import { RateLimiter } from "./durable/rate-limiter";
import healthRoutes from "./routes/health";
import linkRoutes from "./routes/links";
import redirectRoutes from "./routes/redirect";

export { RateLimiter };

type AppEnv = { Bindings: Env; Variables: { requestId: string } };

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  c.header("X-Content-Type-Options", "nosniff");
  await next();
});

app.route("/", healthRoutes);
app.route("/v1/links", linkRoutes);
app.route("/", redirectRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith("/v1/")) {
    return c.json({ error: "not found" }, 404);
  }
  return c.body(null, 404, { "Cache-Control": "no-store", "X-Cache": "MISS" });
});

app.onError((error, c) => {
  console.error("unhandled error", error);
  return c.json({ error: "internal error" }, 500);
});

export default {
  fetch: app.fetch,
  async queue(_batch: MessageBatch<ClickEvent>, _env: Env): Promise<void> {
    // Implemented in Phase G3.
  },
  async scheduled(_controller: ScheduledController, _env: Env): Promise<void> {
    // Implemented in Phase G3.
  },
};
