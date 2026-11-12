import { env, SELF } from "cloudflare:test";
import type { Env } from "../src/types";

export const testEnv = env as unknown as Env;

export const ADMIN_TOKEN = "test-admin-token";
export const adminHeaders = {
  Authorization: `Bearer ${ADMIN_TOKEN}`,
  "Content-Type": "application/json",
};

export async function resetDb(): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM rollups"),
    testEnv.DB.prepare("DELETE FROM click_events"),
    testEnv.DB.prepare("DELETE FROM links"),
  ]);
}

export interface LinkState {
  slug: string;
  target: string;
  clicks: number;
  version: number;
  max_clicks: number | null;
  expires_at: number | null;
  has_password: boolean;
  active: boolean;
}

export async function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`http://edgelink.test${path}`, { redirect: "manual", ...init });
}

export async function createLinkViaApi(body: Record<string, unknown>): Promise<Response> {
  return fetchWorker("/v1/links", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify(body),
  });
}

export async function getLinkState(slug: string): Promise<LinkState | null> {
  const row = await testEnv.DB.prepare(
    "SELECT slug, target, clicks, version, max_clicks, expires_at, active, password_hash FROM links WHERE slug = ?1",
  )
    .bind(slug)
    .first<{
      slug: string;
      target: string;
      clicks: number;
      version: number;
      max_clicks: number | null;
      expires_at: number | null;
      active: number;
      password_hash: string | null;
    }>();
  if (!row) return null;
  return {
    slug: row.slug,
    target: row.target,
    clicks: row.clicks,
    version: row.version,
    max_clicks: row.max_clicks,
    expires_at: row.expires_at,
    has_password: row.password_hash !== null,
    active: row.active === 1,
  };
}
