import type { ClickEvent, Env } from "../types";
import { isBot } from "./bot";
import { classifyDevice } from "./device";
import { getClientIp, hashIp } from "./ip";

interface RequestCf {
  country?: string;
  asn?: number;
}

function referrerHost(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).hostname || null;
  } catch {
    return null;
  }
}

export async function buildClickEvent(
  request: Request,
  linkId: string,
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<ClickEvent> {
  const userAgent = request.headers.get("User-Agent");
  const cf = (request as Request & { cf?: RequestCf }).cf;
  const ip = getClientIp(request);
  return {
    id: crypto.randomUUID(),
    link_id: linkId,
    ts: nowSeconds,
    country: cf?.country ?? null,
    referrer_host: referrerHost(request.headers.get("Referer")),
    device: classifyDevice(userAgent),
    ip_hash: await hashIp(ip, env.IP_HASH_SALT),
    is_bot: isBot(userAgent, cf?.asn) ? 1 : 0,
  };
}
