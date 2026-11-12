# Case study: analytics that stay exact on an eventually consistent edge

## The problem

A short-link service looks trivial until click counts matter. Redirects must be fast and
available; analytics must not inflate under retries or abuse; and a link can expire or hit a
click cap mid-burst. The naive design — `SELECT` the link, redirect, insert a click — couples
the hot path to analytics, races on the click cap, and double-counts when a queue retries.

EdgeLink separates those concerns with three rules:

1. **The redirect path never awaits analytics.**
2. **D1 is the authority for caps and expiry, even on a cache hit.**
3. **Rollups are recomputed from raw events, not incremented.**

## What the code does

**Redirect.** A per-IP token bucket in a Durable Object rejects bursts before any lookup. The
link is read from a versioned KV cache; on a miss, D1 is read and the cache is warmed in
`waitUntil`. Regardless of cache state, a single statement performs the eligibility check and
the click increment:

```sql
UPDATE links SET clicks = clicks + 1
WHERE slug = ? AND active = 1
  AND (expires_at IS NULL OR expires_at > ?)
  AND (max_clicks IS NULL OR clicks < max_clicks)
RETURNING id, target;
```

No row means 410. Ten concurrent requests against `max_clicks = 5` produce exactly five
redirects; this is a test, not a hope.

**Click capture.** After the claim, the Worker builds an event with a UUID, hashed IP,
country, referrer host, device class, and bot flag, then sends it to a queue inside
`ctx.waitUntil`. A queue failure is logged; the redirect still resolves.

**Consumer.** Events are validated, chunked 50 per D1 batch, and inserted with
`INSERT OR IGNORE` keyed on the UUID. Replaying 100 messages produces `inserted: 0,
duplicates: 100` and the totals do not move.

**Rollups.** Every hour a cron recomputes the previous bucket with delete+insert inside a D1
transaction, including referrer and device dimension tables. Rerunning is a no-op; a late
event is fixed by re-running the bucket or calling the backfill endpoint.

**Privacy.** `ip_hash = HMAC-SHA256(IP_HASH_SALT, ip)`. Raw IPs are never stored or logged.
Bots are counted separately and excluded from uniques but are still served the redirect, so
link previews work.

## The honest part: what the cache buys

The plan asks for a cache and also says the cap decision must hit D1 atomically. Those pull in
opposite directions. The resolution is to cache the **lookup**, not the **write**. Warm requests
skip one D1 read but still pay one D1 write (the counter). Local Miniflare numbers:

| Mode           | p50    | p95    | Cache hit rate |
| -------------- | ------ | ------ | -------------- |
| Cold (KV miss) | 429 ms | 475 ms | 0%             |
| Warm probe     | 6.7 ms | 9.9 ms | 100%           |

These are development-laptop numbers, not edge numbers. They show the shape: the cold path is
dominated by D1 writes queueing under concurrency; the warm path is bounded by the atomic
write. A deployed Worker fans out across isolates and would look different.

## Tradeoffs accepted

- **Eventual analytics.** Queue lag plus hourly rollups means the current hour can be empty.
  Backfill repairs it. The dashboard says so.
- **Eventual target propagation in other regions.** Versioned keys make local updates instant;
  remote KV replicas can briefly serve the old pointer. Expiry/cap cannot be bypassed because
  D1 re-checks them.
- **Queues require Workers Paid.** The README states the $5/month floor rather than cutting the
  queue, because the queue is the design.
- **Fail-open rate limiting.** A DO outage means throttling is lost, not redirects. This is
  documented and logged.

## What I would do next

1. Replace the static bot list with Cloudflare's verified-bot data where available.
2. Move rate limiting to Cloudflare's native rules if DO cost/latency shows up.
3. Add a cross-hour unique-visitor sketch (HLL) instead of summing hourly uniques.
4. Add password entry with a signed, short-lived cookie.
5. Publish deployed latency and cost numbers once an account is connected.
