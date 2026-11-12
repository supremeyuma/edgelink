/**
 * Privacy: raw IPs are never stored or logged. We keep a stable-within-salt
 * HMAC-SHA256 digest so unique counting works without retaining the address.
 */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Cloudflare sets CF-Connecting-IP at the edge. Local Miniflare and tests may
 * not, so fall back to a constant loopback marker rather than "unknown" (which
 * would collapse every local visitor into one hash).
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "127.0.0.1"
  );
}
