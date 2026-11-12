import { Hono } from "hono";
import type { Env } from "../types";
import { isAuthorized } from "../lib/auth";
import { runBackfill } from "../cron";

const admin = new Hono<{ Bindings: Env }>();

admin.use("*", async (c, next) => {
  if (!isAuthorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

/** Backfills N completed hours. Used by scripts/backfill.ts and the walkthrough. */
admin.post("/backfill", async (c) => {
  const requested = Number.parseInt(c.req.query("hours") ?? "24", 10);
  const hours = Number.isFinite(requested) ? Math.min(720, Math.max(1, requested)) : 24;
  const includeCurrent = c.req.query("include_current") === "1";
  const buckets = await runBackfill(c.env, hours, Math.floor(Date.now() / 1000), includeCurrent);
  return c.json({ ok: true, hours, include_current: includeCurrent, buckets });
});

export default admin;
