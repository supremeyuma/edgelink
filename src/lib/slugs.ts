export const SLUG_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;

/**
 * Reserved slugs that would collide with app routes or look official.
 * Compared case-insensitively because D1's default collation is binary but
 * users cannot tell `Admin` from `admin` in a URL.
 */
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "v1",
  "health",
  "healthz",
  "readyz",
  "robots.txt",
  "favicon.ico",
  "sitemap.xml",
  "login",
  "logout",
  "signup",
  "register",
  "dashboard",
  "static",
  "assets",
  "public",
  "well-known",
  "__scheduled",
  "__health",
]);

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug.toLowerCase());
}

export function isValidTarget(target: string): boolean {
  if (typeof target !== "string" || target.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (!url.hostname) return false;
  return true;
}

/** Generates a URL-safe slug that always satisfies the slug regex. */
export function generateSlug(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let slug = "";
  for (const byte of bytes) {
    slug += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
  }
  return slug;
}
