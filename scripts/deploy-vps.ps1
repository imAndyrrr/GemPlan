<#
  Deploy the gateway to the VPS.

  A git push is NOT a deployment: the VPS runs /home/Haneaki/gemplan directly.
  This script copies the runtime files, restarts the service, and refuses to
  report success unless the service is active and /login answers 200.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\deploy-vps.ps1
#>
param(
  [string]$Key = "C:\Users\imAndyrrr\.ssh\gcp_key",
  [string]$Target = "Haneaki@34.3.98.99",
  [string]$RemoteDir = "/home/Haneaki/gemplan",
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
  if (-not $SkipTests) {
    Write-Host "[1/4] syntax check"
    npm run check
    if ($LASTEXITCODE -ne 0) { throw "npm run check failed" }
  }

  Write-Host "[2/4] backing up the current VPS files"
  ssh -i $Key $Target "cd $RemoteDir && cp -f api/audit-log-store.js api/audit-log-store.js.prev && cp -f src/worker.js src/worker.js.prev"
  if ($LASTEXITCODE -ne 0) { throw "backup on VPS failed" }

  Write-Host "[3/4] uploading runtime files"
  foreach ($file in @("api/audit-log-store.js", "api/handler.js", "api/server.js", "api/vercel-kv.js", "api/vercel-runtime.js", "src/worker.js", "src/responses-stream.js")) {
    scp -i $Key $file "${Target}:${RemoteDir}/$file"
    if ($LASTEXITCODE -ne 0) { throw "upload failed: $file" }
  }

  Write-Host "[4/4] restarting and checking health"
  ssh -i $Key $Target "cd $RemoteDir && node --check api/audit-log-store.js && node --check src/worker.js && sudo systemctl restart gemplan && sleep 4 && systemctl is-active gemplan && curl -s -o /dev/null -w 'login HTTP %{http_code} in %{time_total}s\n' http://127.0.0.1:8000/login"
  if ($LASTEXITCODE -ne 0) { throw "health check failed - inspect: ssh -i $Key $Target 'journalctl -u gemplan -n 50 --no-pager'" }

  Write-Host "DEPLOYED. Remember: the browser may still hold the old page; hard-refresh with Ctrl+F5."
}
finally {
  Pop-Location
}
