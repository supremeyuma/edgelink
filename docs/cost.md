# Cost model — per million redirects

Plan minimum: **Workers Paid, $5/month**, required for Queues. D1, KV, Cron Triggers, and
SQLite-backed Durable Objects have free allowances but are still billed at the margin.

Prices below are the published Cloudflare list prices used for this estimate; re-check them
before quoting. The model assumes a **warm cache** unless stated otherwise.

## Assumptions for 1M redirects

| Resource                | Units per 1M           | Notes                                       |
| ----------------------- | ---------------------- | ------------------------------------------- |
| Worker requests         | 1M                     | 10M/month included in the $5 plan           |
| KV reads                | 2M                     | version pointer + payload                   |
| KV writes               | ~20k                   | 1% cache churn × 2 keys                     |
| D1 row writes           | 1M                     | one atomic `UPDATE` per successful redirect |
| D1 row reads            | 0 (warm)               | cold path adds 1M row reads                 |
| Queue operations        | 2M                     | 1M sends + 1M consumer deliveries           |
| Durable Object requests | 1M                     | one token-bucket check per redirect         |
| Cron                    | ~750/hourly + 30 daily | negligible                                  |

## Marginal cost estimate

| Resource           | Included allowance | Marginal price                | Cost for 1M redirects |
| ------------------ | ------------------ | ----------------------------- | --------------------- |
| Workers requests   | 10M/mo             | $0.30 / M                     | $0.00–$0.30           |
| KV reads           | 10M/mo             | $0.50 / M                     | ~$0.00–$1.00          |
| KV writes          | 1M/mo              | $5.00 / M                     | ~$0.10                |
| D1 rows written    | 50M/mo             | $1.00 / M                     | ~$0.00–$1.00          |
| Queue operations   | 1M/mo              | $0.40 / M                     | ~$0.40–$0.80          |
| DO requests        | 1M/mo              | $0.15 / M                     | ~$0.00–$0.15          |
| DO duration        | —                  | small at these request counts | <$0.10                |
| **Marginal total** |                    |                               | **≈ $1.50–$3.35**     |

Add the **$5/month plan minimum**. A realistic first-month bill for 1M redirects is therefore
**$5–$9**, dominated by the plan minimum rather than usage.

## Cold-cache scenario

If every request misses KV, add 1M D1 row reads and 2M KV writes:

- KV writes: +$10.00
- D1 reads: within the 25B/month included allowance at this scale
- Cold cache is a load-test shape, not a steady state; the versioned cache exists to avoid it.

## What is not modelled

- Egress (Workers responses are not billed like R2 egress).
- Logpush / observability retention beyond the included observability quota.
- Dashboard hosting (Cloudflare Pages free tier is sufficient for a static export).
- D1 storage: `click_events` at 1M clicks/day is roughly tens of MB for 30 days of retention
  at ~100 bytes/row; the 5GB free allowance lasts a long time.

## Cost levers

1. Increase `LINK_TTL` to cut KV writes (and accept a longer target-propagation window).
2. Move rate limiting to Cloudflare's native rate-limiting rules to drop DO requests.
3. Raise `max_batch_size`/`max_batch_timeout` for Queues if consumer throughput allows.
4. Prune raw events more aggressively; rollups are what the dashboard reads.
