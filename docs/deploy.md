# Deploying EdgeLink

The repository is built and tested locally with Miniflare. A real deploy needs a Cloudflare
account, an API token, and the **Workers Paid** plan for Queues. As of `v1.0.0` no account was
connected, so the live URL is **deferred** — this page is the exact, tested procedure.

## 1. Create the Cloudflare resources

```powershell
pnpm exec wrangler login
pnpm exec wrangler d1 create edgelink
pnpm exec wrangler kv namespace create LINKS_KV
pnpm exec wrangler queues create edgelink-clicks
pnpm exec wrangler queues create edgelink-clicks-dlq
```

Copy the printed IDs into `wrangler.jsonc`:

- `d1_databases[0].database_id`
- `kv_namespaces[0].id`

The queue names already match `wrangler.jsonc`.

## 2. Set the secrets

```powershell
pnpm exec wrangler secret put ADMIN_TOKEN
pnpm exec wrangler secret put IP_HASH_SALT
```

`IP_HASH_SALT` should be a long random value. Rotate it monthly and record the rotation date;
see `docs/security.md`.

## 3. Apply migrations and deploy

```powershell
pnpm exec wrangler d1 migrations apply edgelink --remote
pnpm exec wrangler deploy
```

`wrangler deploy` prints the Worker URL. Verify:

```powershell
curl.exe -i https://<worker-url>/healthz
curl.exe -i https://<worker-url>/readyz
```

## 4. CI deploy (optional)

Add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then run the
**Deploy** workflow manually. The workflow applies remote migrations and deploys. Without the
token it prints a deferral notice and does not fail CI.

## 5. Dashboard hosting (optional)

The dashboard is a static export:

```powershell
pnpm --filter edgelink-dashboard build
```

Upload `dashboard/out/` to Cloudflare Pages or any static host. Set
`NEXT_PUBLIC_API_BASE=https://<worker-url>` at build time so the browser calls the deployed
API. The admin token is entered by the operator and kept in `sessionStorage`; it is never baked
into the bundle.

## What was verified locally

- `pnpm run verify` (typecheck, lint, tests, OpenAPI freshness, dashboard build, deploy
  dry-run).
- Full `wrangler dev` walkthrough including queues, cron, rollups, and the 1,000-click test.

## What remains human-only

- Creating the Cloudflare account/resources above.
- Providing the API token and Workers Paid plan.
- Recording deployed latency numbers (replace the local Miniflare numbers in
  `docs/bench/README.md`).
