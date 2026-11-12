import type { LinkRow } from "./types";

export interface CreateLinkInput {
  id: string;
  slug: string;
  target: string;
  ownerId?: string | null;
  expiresAt?: number | null;
  maxClicks?: number | null;
  passwordHash?: string | null;
  createdAt: number;
}

export async function createLink(db: D1Database, input: CreateLinkInput): Promise<LinkRow> {
  const row = await db
    .prepare(
      `INSERT INTO links
         (id, slug, target, owner_id, expires_at, max_clicks, password_hash, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       RETURNING *`,
    )
    .bind(
      input.id,
      input.slug,
      input.target,
      input.ownerId ?? null,
      input.expiresAt ?? null,
      input.maxClicks ?? null,
      input.passwordHash ?? null,
      input.createdAt,
    )
    .first<LinkRow>();
  if (!row) throw new Error("Failed to create link");
  return row;
}

export async function listLinks(db: D1Database): Promise<LinkRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM links ORDER BY created_at DESC")
    .all<LinkRow>();
  return results;
}

export async function getLinkBySlug(db: D1Database, slug: string): Promise<LinkRow | null> {
  return db.prepare("SELECT * FROM links WHERE slug = ?1").bind(slug).first<LinkRow>();
}

export interface UpdateLinkInput {
  target?: string;
  expiresAt?: number | null;
  active?: boolean;
}

/**
 * Applies a partial update and bumps `version`, which is what invalidates the
 * versioned KV key in Phase G2. Returns null when the slug does not exist.
 */
export async function updateLink(
  db: D1Database,
  slug: string,
  input: UpdateLinkInput,
): Promise<LinkRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.target !== undefined) {
    values.push(input.target);
    sets.push(`target = ?${values.length}`);
  }
  if (input.expiresAt !== undefined) {
    values.push(input.expiresAt);
    sets.push(`expires_at = ?${values.length}`);
  }
  if (input.active !== undefined) {
    values.push(input.active ? 1 : 0);
    sets.push(`active = ?${values.length}`);
  }
  sets.push("version = version + 1");
  values.push(slug);
  const sql = `UPDATE links SET ${sets.join(", ")} WHERE slug = ?${values.length} RETURNING *`;
  return db
    .prepare(sql)
    .bind(...values)
    .first<LinkRow>();
}

/** Soft delete: keep the row for analytics, disable redirects, bump version. */
export async function softDeleteLink(db: D1Database, slug: string): Promise<LinkRow | null> {
  return db
    .prepare(
      "UPDATE links SET active = 0, version = version + 1 WHERE slug = ?1 AND active = 1 RETURNING *",
    )
    .bind(slug)
    .first<LinkRow>();
}

export interface RedirectResult {
  id: string;
  target: string;
}

/**
 * Atomically increments the click counter only when the link is active,
 * unexpired, and below its cap. Returning null means the request must be
 * answered with 410 (expired, capped, or deleted between lookup and update).
 */
export async function claimRedirect(
  db: D1Database,
  slug: string,
  now: number,
): Promise<RedirectResult | null> {
  return db
    .prepare(
      `UPDATE links SET clicks = clicks + 1
       WHERE slug = ?1 AND active = 1
         AND (expires_at IS NULL OR expires_at > ?2)
         AND (max_clicks IS NULL OR clicks < max_clicks)
       RETURNING id, target`,
    )
    .bind(slug, now)
    .first<RedirectResult>();
}

export async function slugExists(db: D1Database, slug: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS found FROM links WHERE slug = ?1").bind(slug).first();
  return row !== null;
}
