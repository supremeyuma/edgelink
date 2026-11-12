$ErrorActionPreference = "Stop"

$Base = if ($env:BENCH_URL) { $env:BENCH_URL } else { "http://127.0.0.1:8787" }
$Token = if ($env:ADMIN_TOKEN) { $env:ADMIN_TOKEN } else { "local-admin-token" }
$Auth = "Authorization: Bearer $Token"

function Assert-Equal {
  param([string]$What, $Expected, $Actual)
  if ("$Expected" -ne "$Actual") {
    throw "$What failed: expected '$Expected', got '$Actual'"
  }
  Write-Host "  ok  $What = $Actual"
}

function StatusOf {
  param([string]$Path, [string[]]$Headers = @())
  $curlArgs = @("-s", "-o", "NUL", "-w", "%{http_code}", "$Base$Path")
  foreach ($header in $Headers) { $curlArgs += @("-H", $header) }
  return (& curl.exe @curlArgs)
}

Write-Host "== health =="
$health = (& curl.exe -s "$Base/healthz")
if ($health -notmatch '"status":"ok"') { throw "health failed: $health" }
Write-Host "  ok  $health"

Write-Host "== seed demo links =="
pnpm exec tsx scripts/seed.ts

Write-Host "== cap matrix (max_clicks=2) =="
$adminHeaders = @{ Authorization = "Bearer $Token" }
$capSlug = "cap-" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$capBody = '{"slug":"' + $capSlug + '","target":"https://example.com/cap","max_clicks":2}'
$null = Invoke-RestMethod -Method Post -Uri "$Base/v1/links" -Headers $adminHeaders -ContentType "application/json" -Body $capBody
$capStatuses = @()
for ($i = 0; $i -lt 3; $i++) { $capStatuses += (StatusOf "/$capSlug") }
Assert-Equal "cap status sequence" "302 302 410" ($capStatuses -join " ")

Write-Host "== patch visible on next request =="
$patchBody = '{"target":"https://example.com/alpha-v2"}'
$null = Invoke-RestMethod -Method Patch -Uri "$Base/v1/links/demo-alpha" -Headers $adminHeaders -ContentType "application/json" -Body $patchBody
$headers = ((& curl.exe -s -o NUL -D - "$Base/demo-alpha") -join "`n")
if ($headers -notmatch "(?im)^location:\s*https://example\.com/alpha-v2") {
  throw "patch not visible immediately"
}
Write-Host "  ok  Location = https://example.com/alpha-v2"

Write-Host "== generate 1,000 clicks =="
pnpm exec tsx scripts/load-clicks.ts
Start-Sleep -Seconds 8

Write-Host "== backfill (includes current partial hour for the demo) =="
$backfill = Invoke-RestMethod -Method Post -Uri "$Base/v1/admin/backfill?hours=2&include_current=1" -Headers $adminHeaders
Write-Host ($backfill | ConvertTo-Json -Compress)

Write-Host "== analytics =="
$analytics = Invoke-RestMethod -Uri "$Base/v1/links/demo-alpha/analytics?days=1" -Headers $adminHeaders
if ($analytics.totals.clicks -le 0) { throw "analytics clicks were zero" }
Write-Host "  ok  clicks=$($analytics.totals.clicks) uniques=$($analytics.totals.uniques) bots=$($analytics.totals.bots)"
Write-Host "  ok  top referrer=$($analytics.top_referrers[0].name) device=$($analytics.device_split[0].name)"

Write-Host "== cron triggers =="
Assert-Equal "hourly cron" 200 (StatusOf "/__scheduled?cron=0+*+*+*+*")
Assert-Equal "daily cron" 200 (StatusOf "/__scheduled?cron=15+3+*+*+*")

Write-Host "== burst isolation =="
pnpm exec tsx scripts/burst.ts

Write-Host "== privacy: no raw IP in click_events =="
$sql = "SELECT COUNT(*) AS raw FROM click_events WHERE ip_hash LIKE '203.0.113.%'"
$rawJson = (& pnpm exec wrangler d1 execute edgelink --local --json --command $sql)
$rawCount = ($rawJson | ConvertFrom-Json)[0].results[0].raw
Assert-Equal "raw IP rows" 0 $rawCount

Write-Host "WALKTHROUGH PASSED"
