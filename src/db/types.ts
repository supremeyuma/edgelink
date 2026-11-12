export interface LinkRow {
  id: string;
  slug: string;
  target: string;
  owner_id: string | null;
  expires_at: number | null;
  max_clicks: number | null;
  clicks: number;
  password_hash: string | null;
  active: number;
  version: number;
  created_at: number;
}

/** Public representation of a link. Never includes `password_hash`. */
export interface LinkDto {
  id: string;
  slug: string;
  target: string;
  owner_id: string | null;
  expires_at: number | null;
  max_clicks: number | null;
  clicks: number;
  has_password: boolean;
  active: boolean;
  version: number;
  created_at: number;
}

export function toLinkDto(row: LinkRow): LinkDto {
  return {
    id: row.id,
    slug: row.slug,
    target: row.target,
    owner_id: row.owner_id,
    expires_at: row.expires_at,
    max_clicks: row.max_clicks,
    clicks: row.clicks,
    has_password: row.password_hash !== null,
    active: row.active === 1,
    version: row.version,
    created_at: row.created_at,
  };
}
