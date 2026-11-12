# EdgeLink — Execution Plan (Project 4 of 4 · STRETCH)

> **Bootstrap note:** this repository already exists with git, an MIT license, and a private
> remote. Skip the folder/git/remote steps in Phase G0; start with the tooling tasks. See
> `AGENTS.md` for the working contract and reserved ports. The user explicitly chose a
> parallel build, overriding the usual "after EvalGate" gate; keep the timebox and cut order.

**Spec:** `projects/t2-edgelink.md` · **Rubric:** `projects/00-project-rubric.md`
**Read first:** `execution/00-master-plan.md`.

**Start condition:** EvalGate is tagged `v1.0.0`, its release gate passes, and **at least 10
working days remain**. If not, write "EdgeLink deferred" in `progress/log.md` and start
applying. Do not partially build a fifth project.

**Mission:** an edge-deployed short-link service with click analytics that stay accurate
under abuse, bots, and burst traffic.

**Working days:** 10–12 (timeboxed). **Repo:** `../edgelink`
(`C:\Users\Supreme\repos\edgelink`).

**Stack is frozen:** TypeScript strict, Hono, Cloudflare Workers, Wrangler 4, D1 (SQLite),
KV, Queues, Cron Triggers, Durable Objects, `@cloudflare/vitest-pool-workers`, Vitest,
openapi-typescript, Next.js (static export) for the dashboard, GitHub Actions.

> **Cost reality check:** Queues require the Workers **Paid** plan ($5/mo). D1, KV, Cron,
> and SQLite-backed Durable Objects have free allowances. The entire build and test suite
> runs locally via Miniflare/`wrangler dev`; only the deploy gate needs an account. State
> this in the README. Never silently drop the queue: it is the core of the analytics design.

---

## 1. Target architecture

```
request ──▶ Worker (Hono)
              │ 1. per-IP token bucket (Durable Object, atomic)
              │ 2. KV read-through: link:v<version>:<slug>  (TTL 300s)
              │      miss ──▶ D1 links ──▶ warm KV (waitUntil)
              │ 3. if hit: queue.send(click) in ctx.waitUntil, then 302
              │      else: 404 / 410 expired / 410 capped / 429 limited
              ▼
          Queue (clicks) ──▶ Consumer Worker ──▶ D1 click_events (INSERT OR IGNORE by id)
                                            └──▶ Cron hourly: recompute rollups
                                                 Cron daily: prune raw >30d, rollups >400d
              ▼
          D1 rollups ──▶ public analytics API ──▶ static dashboard
```

Rules baked into the plan:

- The redirect path never awaits analytics writes; the click goes through the queue via
  `ctx.waitUntil`.
- Click events carry a UUID generated at the edge; the consumer dedupes on it, so queue
  redelivery cannot inflate counts.
- KV is eventually consistent: keys are versioned (`link:v{n}:{slug}`), and every write
  bumps `links.version` in D1, so stale values cannot be served after an update.
- Rollups are **recomputed** from raw events for the bucket, never incremented blindly, so a
  cron rerun or a backfill is idempotent.
- Raw IPs are never stored. `ip_hash = HMAC-SHA256(IP_HASH_SALT, ip)` with a monthly
  rotation documented.

### Repository layout (final)

```
edgelink/
  src/
    index.ts              # Hono app + fetch/queue/scheduled exports
    routes/               links.ts redirect.ts analytics.ts health.ts
    lib/                  cache.ts tokens.ts ip.ts bot.ts password.ts slugs.ts
    db/                   queries.ts
    durable/              rate-limiter.ts
    consumer.ts
    cron.ts
  migrations/             0001_init.sql 0002_indexes.sql
  test/                   unit/ workers/ fixtures/
  dashboard/              Next.js static export
  openapi/                openapi.yaml  generated.d.ts
  scripts/                verify.ps1 bench.ts seed.ts walkthrough.ps1
  docs/                   roadmap.md adr/ case-study.md security.md cost.md demo.gif
  wrangler.jsonc  vitest.config.ts  package.json  tsconfig.json  .env.example
  .github/workflows/ci.yml  deploy.yml
```

