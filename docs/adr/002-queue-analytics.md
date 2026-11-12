# ADR 002: Queue-based analytics instead of inline writes

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** EdgeLink build

## Context

The redirect path is the product's hot path. Writing a click event to D1 inline would couple
redirect availability and latency to analytics, and a D1 hiccup would break links. Queue
delivery is at-least-once, so events can be delivered more than once.

## Options considered

1. **Inline insert** — simple, but the redirect waits on D1 and fails when analytics fails.
   Rejected by the spec.
2. **`ctx.waitUntil` + fire-and-forget D1 insert** — non-blocking, but an isolate eviction can
   lose the event and there is no retry.
3. **Queue producer + consumer** — redirect sends a message in `waitUntil`; the consumer
   batch-inserts into D1. Retries are built in; idempotency must be designed.

## Decision

Option 3. Each event carries a UUID generated at the edge. The consumer inserts with
`INSERT OR IGNORE` keyed on that UUID, chunks 50 statements per D1 batch, acks per chunk on
success, and retries the chunk on transient failure. Malformed messages are acknowledged and
dropped so they cannot poison the queue.

Hourly rollups are **recomputed** from raw events in a delete+insert transaction, never
incremented blindly. A cron rerun or backfill therefore produces identical rows, and a
late-arriving event is corrected by re-running the bucket.

## Consequences

- Positive: redirect latency and availability are independent of analytics; redelivery cannot
  inflate counts; rollups are reproducible.
- Negative: analytics is eventually consistent (queue lag + hourly cron). The current hour may
  be empty until the next run or a manual backfill.
- Negative: Queues require the Workers Paid plan ($5/mo minimum). The local build uses
  Miniflare and keeps the queue in the design rather than silently dropping it.
- Negative: `links.clicks` (cap authority) and `click_events` can diverge if a queue send
  fails. The daily job logs mismatches; it does not auto-correct.
- Revisit if queue lag exceeds one hour or D1 write limits are reached; consider a Durable
  Object aggregator or Analytics Engine.

## Links

`src/consumer.ts`, `src/cron.ts`, `docs/failure-modes.md`, `test/workers/analytics.test.ts`.
