# Walkthrough (observed, 2026-11-12)

Command: `pnpm dev` (with `--test-scheduled`) in one terminal, then `pnpm run walkthrough`.
This is a local Miniflare run; there is no deployed URL.

```text
== health ==
  ok  {"status":"ok"}
== seed demo links ==
created http://127.0.0.1:8787/demo-alpha
created http://127.0.0.1:8787/demo-beta
created http://127.0.0.1:8787/demo-gamma
== cap matrix (max_clicks=2) ==
  ok  cap status sequence = 302 302 410
== patch visible on next request ==
  ok  Location = https://example.com/alpha-v2
== generate 1,000 clicks ==
{
  "event": "load_clicks",
  "total": 1000,
  "statuses": {
    "302": 1000
  }
}
== backfill (includes current partial hour for the demo) ==
{"ok":true,"hours":2,"include_current":true,"buckets":[1794499200,1794502800,1794506400]}
== analytics ==
  ok  clicks=337 uniques=208 bots=87
  ok  top referrer=direct device=desktop
== cron triggers ==
  ok  hourly cron = 200
  ok  daily cron = 200
== burst isolation ==
{
  "event": "burst",
  "requested": 500,
  "statuses": {
    "302": 33,
    "429": 467
  },
  "retryAfterSeen": true,
  "otherIpStatus": 302
}
== privacy: no raw IP in click_events ==
  ok  raw IP rows = 0
WALKTHROUGH PASSED
```

## Notes on what was observed

- **Cap exactness:** three requests against `max_clicks = 2` produced `302, 302, 410`.
- **Immediate update:** a PATCH to `demo-alpha` was visible on the very next request
  (`Location: https://example.com/alpha-v2`, `X-Cache: HIT`).
- **1,000 clicks:** all 1,000 redirects returned 302. Queue consumer logs showed batches of
  100 inserted with `duplicates: 0`. After an 8-second drain wait, analytics reported 337
  clicks for `demo-alpha` (one of three links plus earlier traffic), 208 hourly uniques, and
  87 bots (the load script uses `curl` for every fourth request).
- **Cron:** both the hourly rollup and the daily maintenance handlers returned 200 through
  `/__scheduled`. Daily maintenance logged 602 reconciliation mismatches — these are bench
  links created by `pnpm bench` whose clicks were never clicked again; the log is expected and
  does not auto-correct `links.clicks`.
- **Burst:** 33 requests were allowed and 467 rejected with `429` and a positive `Retry-After`;
  the second IP received a 302. The allowed count exceeds the burst of 30 because the bucket
  refills one token per second (60/minute) during the run.
- **Privacy:** `SELECT COUNT(*) ... WHERE ip_hash LIKE '203.0.113.%'` returned 0 — no raw
  address was stored.

## Dashboard

`pnpm --filter edgelink-dashboard dev` served <http://localhost:3002> with HTTP 200 and the
"EdgeLink · edge analytics" markup. The dashboard reads the analytics API with the admin token
from `sessionStorage`; `next build` produces a static export in `dashboard/out/`.

## Not captured

- No deployed latency numbers or live URL: no Cloudflare account/Workers Paid was available.
- No `docs/demo.gif`: recording a GIF was not part of the local toolchain; the script above is
  the reproducible substitute. See the deferred list in `docs/roadmap.md`.