---

## 2. Phase G0 — Bootstrap (1 day)

1. Create `../edgelink`:
   ```powershell
   $name = "edgelink"
   $dest = Join-Path (Split-Path -Parent (Get-Location)) $name
   New-Item -ItemType Directory -Path $dest -Force
   Set-Location $dest
   git init -b main
   git config core.autocrlf false
   ```
2. MIT `LICENSE`, `.gitattributes`, `.gitignore` (node_modules, `.wrangler/`, `.dev.vars`,
   `.env*`, `dist/`, `.next/`, `out/`), README stub.
3. `pnpm init`; add runtime deps `hono`, dev deps `wrangler`, `@cloudflare/workers-types`,
   `@cloudflare/vitest-pool-workers`, `vitest`, `typescript`, `openapi-typescript`,
   `autocannon`, `tsx`.
4. `wrangler.jsonc`:
   ```jsonc
   {
     "name": "edgelink",
     "main": "src/index.ts",
     "compatibility_date": "2026-01-01",
     "observability": { "enabled": true },
     "d1_databases": [
       {
         "binding": "DB",
         "database_name": "edgelink",
         "database_id": "<from wrangler d1 create>",
         "migrations_dir": "migrations",
       },
     ],
     "kv_namespaces": [{ "binding": "LINKS_KV", "id": "<from wrangler kv namespace create>" }],
     "queues": {
       "producers": [{ "binding": "CLICKS", "queue": "edgelink-clicks" }],
       "consumers": [
         {
           "queue": "edgelink-clicks",
           "max_batch_size": 100,
           "max_batch_timeout": 5,
           "max_retries": 5,
           "dead_letter_queue": "edgelink-clicks-dlq",
         },
       ],
     },
     "durable_objects": { "bindings": [{ "name": "RATE_LIMITER", "class_name": "RateLimiter" }] },
     "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RateLimiter"] }],
     "triggers": { "crons": ["0 * * * *", "15 3 * * *"] },
   }
   ```
   For local-only development, placeholder IDs work with `--local`; note this in the README.
5. `vitest.config.ts` with `defineWorkersConfig` + `poolOptions.workers.wrangler.configPath`
   and `miniflare.d1Databases/kvNamespaces/durableObjects/queueConsumers` as needed.
6. CI: pnpm install, `tsc --noEmit`, eslint/prettier, `vitest run`, `wrangler deploy
--dry-run` (no credentials needed). Deploy workflow is separate and conditional on
   `CLOUDFLARE_API_TOKEN`.
7. Commit, create private remote, push.

**Gate:** `pnpm test` runs 0 tests successfully; `pnpm wrangler deploy --dry-run` succeeds;
`wrangler whoami` result recorded (account available or not).

---

## 3. Phase G1 — Redirect core + link management (M0, 2 days)

### Data model (migration 0001)

```sql
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  target TEXT NOT NULL,
  owner_id TEXT,
  expires_at INTEGER,          -- unix seconds
  max_clicks INTEGER,
  clicks INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,          -- pbkdf2$iterations$salt$hash
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE click_events (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  country TEXT, referrer_host TEXT, device TEXT,
  ip_hash TEXT, is_bot INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_click_events_link_ts ON click_events (link_id, ts);
CREATE TABLE rollups (
  link_id TEXT NOT NULL, bucket_hour INTEGER NOT NULL,
  clicks INTEGER NOT NULL, uniques INTEGER NOT NULL, bots INTEGER NOT NULL,
  PRIMARY KEY (link_id, bucket_hour)
);
```

### Tasks

1. **Admin auth:** `Authorization: Bearer <ADMIN_TOKEN>` (Worker secret / `.dev.vars`);
   constant-time comparison; `401` on missing/wrong.
