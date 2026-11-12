# EdgeLink Roadmap and Gate Evidence

Source plan: `docs/plan.md`. Update this file at every phase gate. A checked box means
verified, not "written".

## G0 — Bootstrap

- [x] Folder created at `../edgelink`
- [x] Git repository on `main`, `core.autocrlf=false`
- [x] MIT license, `.gitignore`, `.gitattributes`, `.editorconfig`
- [x] Execution plan, spec, master plan, and agent instructions committed
- [x] Private GitHub remote created and pushed
- [ ] Tooling: pnpm, Hono, Wrangler config, D1/KV/Queues/DO bindings, Vitest workers pool,
      CI skeleton
- [ ] `pnpm test`, `pnpm typecheck`, and `wrangler deploy --dry-run` green on the empty shell
- [ ] `wrangler whoami` result recorded (account available or local-only)

**Evidence:** repository bootstrapped; remote expected at
<https://github.com/supremeyuma/edgelink>. Tooling evidence pending.

## G1 — Redirect core + link management (M0)

- [ ] D1 schema/migrations; admin link CRUD; atomic cap/expiry
- [ ] Status-code matrix + cap concurrency tests

**Gate evidence:** _pending_

## G2 — KV cache and invalidation (M1)

- [ ] Versioned read-through cache, negative caching, invalidation
- [ ] Cold/warm benchmark

**Gate evidence:** _pending_

## G3 — Analytics pipeline, rollups, retention (M2)

- [ ] `waitUntil` + queue send, idempotent consumer
- [ ] Hourly recompute rollups, daily prune, analytics API
- [ ] 1,000-click exactness and replay-safe tests

**Gate evidence:** _pending_

## G4 — Abuse, bots, privacy (M3)

- [ ] Durable Object token bucket, 429 + `Retry-After`
- [ ] Bot heuristic, salted IP hashing, blocklist
- [ ] Burst isolation and privacy tests

**Gate evidence:** _pending_

## G5 — Dashboard, docs, deploy, release (M4)

- [ ] Dashboard reading rollups, OpenAPI + typed client
- [ ] Cost model, failure modes, case study, ADRs
- [ ] Deploy or documented local-only deferral
- [ ] `v1.0.0`, public repo, topics, parent log updated

**Gate evidence:** _pending_
