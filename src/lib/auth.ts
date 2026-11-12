/**
 * Constant-time string comparison for secrets (admin token, password verifiers).
 * JS string `===` short-circuits; this walks the maximum length and folds the
 * length difference into the result so timing does not reveal a prefix match.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** Validates `Authorization: Bearer <token>` against the configured token. */
export function isAuthorized(header: string | undefined | null, expected: string): boolean {
  if (!expected) return false;
  if (!header) return false;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme !== "Bearer" || rest.length !== 1) return false;
  return timingSafeEqual(rest[0] ?? "", expected);
}