2. **Link API:**
   - `POST /v1/links` `{target, slug?, expires_at?, max_clicks?, password?}` — validate
     `http/https` target, slug regex `^[a-zA-Z0-9_-]{3,32}$`, blocklist
     (`admin`, `api`, `v1`, `health`, `robots.txt`, `favicon.ico`, reserved words), id via
     `crypto.randomUUID()`, password hashed with PBKDF2-SHA256 (100k iterations, 16-byte
     salt) via WebCrypto. Return slug + short URL.
   - `GET /v1/links`, `PATCH /v1/links/:slug` (target, expiry, active; bumps `version`),
     `DELETE /v1/links/:slug` (soft delete: `active=0`, bump version), all admin-only.
   - `GET /v1/links/:slug` admin detail; never expose `password_hash`.
3. **Redirect** `GET /:slug`:
   - Look up link (D1 for now; cache added in G2). Order of checks: not found → 404;
     inactive → 410; expired → 410; capped → 410; password set → 401 with a `WWW-Authenticate`
     hint (password-protected redirect is a stretch; if implemented, verify `?pw=` or a
     signed cookie, never log it).
   - Atomic cap enforcement:
     ```sql
     UPDATE links SET clicks = clicks + 1
     WHERE slug = ? AND active = 1
       AND (expires_at IS NULL OR expires_at > ?)
       AND (max_clicks IS NULL OR clicks < max_clicks)
     RETURNING target, id;
     ```
     No row → `410` (expired or capped). This avoids the count/increment race.
   - `302` with `Location`, `Cache-Control: no-store` (redirects are not cached by shared
     caches; KV is our cache), `X-Cache: MISS`, `X-Request-Id`.
4. **Health:** `GET /healthz` (no bindings), `GET /readyz` (`SELECT 1` on D1 + KV get),
   `GET /robots.txt` disallowing everything.
5. **Tests (workers pool):** 302 happy path; 404 unknown; 410 expired; 410 capped (and the
   cap is not exceeded under 10 concurrent requests); 401 admin; 400 bad target/slug;
   blocklisted slug; password hash verify; `healthz`/`readyz`; `X-Request-Id` echo.

### Commits

```
feat(db): links, click events, and rollups schema
feat(api): admin link create/list/update/delete
feat(redirect): 302 with atomic cap and expiry checks
feat(api): admin token auth and slug validation
test(redirect): status code matrix and cap concurrency
```

**Gate:** status matrix green; cap can never be exceeded in the concurrency test;
`wrangler deploy --dry-run` still passes.

---

## 4. Phase G2 — KV cache and invalidation (M1, 2–3 days)

### Tasks

1. **Cache key:** `link:v{version}:{slug}` → JSON `{id, target, expires_at, max_clicks,
clicks, active, password: bool}`; TTL 300s.
2. **Read path:** KV get → hit: `X-Cache: HIT`, skip D1 except for the click counter? Do
   **not** trust a cached `clicks` for the cap; the cap decision must hit D1 atomically.
   Design: cache serves target/eligibility; the atomic `UPDATE ... RETURNING` is always
   executed (it is also the click counter). Document this honestly: the cache saves the
   lookup, not the write. If that makes the cache pointless for latency, benchmark and
   document the real gain; consider `max_clicks` in the cached payload only for a fast
   pre-check, with D1 as the authority.
3. **Miss path:** read D1, `ctx.waitUntil(LINKS_KV.put(key, json, {expirationTtl:300}))`,
   return with `X-Cache: MISS`.
4. **Negative cache:** `miss:{slug}` = `"1"`, TTL 30s; every create/update/delete deletes
   it. Document the 30s propagation window.
5. **Invalidation:** update/delete bumps `links.version`; the new key is automatically
   fresh, old versions expire by TTL. Also delete `miss:{slug}` on create. This is
   invalidation without enumerating keys.
6. **Benchmark** (`scripts/bench.ts` with autocannon against `wrangler dev`):
   - cold (KV miss, flush via unique slugs) vs warm (repeat slug);
   - record p50/p95/p99, requests/s, cache hit rate from `X-Cache` counts.
   - Note that local Miniflare numbers are indicative; if a real deploy exists, publish the
     deployed numbers as the headline and local as a footnote.
