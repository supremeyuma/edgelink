export interface ClickEvent {
  id: string;
  link_id: string;
  ts: number;
  country: string | null;
  referrer_host: string | null;
  device: string;
  ip_hash: string;
  is_bot: number;
}

export interface Env {
  DB: D1Database;
  LINKS_KV: KVNamespace;
  CLICKS: Queue<ClickEvent>;
  RATE_LIMITER: DurableObjectNamespace;
  ADMIN_TOKEN: string;
  IP_HASH_SALT: string;
  ENVIRONMENT?: string;
}
