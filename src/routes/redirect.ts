import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types";
import { claimRedirect, getLinkBySlug } from "../db/queries";

const redirect = new Hono<{ Bindings: Env }>();

function gone(c: Context<{ Bindings: Env }>): Response {
  return c.body(null, 410, { "Cache-Control": "no-store", "X-Cache": "MISS" });
}

redirect.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const now = Math.floor(Date.now() / 1000);
  const link = await getLinkBySlug(c.env.DB, slug);

  if (!link) {
    return c.body(null, 404, { "Cache-Control": "no-store", "X-Cache": "MISS" });
  }
  if (link.active !== 1) {
    return gone(c);
  }
  if (link.expires_at !== null && link.expires_at <= now) {
    return gone(c);
  }
  if (link.max_clicks !== null && link.clicks >= link.max_clicks) {
    return gone(c);
  }
  if (link.password_hash !== null) {
    return c.body(null, 401, {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Password realm="edgelink"',
      "X-Cache": "MISS",
    });
  }

  // D1 is the authority for the cap: this UPDATE is the click counter and the
  // eligibility decision in one atomic statement.
  const claimed = await claimRedirect(c.env.DB, slug, now);
  if (!claimed) {
    return gone(c);
  }

  return c.body(null, 302, {
    Location: claimed.target,
    "Cache-Control": "no-store",
    "X-Cache": "MISS",
  });
});

export default redirect;