7. **Tests:** warm hit returns `X-Cache: HIT`; after PATCH target, the very next request
   returns the new target (version bump), no stale window; expired link never cached as a
   redirect (negative result only in the short negative cache); deleting a link makes the
   next request 404/410; capped link never served from cache as a successful redirect.

### Commits

```
feat(cache): versioned kv read-through with warm-on-miss
feat(cache): negative caching and invalidation on writes
perf: cold/warm benchmark script and results
test(cache): version bump, expiry, and delete invalidation
```

**Gate:** a PATCH is visible on the next request; benchmark results saved under
`docs/bench/`; no stale success after cap/expiry.

---

## 5. Phase G3 — Analytics pipeline, rollups, retention (M2, 3 days)

### Tasks

1. **Click capture:** after a successful redirect, build
   ```ts
   { id: crypto.randomUUID(), link_id, ts: Math.floor(Date.now()/1000),
     country: request.cf?.country ?? null, referrer_host,
     device: classify(ua), ip_hash: await hashIp(ip, env), is_bot }
   ```
   and `ctx.waitUntil(env.CLICKS.send(event))`. Never block or fail the redirect on a queue
   error; log and increment a metric.
2. **Consumer** (`consumer.ts`): validate shape, batch insert
   ```sql
   INSERT OR IGNORE INTO click_events (...) VALUES (...);
   ```
   per message; ack per message; let retries happen for transient D1 errors. Log counts;
   idempotent by `id`. Do not use `db.batch` beyond D1 limits; chunk to 50.
3. **Hourly rollup** (`scheduled` with cron `0 * * * *`): for the previous completed hour,
   recompute **from raw events**:
   ```sql
   INSERT INTO rollups (link_id, bucket_hour, clicks, uniques, bots)
   SELECT link_id, ?1, COUNT(*), COUNT(DISTINCT ip_hash), SUM(is_bot)
   FROM click_events WHERE ts >= ?2 AND ts < ?3 GROUP BY link_id
   ON CONFLICT(link_id, bucket_hour) DO UPDATE SET
     clicks=excluded.clicks, uniques=excluded.uniques, bots=excluded.bots;
   ```
   Idempotent by construction. Add a `--backfill <hours>` command via a script that calls
   the same function.
4. **Daily maintenance** (cron `15 3 * * *`): delete raw events older than 30 days; delete
   rollups older than 400 days; reconcile `links.clicks` against `SUM(click_events)` and log
   mismatches (do not auto-correct without an audit note).
5. **Analytics API** (admin): `GET /v1/links/:slug/analytics?days=30` reads **rollups only**
   — totals, per-day series, top referrers, device split, bot share, unique visitors. Return
   404 for unknown slug.
6. **Tests:** 1,000 queued clicks across 3 links → exact rollup totals; duplicate message
   ids → no inflation; cron rerun → identical values; late-arriving event in a closed
   bucket (rerun backfill) corrects totals; retention deletes only old rows; analytics query
   never scans raw events (assert by mocking raw table access or reviewing the SQL in a
   test).

### Commits

```
feat(analytics): queue send on redirect with waitUntil
feat(consumer): idempotent batch insert into d1
feat(cron): hourly rollup recompute and daily prune
feat(api): analytics read model over rollups
test(analytics): 1000-click exactness and replay safety
```

**Gate:** 1,000-click test green 3×; rollup rerun diff is zero; retention boundaries tested.

---

## 6. Phase G4 — Abuse, bots, privacy (M3, 2–3 days)

### Tasks

1. **Rate limiter Durable Object** (`durable/rate-limiter.ts`): per-IP token bucket with
   `rate_per_min` and `burst` from env, state in DO storage (or in-memory with
   `blockConcurrencyWhile` for correctness across requests — DO is single-threaded per id,
   document the choice). `check()` returns `{allowed, retryAfter}`. Worker keys the DO by
   `idFromName(ipHash)`.
2. **429 path:** `429` with `Retry-After` seconds, `Cache-Control: no-store`; do not count
   the request as a click.
