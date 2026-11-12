import type { LinkRow } from "../db/types";

export const LINK_TTL_SECONDS = 300;
// Cloudflare KV rejects expirationTtl values below 60 seconds. The plan's 30s
// negative window is therefore 60s in practice; documented in docs/roadmap.md.
export const NEGATIVE_TTL_SECONDS = 60;
const POINTER_TTL_SECONDS = 3600;

export interface CachedLink {
  id: string;
  slug: string;
  target: string;
  expires_at: number | null;
  max_clicks: number | null;
  clicks: number;
  active: number;
  password: boolean;
  version: number;
  created_at: number;
}

export function toCachedLink(row: LinkRow): CachedLink {
  return {
    id: row.id,
    slug: row.slug,
    target: row.target,
    expires_at: row.expires_at,
    max_clicks: row.max_clicks,
    clicks: row.clicks,
    active: row.active,
    password: row.password_hash !== null,
    version: row.version,
    created_at: row.created_at,
  };
}

export function pointerKey(slug: string): string {
  return `link:ptr:${slug}`;
}

export function linkKey(slug: string, version: number): string {
  return `link:v${version}:${slug}`;
}

export function negativeKey(slug: string): string {
  return `miss:${slug}`;
}

/**
 * Reads the current version pointer, then the versioned payload. The pointer
 * is what lets writes rotate to a new key without enumerating old ones.
 */
export async function readCachedLink(kv: KVNamespace, slug: string): Promise<CachedLink | null> {
  const pointer = await kv.get(pointerKey(slug));
  if (pointer === null) return null;
  const version = Number(pointer);
  if (!Number.isInteger(version) || version <= 0) return null;
  return kv.get<CachedLink>(linkKey(slug, version), "json");
}

export async function isNegativeCached(kv: KVNamespace, slug: string): Promise<boolean> {
  return (await kv.get(negativeKey(slug))) !== null;
}

export async function markMissing(kv: KVNamespace, slug: string): Promise<void> {
  await kv.put(negativeKey(slug), "1", { expirationTtl: NEGATIVE_TTL_SECONDS });
}

/** Warm the cache without blocking the redirect; safe to retry. */
export async function warmLink(kv: KVNamespace, row: LinkRow): Promise<void> {
  const cached = toCachedLink(row);
  await Promise.all([
    kv.put(pointerKey(row.slug), String(cached.version), {
      expirationTtl: POINTER_TTL_SECONDS,
    }),
    kv.put(linkKey(row.slug, cached.version), JSON.stringify(cached), {
      expirationTtl: LINK_TTL_SECONDS,
    }),
  ]);
}

/**
 * Synchronous write-through used by admin mutations. Admin latency does not
 * matter, and this makes the next redirect see the new version immediately.
 * Old version keys expire on their own TTL.
 */
export async function writeThroughLink(kv: KVNamespace, row: LinkRow): Promise<void> {
  await Promise.all([warmLink(kv, row), kv.delete(negativeKey(row.slug))]);
}

export async function clearNegative(kv: KVNamespace, slug: string): Promise<void> {
  await kv.delete(negativeKey(slug));
}
