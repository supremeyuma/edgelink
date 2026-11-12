# Security and privacy notes

## Admin authentication

Every `/v1/*` route requires `Authorization: Bearer <ADMIN_TOKEN>`. The comparison is
constant-time (`src/lib/auth.ts`) so a wrong token cannot be discovered byte by byte. The token
comes from a Worker secret / `.dev.vars`, never from the repository. Missing or malformed
headers return `401`.

## IP hashing (no raw addresses)

`ip_hash = HMAC-SHA256(IP_HASH_SALT, client_ip)` (`src/lib/ip.ts`). Raw IPs are never written to
D1, KV, logs, or error messages, and are never emitted in a click event. Tests assert that the
raw address does not appear in a serialized event or stored row.

- **Salt rotation:** rotate `IP_HASH_SALT` monthly (or on suspected compromise). Hashes are
  stable within a rotation window, so unique counts remain meaningful inside a month; hashes
  from different salts cannot be correlated.
- **Uniqueness semantics:** `uniques` is the count of distinct non-bot hashes per hour. Summing
  hourly uniques can count one visitor once per hour. That is deliberate and cheaper than a
  cross-hour distinct set.
- **Local fallback:** without `CF-Connecting-IP` (Miniflare/tests), the client IP falls back to
  `X-Forwarded-For` and then `127.0.0.1`; this never reaches production data.

## Retention

| Data                                            | Window        | Action                                                        |
| ----------------------------------------------- | ------------- | ------------------------------------------------------------- |
| `click_events` (raw)                            | 30 days       | daily cron deletes older rows                                 |
| `rollups`, `referrer_rollups`, `device_rollups` | 400 days      | daily cron deletes older buckets                              |
| `links`                                         | until deleted | soft delete keeps history; `clicks` remains the cap authority |

`links.clicks` is intentionally not rewritten by reconciliation: after raw events are pruned it
is no longer equal to `COUNT(click_events)`. Mismatches are logged for an operator and never
auto-corrected. This is documented in `docs/failure-modes.md` when it lands.

## Rate limiting

One Durable Object per hashed IP implements a token bucket (`RATE_LIMIT_PER_MIN`, default 60;
`RATE_LIMIT_BURST`, default 30). State is persisted in DO storage inside a transaction, so a
restart does not reset an abusive client.

- A rejected request returns `429` with `Retry-After` seconds and `Cache-Control: no-store`.
- Rejected requests are rejected **before** lookup or click counting, so they cannot inflate
  analytics or consume a link's `max_clicks`.
- **Fail-open:** if the Durable Object errors, the redirect proceeds and the failure is logged
  as `rate_limiter.fail_open`. Availability of the short link is prioritized over throttling
  during an outage. The tradeoff is documented rather than hidden.
- A single abusive IP concentrates load on one DO (`idFromName(ipHash)`). Cloudflare's
  per-object throughput is the limit; see `docs/failure-modes.md`.

## Bot policy

`src/lib/bot.ts` uses a static user-agent marker list plus an optional small ASN list. Bots are
**served the redirect** (link previews and crawlers must work), counted in `bots`, and excluded
from `uniques`.

False-positive policy: a real user with an unusual agent is at worst undercounted as a unique
visitor; no request is blocked. Empty user agents are treated as bots. The ASN list is
intentionally small and optional (cut-order item if it causes false positives).

## Target and slug blocklists

- Slugs must match `^[a-zA-Z0-9_-]{3,32}$` and cannot be reserved words (`admin`, `api`, `v1`,
  `healthz`, `robots.txt`, …).
- Targets must be absolute `http(s)` URLs without embedded credentials.
- `src/lib/target-blocklist.json` is a static deny list loaded at bundle time; exact domains and
  subdomains are rejected. There is no reputation call on the redirect path.

## Passwords

`POST /v1/links` accepts an optional password, hashed with PBKDF2-SHA256, 100,000 iterations,
16-byte random salt (`pbkdf2$iterations$salt$hash`). `password_hash` is never returned by the
API. A password-protected link returns `401` with a `WWW-Authenticate` hint; password entry is
listed under "what I'd do next" rather than half-built.

## Logging and secrets

- Structured logs contain event names and counts only — no IPs, tokens, passwords, targets, or
  request bodies.
- `.dev.vars` and `.env*` are gitignored; `.env.example` contains placeholders only.
- CI requires no secrets: typecheck, lint, tests, and `wrangler deploy --dry-run` all run
  without credentials.

## Known gaps

- Rate limiting and click capture are best-effort around Cloudflare outages (fail-open).
- There is no WAF or Cloudflare Access in front of the admin API; the bearer token is the only
  gate. Rotate it if leaked.
- Request IDs are accepted from clients for trace propagation and are not authenticated.