3. **Bot heuristic** (`lib/bot.ts`): static UA substring list (curl, wget, python-requests,
   headless markers, known crawlers) + optional ASN list via `request.cf.asn`; documented
   false-positive policy: bots are counted in `bots` and excluded from `uniques`, but still
   served the redirect. No blocking of suspicious UAs (avoid breaking link previews);
   document.
4. **Privacy:** `hashIp(ip, salt)` = HMAC-SHA256 with `IP_HASH_SALT` (Worker secret). Salt
   rotation is manual and documented; hashes are not reversible but are stable within a
   rotation window. Never log raw IPs, never store them. Retention already covers raw
   events.
5. **Blocklist:** static slug deny list plus optional target deny list (known phishing
   domains file); loaded from a JSON module, no external calls on the redirect path.
6. **Tests:** burst 500 requests from one IP → 429 with `Retry-After`, and normal traffic
   from other IPs is unaffected; token bucket refills over time (fake clock / DO direct
   calls); bot UA classified; unique visitors exclude bots; raw IP never appears in any
   stored row or log (assert on a serialized event); password-protected link does not log
   the password.

### Commits

```
feat(abuse): durable object token bucket per ip
feat(abuse): 429 with retry-after and bypass-safe redirects
feat(privacy): salted ip hashing and bot classification
test(abuse): burst isolation and bucket refill
docs(security): privacy, hashing, retention, and bot policy
```

**Gate:** burst test green; no raw IP in fixtures/DB dumps; rate limiter does not break the
redirect path when the DO errors (fail-open with a log, documented).

---

## 7. Phase G5 — Dashboard, docs, deploy, release (M4, 2–3 days)

### Tasks

1. **Dashboard** (`dashboard/`, Next.js static export): link list, create/edit form, 30-day
   clicks chart (SVG, no heavy chart lib), top referrers, device split, bot share. Admin
   token entered in the UI and kept in `sessionStorage`; all reads from the analytics API.
   If time is short, cut this to a single table + one sparkline (see cut order).
2. **OpenAPI:** hand-written `openapi/openapi.yaml` covering all routes; a test validates it
   (e.g. `@apidevtools/swagger-parser` or `openapi-typescript` parse); generate
   `openapi/generated.d.ts` and use it for the dashboard's typed fetch.
3. **Docs:** README (pitch, architecture diagram, cold/warm numbers, cost table, run,
   deploy, tradeoffs, what's next), `docs/cost.md` (per 1M redirects: requests, KV reads,
   D1 rows read/written, queue ops, DO requests, plan minimum), `docs/case-study.md`
   (eventual consistency, KV limits, queue idempotency, why not count inline),
   `docs/failure-modes.md` (KV stale, queue lag, D1 write limits, DO hot key, cron missed),
   ADRs: KV vs D1 for redirects, queue vs inline analytics, DO vs KV rate limiting.
4. **Deploy (conditional):** `wrangler d1 create edgelink`, `wrangler kv namespace create`,
   `wrangler queues create`, fill IDs into `wrangler.jsonc`, `wrangler d1 migrations apply
edgelink --remote`, `wrangler deploy`; optional Pages deploy for the dashboard. If no
   account/token, keep the dry-run CI and mark the live URL deferred with exact steps.
5. **Demo:** `scripts/walkthrough.ps1` + `docs/demo.gif` (scripted terminal capture); a live
   URL if deployed.
6. **Release:** tag `v1.0.0`, push, make public, topics (`cloudflare-workers`, `hono`,
   `d1`, `kv`, `edge`, `analytics`), update parent `progress/log.md`.

### Commits

```
feat(dashboard): link list and 30-day analytics view
feat(api): openapi spec and generated typed client
docs: cost model, failure modes, and case study
build: deploy workflow and remote migration guide
chore: release v1.0.0
```

---

## 8. Final walkthrough test

