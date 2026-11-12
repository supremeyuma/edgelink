# Agent Instructions — EdgeLink

This repository is already bootstrapped: directory, git repo on `main`, MIT license, and a
private GitHub remote exist. **Do not run `git init`, create a new repo, or replace the
remote.** Start with the tooling part of Phase G0 in [`docs/plan.md`](docs/plan.md).

## Read first

1. [`docs/spec.md`](docs/spec.md) — product scope, architecture, milestones.
2. [`docs/plan.md`](docs/plan.md) — the authoritative execution plan, including the cut order.
3. [`docs/master-plan.md`](docs/master-plan.md) — commit, phase, and release conventions.
4. [`docs/roadmap.md`](docs/roadmap.md) — update this at every gate.

## How to work

- Follow the phases in order: G0 tooling → G1 redirect core → G2 KV cache → G3 analytics/
  rollups → G4 abuse/privacy → G5 dashboard/deploy/release.
- Work each phase on `phase/<n>-<name>`, commit every meaningful change with Conventional
  Commits, run the full gate, merge to `main` with `--no-ff`, tag the phase, and push.
- `scripts/verify.ps1` must pass before a phase is considered done: typecheck, lint, tests,
  `wrangler deploy --dry-run`.
- Follow the plan's **cut order** when time runs short. Never cut redirect correctness, cache
  versioning, queue idempotency, rollup exactness, IP hashing, or the 1,000-click test.
- Never weaken a failing test to make a phase pass. Fix the code or cut scope explicitly.

## Scope note

The master plan normally treats EdgeLink as a stretch project gated on EvalGate. The user
explicitly requested all three remaining projects in parallel, so proceed — but keep the
10–12 working-day timebox and use the cut order rather than expanding scope.

## Environment notes (this machine)

- Node 22 and pnpm 12 are installed via winget. **Use the installed pnpm**; set
  `packageManager` to the installed version. Do not use `corepack` — it hits EPERM on
  `C:\Program Files\nodejs`.
- Cloudflare account, API token, and Workers Paid (for Queues) are **optional** for the local
  build. Without them, run `wrangler dev --local` / Miniflare, keep the tests green, and mark
  the deploy gate deferred. Do not fake a live URL.
- `gh` is authenticated as `supremeyuma`.

## Parallel build coordination

Two other agents are building `statusbeam` and `evalgate` on the same machine, and HookRelay
may be running. EdgeLink uses Miniflare/`wrangler dev`, not the shared Postgres/Redis stack:

| Service | Port |
|---|---|
| Worker (`wrangler dev`) | **8787** |
| Dashboard | **3002** |

- Do not start Postgres or Redis for this project.
- Do not run Docker except for optional `act` checks.
- Do not touch `C:\Users\Supreme\repos\hookrelay`, `statusbeam`, or `evalgate`.

## Human-only checkpoints

Stop and report rather than faking: GitHub auth loss, a Cloudflare account/token for a real
deploy, Workers Paid for Queues, or a domain. Everything else should run locally with the
documented Miniflare fallback.

## Definition of done

The release gate in `docs/master-plan.md` §7 plus the project checklist in
`docs/plan.md` §9: local-first build, green CI, 1,000-click exactness, privacy notes, cost
model, walkthrough, `v1.0.0` tagged and pushed, repo public with topics, and the parent
`ai-engineering-pivot/progress/log.md` updated.
