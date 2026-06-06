# Re-enable licensing on Railway after management demo.
# Prerequisites: railway login + railway link (backend service)

$ErrorActionPreference = "Stop"

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  Write-Error "Railway CLI not found. Run: npm install -g @railway/cli"
}

railway whoami 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Run: railway login"
  Write-Host "Then: railway link"
  exit 1
}

Write-Host "Setting LICENSE_ENFORCEMENT=true on Railway..."
railway variables --set "LICENSE_ENFORCEMENT=true"

Write-Host "Redeploying backend..."
Push-Location "$PSScriptRoot\..\backend"
try {
  railway up --detach
} finally {
  Pop-Location
}

Write-Host "Licensing re-enabled."
