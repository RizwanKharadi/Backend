# Disable licensing on Railway for management demo.
#
# Option A — Railway CLI (after login):
#   railway login
#   cd backend; railway link
#   .\scripts\railway-demo-licensing.ps1
#
# Option B — Railway dashboard (no CLI):
#   1. Open https://railway.com → your project → backend service → Variables
#   2. Set LICENSE_ENFORCEMENT = false
#   3. Click Redeploy / Deploy latest
#   4. Deploy updated backend code (railway up, or push to connected repo)
#
# Option C — Project token (CI / non-interactive):
#   $env:RAILWAY_TOKEN = "<project-token-from-railway-settings>"
#   cd backend; railway link <project-id>
#   .\scripts\railway-demo-licensing.ps1
#
# After demo: .\scripts\railway-restore-licensing.ps1

$ErrorActionPreference = "Stop"

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Railway CLI..."
  New-Item -ItemType Directory -Force -Path "$env:APPDATA\npm" | Out-Null
  npm install -g @railway/cli
}

Write-Host "Checking Railway auth..."
railway whoami 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0 -and -not $env:RAILWAY_TOKEN) {
  Write-Host ""
  Write-Host "Railway CLI is not authenticated."
  Write-Host "Manual steps (fastest for demo):"
  Write-Host "  1. Railway dashboard -> backend service -> Variables"
  Write-Host "  2. LICENSE_ENFORCEMENT = false"
  Write-Host "  3. Redeploy backend with latest code (commit c7ec194)"
  Write-Host ""
  Write-Host "Or run: railway login"
  Write-Host "Then: cd backend; railway link"
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
