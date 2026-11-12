import { Hono } from "hono";
import type { Env } from "../types";
import { getAnalytics } from "../db/analytics";
import { getLinkBySlug } from "../db/queries";

const analytics = new Hono<{ Bindings: Env }>();

const MAX_DAYS = 400;

analytics.get("/:slug/analytics", async (c) => {
  const slug = c.req.param("slug");
  const link = await getLinkBySlug(c.env.DB, slug);
  if (!link) return c.json({ error: "not found" }, 404);

  const requested = Number.parseInt(c.req.query("days") ?? "30", 10);
  const days = Number.isFinite(requested) ? Math.min(MAX_DAYS, Math.max(1, requested)) : 30;

  const now = Math.floor(Date.now() / 1000);
  const from = now - days * 86_400;
  const result = await getAnalytics(c.env.DB, link.id, from, now + 1);

  return c.json({
    slug,
    days,
    from,
    to: now,
    ...result,
  });
});

export default analytics;
