# Interview notes

## 60-second demo script

> "Redirects are served from a versioned KV cache, but the cap and expiry decision is always a
> single atomic D1 update, so a stale cache cannot over-deliver. Clicks go through a queue in
> `waitUntil`; the consumer dedupes on an event UUID, so queue redelivery doesn't inflate
> counts. An hourly cron recomputes rollups from raw events, which makes reruns and backfills
> idempotent, and the dashboard only reads rollups. Abuse is handled by a per-IP token bucket in
> a Durable Object that fails open, and IPs are HMAC-hashed with a rotated salt — raw addresses
> are never stored. Locally, warm p95 is ~10 ms and a 500-request burst produces 429s with
> `Retry-After` while another IP is unaffected."

## Data model

```text
links(id, slug UNIQUE, target, expires_at, max_clicks, clicks, password_hash,
      active, version, created_at)
click_events(id PK, link_id, ts, country, referrer_host, device, ip_hash, is_bot)
rollups(link_id, bucket_hour, clicks, uniques, bots) PK(link_id, bucket_hour)
referrer_rollups(link_id, bucket_hour, referrer_host, clicks)
device_rollups(link_id, bucket_hour, device, clicks)
```

`links.clicks` is the cap authority (one atomic UPDATE). `click_events` is the raw analytics
ledger, pruned at 30 days. Rollups are derived and kept 400 days.

## Consistency model

- **D1:** strongly consistent single-region SQLite; every redirect performs one write.
- **KV:** eventually consistent (up to ~60 s across locations, no CAS). We version keys and keep
  D1 as the authority for anything correctness-critical.
- **Queues:** at-least-once; idempotency comes from the event UUID + `INSERT OR IGNORE`.
- **Durable Objects:** single-threaded per object; storage transactions make the token bucket
  linearizable for that IP.
- **Cron:** at-least-once-ish scheduling; rollups are recomputed, so a missed or repeated run
  is safe.

## KV limits worth knowing

- Minimum `expirationTtl` is 60 seconds (this is why the negative cache is 60 s, not the
  plan's 30 s).
- No compare-and-swap; concurrent writers last-write-wins.
- Per-key value limit 25 MiB, metadata 1024 bytes; list operations are eventually consistent.
- Writes are billed and limited per day on the free tier. Reads are cheap but not free.
- Replication delay is the reason a "just put the link in KV" design is not sufficient for caps.

## Queue idempotency

Producer: `id = crypto.randomUUID()` at the edge. Consumer: `INSERT OR IGNORE` on the primary
key, chunk 50 statements per D1 batch, ack the chunk on success, retry the chunk on transient
failure. Test: replay 100 of 1,000 messages → `inserted: 0, duplicates: 100`, totals unchanged.

## Rollup exactness

`DELETE` the bucket then `INSERT ... SELECT` from raw events in one D1 batch (transaction).
`uniques = COUNT(DISTINCT CASE WHEN is_bot = 0 THEN ip_hash END)`, so bots are excluded.
Re-running produces byte-identical rows. A late event is corrected by re-running the bucket
(cron or `POST /v1/admin/backfill`). Analytics sums hourly uniques; that is an approximation
across hours, stated in the API docs.

## Cost math (1M warm redirects/month)

- Workers requests: 1M (10M included in $5 plan), ~$0.30 marginal.
- KV: 2M reads (~$1.00), ~20k writes (~$0.10).
- D1: 1M row writes (within 50M included) → ~$0–$1.
- Queues: 2M operations, 1M included → ~$0.40.
- DO: 1M requests → ~$0.15.
- **≈ $1.50–$3.35 marginal + $5 plan minimum.** Cold cache adds ~$10 of KV writes and D1 reads.

## Three failure modes to discuss

1. **KV stale target in another region** — cap/expiry still enforced by D1; target propagation is
   bounded by TTL/pointer write. Mitigation: versioned pointer + short TTL.
2. **Queue lag / send failure** — analytics lags or misses a click; caps are unaffected because
   counting is inline. Mitigation: waitUntil send with logging, backfill, daily reconciliation.
3. **D1 write bottleneck / DO hot key** — one hot link or one abusive IP. Mitigation: single
   short UPDATE, queue for fan-out, per-IP DO, fail-open, native rate limiting later.

## Questions to ask back

- What is the read/write ratio and the p95 target for redirects?
- Is eventual analytics acceptable, or is billing-grade exactness required?
- Which regions matter, and is a single-region D1 acceptable?
- Who owns abuse response: app-level throttling or a WAF?
