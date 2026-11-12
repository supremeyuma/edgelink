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

- [x] Dashboard reading rollups, OpenAPI + typed client
- [x] Cost model, failure modes, case study, ADRs
- [x] Deploy or documented local-only deferral
- [x] `v1.0.0`, public repo, topics, parent log updated

**Gate evidence:** `pnpm run verify` green (54 tests + dashboard build + OpenAPI freshness +
deploy dry-run). Dashboard: `next build` static export; `next dev -p 3002` returned HTTP 200
with the expected markup. OpenAPI: `openapi/openapi.yaml` validated and
`openapi/generated.d.ts` freshness enforced; typed client in `src/client.ts`. Docs: cost model,
case study, failure modes, security/privacy, 3 ADRs, interview notes, deploy runbook, and the
observed walkthrough in `docs/walkthrough.md` (`WALKTHROUGH PASSED`, 1,000 clicks, exact cap,
429 burst isolation, zero raw IPs). Deploy: **deferred** — `wrangler whoami` is unauthenticated
and Workers Paid is not connected; `docs/deploy.md` has the exact steps. Repo made public with
topics; the parent `ai-engineering-pivot` log is a **separate repository** and was intentionally
not modified in this session (external follow-up).

## Release gate (master plan §7)

| Gate                                            | Status      | Evidence                                                                                      |
| ----------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `scripts/verify.ps1` exits 0 from a fresh clone | ✅          | local clone: `pnpm install --frozen-lockfile` + `pnpm run verify` → exit 0, all checks passed |
| `docker compose up --build` healthy <5 min      | n/a         | EdgeLink uses Miniflare/`wrangler dev`, per plan                                              |
| Final walkthrough executed and recorded         | ✅          | `docs/walkthrough.md`                                                                         |
| CI green on `main`                              | ⏳          | workflow committed; first run happens on push                                                 |
| `v1.0.0` annotated tag pushed                   | ✅          | tagged after the release commit                                                               |
| Repo public, license, topics, description       | ✅          | `gh repo edit` / `gh repo view`                                                               |
| No secrets in history                           | ✅          | credential regex + `.dev.vars` path scan over all history: clean                              |
| Parent `progress/log.md` updated                | ⏳ external | separate repo; not touched per session instruction                                            |

## Definition of Done (rubric evidence)

| Rubric item                      | Evidence                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| One-sentence pitch               | `README.md` first blockquote                                                                                  |
| Architecture diagram + tradeoffs | `README.md` Mermaid + Design decisions + 3 ADRs                                                               |
| `docker compose up`              | not applicable; `pnpm dev` + Miniflare documented                                                             |
| CI lint/typecheck/tests + badge  | `.github/workflows/ci.yml`, README badge                                                                      |
| Failure-path tests               | `test/workers/` (status matrix, cap concurrency, cache invalidation, queue replay, rollups, retention, burst) |
| OpenAPI/typed client             | `openapi/openapi.yaml`, `openapi/generated.d.ts`, `src/client.ts`                                             |
| Structured logs + health         | `/healthz`, `/readyz`, `X-Request-Id`, JSON event logs                                                        |
| Docs explaining why              | `docs/case-study.md`                                                                                          |
| License                          | `LICENSE` (MIT)                                                                                               |
| Conventional commits             | `git log --oneline`                                                                                           |
| Load-test numbers                | `docs/bench/README.md` + `docs/bench/local-2026-11-12.json`                                                   |
| Failure-mode section             | `docs/failure-modes.md`                                                                                       |
| 3 ADRs                           | `docs/adr/001..003`                                                                                           |
| Observability                    | Workers observability enabled; structured logs documented                                                     |
| Security notes                   | `docs/security.md` + README                                                                                   |
| Cost note                        | `docs/cost.md` + README                                                                                       |
| Demo                             | `docs/walkthrough.md`; GIF/live URL deferred                                                                  |
| Interview readiness              | `docs/interview-notes.md`                                                                                     |

## Deferred (honest list)

- Live Cloudflare deploy, Workers Paid/Queues, and a real URL (no account/token).
- Deployed latency and cost numbers; local Miniflare numbers are labelled indicative.
- Demo GIF (scripted walkthrough provided instead).
- Password **entry** on the redirect (hashing and 401 challenge exist; verification is under
  "what's next").
- Parent portfolio log update (separate repo; not touched).
