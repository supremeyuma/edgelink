# EdgeLink — Link Shortener with Edge Analytics

**One line:** An edge-deployed short-link service with click analytics that stay accurate
under abuse, bots, and burst traffic.

**Status: stretch project.** Build it only after EvalGate ships, or as a 2-week extension
if you finish Phase 3 early. It exists to prove **edge/serverless TypeScript**, which is
a different runtime skill from Node servers and a differentiator for platform roles.

## What it proves

- Hono on Cloudflare Workers (or Deno Deploy / Vercel Edge)
- D1 (SQLite) + KV cache + Queues + Cron Triggers
- Redirect latency budget (p95 < 20ms from cache)
- Bot filtering, IP hashing (privacy), rate limiting at the edge
- Analytics pipeline: raw events → hourly rollups → dashboard queries
- OpenAPI + typed client, Vitest with `@cloudflare/vitest-pool-workers`
- Infrastructure as code (`wrangler.toml`) and CI deploy previews

## Scope

**In:**
- Create/update/expire short links, custom slugs, optional password, max-click caps
- `GET /:slug` → 302 with cached lookup; 404/410/429 paths
- Click capture via `waitUntil`, no blocking the redirect
- Analytics: clicks, unique visitors (hashed IP+UA), referrer, country (edge geo),
  device class, hourly rollups
- Bot filtering with a UA/ASN heuristic + `robots.txt` respect
- Abuse controls: per-IP token bucket, slug blocklist, safe-browsing style deny list (static)
- Dashboard: link list, 30-day chart, top referrers

**Out:** custom domains per user, link-in-bio pages, billing, ML fraud detection.

## Architecture

```
            ┌──────────────┐
request ───▶│ Worker (Hono)│──▶ KV (slug → target, TTL)
            └──────┬───────┘
                   │ miss              ┌──────────┐
                   ├──────────────────▶│ D1 (links,│
                   │                   │ rollups)  │
                   │ hit + click       └──────────┘
                   ▼
             Queue (clicks) ──▶ Consumer Worker ──▶ D1 click_events
                                              └──▶ Cron: hourly rollup + prune
```

Key numbers to document: redirect p95 cold vs warm, cost per 1M redirects, queue lag,
rollup correctness under replay.

## Data model

```
links(id, slug UNIQUE, target, owner_id, expires_at, max_clicks, clicks,
      password_hash, active, created_at)
click_events(id, link_id, ts, country, referrer_host, device, ip_hash, is_bot)
rollups(link_id, bucket_hour, clicks, uniques, bots)
```

## Milestones

### M0 — Edge skeleton (2 days)
- [ ] Hono app + wrangler + D1 migrations + KV binding + CI deploy to preview
- [ ] `GET /:slug` redirect from D1; health endpoint
- [ ] Vitest with workers pool; one test per status code

### M1 — Performance + cache (3 days)
- [ ] KV read-through cache with negative caching for 404s
- [ ] Cache invalidation on link update/delete (versioned key)
- [ ] Benchmark cold/warm; document p95 and cache hit rate
- [ ] Test: expired link returns 410 without cache poisoning; capped link stops

### M2 — Analytics pipeline (4 days)
- [ ] `ctx.waitUntil` + Queue send; consumer batch insert into D1
- [ ] Idempotent consumer via event id (queue can redeliver)
- [ ] Cron: hourly rollup, daily prune, reconcile counts
- [ ] Test: 1,000 queued clicks → exact rollup totals; replay-safe

### M3 — Abuse + privacy (3 days)
- [ ] Per-IP and per-slug token buckets (KV/Durable Object if needed)
- [ ] Bot heuristic with a documented false-positive policy
- [ ] Salted IP hashing, retention policy, no raw IP storage
- [ ] Test: burst 500 rps from one IP → 429 with `Retry-After`

### M4 — Dashboard + launch (3 days)
- [ ] Next.js dashboard reading rollups (no raw event scans)
- [ ] OpenAPI + typed client; README with cost table and latency chart
- [ ] Demo video; short write-up on edge tradeoffs (eventual consistency, KV limits)

## Demo script (for interviews)

> "Redirects are served from KV at p95 12ms; a cache miss falls back to D1 and warms KV.
> Clicks never block the redirect — they go through a queue, and the consumer dedupes on
> event ids so redelivery doesn't inflate counts. Hourly rollups keep dashboard queries
> fast, and the whole thing runs in one Worker with a documented cost per million
> redirects."

## Why this matters for the pivot

It proves you can operate outside the Laravel/Node comfort zone: a different runtime,
different consistency model, different failure modes. That is exactly the "versatility"
you asked for, and it is a strong conversation piece in system-design rounds.

## Traps to avoid

- Counting clicks inline. It makes the redirect slow and couples analytics to uptime.
- Storing raw IPs. Hash with a rotating salt and say why.
- Assuming KV is strongly consistent. Version keys and document the TTL window.
- Overbuilding the dashboard before the rollup math is tested.
