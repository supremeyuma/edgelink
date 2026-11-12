# EdgeLink Roadmap and Gate Evidence

Source plan: `docs/plan.md`. Update this file at every phase gate. A checked box means
verified, not "written".

## G0 — Bootstrap

- [x] Folder created at `../edgelink`
- [x] Git repository on `main`, `core.autocrlf=false`
- [x] MIT license, `.gitignore`, `.gitattributes`, `.editorconfig`
- [x] Execution plan, spec, master plan, and agent instructions committed
- [x] Private GitHub remote created and pushed
- [x] Tooling: pnpm, Hono, Wrangler config, D1/KV/Queues/DO bindings, Vitest workers pool,
      CI skeleton
- [x] `pnpm test`, `pnpm typecheck`, and `wrangler deploy --dry-run` green on the empty shell
- [x] `wrangler whoami` result recorded (account available or local-only)

**Evidence:** `pnpm run verify` passes: prettier check, eslint, `tsc --noEmit`, Vitest workers
pool (3 health tests), and `wrangler deploy --dry-run` (63.15 KiB upload, D1/KV/Queue/DO
bindings resolved). `wrangler whoami` → **not authenticated**; build is local-only
(Miniflare/`wrangler dev`), deploy gate deferred until a Cloudflare account + Workers Paid is
available.

## G1 — Redirect core + link management (M0)

- [x] D1 schema/migrations; admin link CRUD; atomic cap/expiry
- [x] Status-code matrix + cap concurrency tests

**Gate evidence:** `pnpm run verify` green (28 tests, 4 files). Status matrix covers 302, 404,
410 (expired/capped/deleted), 401 (admin + password), 400 (target/slug/patch), 409
(duplicate). Ten concurrent requests against `max_clicks=5` produce exactly five 302s, five
410s, and `clicks=5`; a further request stays 410 without incrementing. Redirects carry
`Cache-Control: no-store`, `X-Cache: MISS`, and echo `X-Request-Id`.

## G2 — KV cache and invalidation (M1)

- [x] Versioned read-through cache, negative caching, invalidation
- [x] Cold/warm benchmark

**Gate evidence:** `pnpm run verify` green (35 tests, 5 files). Cache tests prove a PATCH is
visible on the next request (`link:v2:*` written synchronously by admin mutations), expired
and capped links never redirect from cache, deletes invalidate, and negative entries are
cleared on create. Benchmark in `docs/bench/README.md`: warm p95 9.9 ms / 100% `X-Cache: HIT`
vs cold p95 475 ms (300 unique slugs, 20-way concurrency) on local Miniflare — labelled as
indicative, not edge numbers. Deviation from the plan: Cloudflare KV rejects
`expirationTtl` below 60 s, so the negative-cache window is 60 s, not 30 s.

## G3 — Analytics pipeline, rollups, retention (M2)

- [x] `waitUntil` + queue send, idempotent consumer
- [x] Hourly recompute rollups, daily prune, analytics API
- [x] 1,000-click exactness and replay-safe tests

**Gate evidence:** `pnpm run verify` green (45 tests, 6 files); the 1,000-click test passed
three consecutive runs. Consumer test inserts 1,000 events across three links, replays 100
and confirms zero inflation, and drops malformed messages. Rollup reruns produce identical
rows; a late event plus backfill corrects the closed bucket; retention keeps only rows inside
the 30-day raw / 400-day rollup windows. Analytics API reads rollups only (a contradictory raw
event is ignored) and returns totals, daily series, top referrers, device split, and bot share.

Plan deviations, recorded honestly:

- Added `referrer_rollups` and `device_rollups` (migration `0002`) because the plan's
  `rollups` table cannot answer top-referrer/device queries without scanning raw events.
- Workers-pool tests exercise producer (`buildClickEvent`) and consumer (`createMessageBatch`)
  separately; Miniflare's queue auto-delivery is validated end-to-end by the `wrangler dev`
  walkthrough rather than the pool, matching the plan's documented gap.

## G4 — Abuse, bots, privacy (M3)

- [x] Durable Object token bucket, 429 + `Retry-After`
- [x] Bot heuristic, salted IP hashing, blocklist
- [x] Burst isolation and privacy tests

**Gate evidence:** `pnpm run verify` green (54 tests, 8 files). A 500-request burst from
`198.51.100.201` yields a bounded number of 302s and >400 `429`s with `Retry-After`; only the
allowed requests increment `clicks`; a second IP is unaffected. The token-bucket test proves
persistence and one-token-per-second refill with a fake clock. Privacy tests prove HMAC
determinism per salt, salt sensitivity, no raw IP in a serialized event, platform-IP fallback,
bot/device classification, and exact/subdomain target blocklisting. `docs/security.md` records
hashing, retention, bot false-positive policy, fail-open behavior, and known gaps.

## G5 — Dashboard, docs, deploy, release (M4)

- [ ] Dashboard reading rollups, OpenAPI + typed client
- [ ] Cost model, failure modes, case study, ADRs
- [ ] Deploy or documented local-only deferral
- [ ] `v1.0.0`, public repo, topics, parent log updated

**Gate evidence:** _pending_
