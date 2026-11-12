$ErrorActionPreference = "Stop"

function Invoke-Step {
  param([string]$Name, [scriptblock]$Action)
  Write-Host "== $Name =="
  & $Action
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Step failed: $Name (exit $LASTEXITCODE)"
    exit $LASTEXITCODE
  }
}

Invoke-Step "format" { pnpm exec prettier --check . }
Invoke-Step "lint" { pnpm exec eslint . }
Invoke-Step "typecheck" { pnpm exec tsc --noEmit }
Invoke-Step "tests" { pnpm exec vitest run }
Invoke-Step "deploy dry-run" { pnpm exec wrangler deploy --dry-run --outdir dist }

Write-Host "ALL CHECKS PASSED"
