import blocklist from "./target-blocklist.json";

const BLOCKED_DOMAINS = new Set(Object.keys(blocklist).map((domain) => domain.toLowerCase()));

/**
 * Static target deny list. Loaded from a JSON module at bundle time, so the
 * redirect path never makes an external reputation call.
 */
export function isBlockedTarget(target: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(target).hostname.toLowerCase();
  } catch {
    return true;
  }
  for (const domain of BLOCKED_DOMAINS) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return true;
  }
  return false;
}
