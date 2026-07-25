$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$env:NODE_ENV = "production"

if (-not (Test-Path -LiteralPath ".env")) {
  throw "Missing .env. Copy .env.example first and set production credentials and SESSION_SECRET."
}

New-Item -ItemType Directory -Force -Path "storage\database", "storage\uploads", "storage\logs" | Out-Null

& npm.cmd start
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
