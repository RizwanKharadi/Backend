# Disable licensing on Railway for management demo.
# Prerequisites: railway login, then from repo root: railway link (select backend service)
#
# Usage:
#   .\scripts\railway-demo-licensing.ps1
# After demo:
#   .\scripts\railway-restore-licensing.ps1

$ErrorActionPreference = "Stop"

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Railway CLI..."
  New-Item -ItemType Directory -Force -Path "$env:APPDATA\npm" | Out-Null
  npm install -g @railway/cli
}

Write-Host "Checking Railway auth..."
railway whoami 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Run: railway login"
  Write-Host "Then: railway link   (select your backend service)"
  exit 1
}

Write-Host "Setting LICENSE_ENFORCEMENT=false on Railway..."
railway variables --set "LICENSE_ENFORCEMENT=false"

Write-Host "Redeploying backend..."
Push-Location "$PSScriptRoot\..\backend"
try {
  railway up --detach
} finally {
  Pop-Location
}

Write-Host "Done. Verify:"
Write-Host '  Invoke-RestMethod "https://web-production-577680.up.railway.app/api/devices/license-status/agent?agentId=test"'
