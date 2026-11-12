# Failure modes

Each entry: what breaks, user impact, mitigation in this repo, and how to detect it.

## 1. Stale KV after an update

- **Symptom:** a PATCH changes the target, but a client in another location still gets the old
  destination for up to the KV propagation window.
- **Impact:** wrong destination briefly; never a bypass of expiry/cap because the atomic D1
  `UPDATE` re-checks eligibility.
- **Mitigation:** versioned keys (`link:v{n}:{slug}`) + pointer; admin writes await the new
  pointer; old keys expire in 300 s. Negative entries are cleared on create.
- **Detect:** compare `X-Cache` and `links.version` during a canary update; alert if a
  version-pointer write fails.

## 2. Queue lag

- **Symptom:** `/v1/links/:slug/analytics` lags reality; the current hour is empty.
- **Impact:** dashboard underreports until the consumer catches up and the hourly cron runs.
  Redirects and caps are unaffected.
- **Mitigation:** consumer batches up to 100 messages / 5 s; hourly recompute; `POST
/v1/admin/backfill?hours=N` for manual repair.
- **Detect:** queue depth and consumer error rate (Cloudflare Queues metrics). Locally, the
  consumer logs `queue.consumer` with accepted/inserted/duplicates.

## 3. Queue send failure or isolate eviction

- **Symptom:** `links.clicks` advances but no `click_events` row exists.
- **Impact:** analytics undercounts; caps stay correct because the counter is inline.
- **Mitigation:** send inside `ctx.waitUntil` with try/catch and a structured
  `queue.send_failed` log; never fail the redirect. Daily reconciliation logs mismatches.
- **Detect:** `cron.reconcile_mismatch` log count; compare `links.clicks` to event counts for
  recent links.

## 4. D1 write throughput

- **Symptom:** redirect latency rises under load; `D1_ERROR` / rate-limit responses.
- **Impact:** redirects slow or fail; this is the one dependency on the hot path.
- **Mitigation:** short statements, no transactions on the redirect path, queue for fan-out
  writes, 300 s cache to avoid reads. D1 scales writes per database; a single hot link is the
  worst case.
- **Detect:** p95 latency by route, D1 error rate, `wrangler tail`.

## 5. Durable Object hot key

- **Symptom:** one abusive IP drives most traffic to a single DO instance; 429 decisions slow
  down for that IP.
- **Impact:** throttling latency for the attacker; other IPs have separate objects.
- **Mitigation:** key by IP hash, token bucket in storage, fail-open on DO errors.
- **Detect:** DO request latency/errors for the top object IDs; if sustained, move to
  Cloudflare's native rate-limiting rules or shard by IP+slug.

## 6. Cron missed or delayed

- **Symptom:** hourly rollups missing; daily retention not applied.
- **Impact:** empty analytics buckets, unbounded raw growth.
- **Mitigation:** rollups are recomputed idempotently; run `POST /v1/admin/backfill?hours=N`
  after an outage. Retention has a wide margin (30/400 days).
- **Detect:** alert if no `cron.rollup` log in 90 minutes.

## 7. Duplicate queue delivery

- **Symptom:** none if handled; otherwise inflated analytics.
- **Impact:** none — `INSERT OR IGNORE` on the event UUID.
- **Mitigation:** UUID generated at the edge; tests replay 100 events with zero inflation.
- **Detect:** consumer log `duplicates` count; a sudden rise means queue retries.

## 8. Malformed / poisoned message

- **Symptom:** a bad message would retry forever.
- **Impact:** blocked consumer progress.
- **Mitigation:** schema validation; invalid messages are acked and counted as `dropped`.
- **Detect:** `dropped` count in `queue.consumer` logs; DLQ depth.

## 9. Rate limiter unavailable

- **Symptom:** DO throws.
- **Impact:** throttling is bypassed while the redirect still works (fail-open).
- **Mitigation:** structured `rate_limiter.fail_open` log; caps and blocklists still apply.
- **Detect:** log rate; alert if sustained.

## 10. Migration/secret misconfiguration on deploy

- **Symptom:** `readyz` 503 or every admin call 401 after deploy.
- **Impact:** redirects may 500 (`DB` missing) or admin is locked out.
- **Mitigation:** `docs/deploy.md` exact steps; CI deploy runs remote migrations before
  `wrangler deploy`; `readyz` checks D1 + KV.
- **Detect:** post-deploy `/healthz` and `/readyz` checks in the runbook.

## 11. Salt rotation

- **Symptom:** after rotating `IP_HASH_SALT`, uniques reset across the boundary.
- **Impact:** historical and new hashes cannot be joined; this is the privacy goal.
- **Mitigation:** rotate on a fixed monthly date; record the date; do not attempt to correlate
  across rotations.
- **Detect:** calendar/runbook reminder.

## 12. Link cap race

- **Symptom:** without atomic enforcement, two requests could both pass `clicks < max_clicks`.
- **Impact:** over-delivery past the cap.
- **Mitigation:** a single `UPDATE ... WHERE ... RETURNING`; ten concurrent requests against a
  cap of five yield exactly five redirects in tests.
- **Detect:** invariant check `links.clicks <= max_clicks` for capped links.
