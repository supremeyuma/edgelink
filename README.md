# EdgeLink

> An edge-deployed short-link service with click analytics that stay accurate under abuse,
> bots, and burst traffic.

**Status:** Phase G0 complete — tooling, bindings, tests, and CI are green. Build continues in
`docs/roadmap.md`.

**Stack:** TypeScript · Hono · Cloudflare Workers · Wrangler · D1 · KV · Queues · Cron ·
Durable Objects · Vitest workers pool · Next.js dashboard

## Start here

1. [`AGENTS.md`](AGENTS.md) — build contract, parallel port reservations, and first steps.
2. [`docs/spec.md`](docs/spec.md) — the product spec and milestones.
3. [`docs/plan.md`](docs/plan.md) — phase-by-phase execution plan with gates and tests.
4. [`docs/master-plan.md`](docs/master-plan.md) — shared conventions and release gate.
5. [`docs/roadmap.md`](docs/roadmap.md) — phase checkboxes and evidence.

The repository bootstrap (folder, git, license, remote) is already done. Begin with the
Phase G0 tooling tasks in `docs/plan.md`, then Phase G1.

## License

MIT