| #   | Action                                                                                                  | Expected                                                  |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | `pnpm wrangler d1 migrations apply edgelink --local`; `pnpm dev`                                        | Worker on `http://localhost:8787`                         |
| 2   | Create link via admin token, target `https://example.com/a`                                             | 201 + slug                                                |
| 3   | `curl -I /slug`                                                                                         | 302, `Location: https://example.com/a`, `X-Cache: MISS`   |
| 4   | Repeat                                                                                                  | `X-Cache: HIT`                                            |
| 5   | PATCH target to `/b`; immediate request                                                                 | 302 to `/b` (version bump, no stale)                      |
| 6   | Set `expires_at` in the past; request                                                                   | 410, and again 410                                        |
| 7   | Set `max_clicks: 2`; request 3×                                                                         | 302, 302, 410; `clicks=2`                                 |
| 8   | Seed 1,000 clicks across 3 links with mixed UAs/IPs                                                     | queued                                                    |
| 9   | Trigger cron (`/__scheduled?cron=0+*+*+*+*` with `--test-scheduled` or `wrangler dev --test-scheduled`) | rollups exact; rerun identical                            |
| 10  | Daily cron                                                                                              | old raw rows pruned; rollups retained                     |
| 11  | Analytics API                                                                                           | totals match; uniques exclude bots; top referrers correct |
| 12  | Burst 500 requests from one IP                                                                          | 429 + `Retry-After`; other IP unaffected                  |
| 13  | D1/log inspection                                                                                       | no raw IPs, no passwords, no tokens                       |
| 14  | `pnpm test`, `pnpm typecheck`, `wrangler deploy --dry-run`                                              | green                                                     |
| 15  | Dashboard (if built)                                                                                    | shows 30-day chart and top referrers for the demo link    |
| 16  | Deploy (if account)                                                                                     | live redirect + analytics; record numbers                 |

---

## 9. Definition of Done checklist

- [ ] README pitch + architecture + cold/warm numbers + cost table + tradeoffs
- [ ] `wrangler dev` local run documented; deploy steps exact
- [ ] CI green: typecheck, lint, workers-pool tests, deploy dry-run
- [ ] Failure tests: 404/410/429, expiry, cap concurrency, cache invalidation, queue
      redelivery, rollup reruns, retention, bot classification, auth rejection
- [ ] `/healthz`, `/readyz`, request ids, structured logs
- [ ] OpenAPI + generated typed client
- [ ] 3 ADRs + case study + failure modes + security/privacy notes + cost model
- [ ] Benchmark results with method and caveat (local vs deployed)
- [ ] MIT license, conventional history, `v1.0.0`
- [ ] Demo GIF / live URL (or documented deferral)
- [ ] `docs/interview-notes.md`: consistency model, KV limits, queue idempotency, cost math

---

## 10. Cut order (timebox discipline)

Cut from the bottom, in this order, recording each cut in `progress/log.md`:

1. Dashboard extras → single table + sparkline.
2. Deploy preview/dashboard hosting → local demo + dry-run CI.
3. Bot heuristic → static UA list only, ASN omitted.
4. Durable Object rate limiter → KV-based approximate limiter, with the tradeoff documented
   and a test showing the known race.
5. Password-protected links → omit and list under "what I'd do next".

**Never cut:** redirect correctness, cache versioning, cap/expiry atomicity, queue
idempotency, rollup exactness, IP hashing, the 1,000-click test, CI.

---

## 11. Risks and fallbacks

| Risk                                           | Mitigation                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| No Cloudflare account / no Queues on free plan | Build and test locally with Miniflare; deploy gate deferred; README states the paid requirement   |
| KV eventual consistency confusing the demo     | Versioned keys + immediate D1 authority for caps/expiry; test proves no stale success             |
| Queue local emulation differences              | Workers-pool `createMessageBatch` tests + `wrangler dev` walkthrough; document the gap            |
| D1 write throughput under load                 | Batch inserts, chunk to 50, document the limit and the queue buffer                               |
| DO hot key for a single abusive IP             | Per-IP DO id; documented cost; fallback to KV approximation if DO unavailable                     |
| Local benchmarks mistaken for edge numbers     | Label local numbers explicitly; publish deployed numbers only when actually measured              |
| Cron not firing locally                        | `wrangler dev --test-scheduled` + `/__scheduled`; test `scheduled()` directly in the workers pool |
