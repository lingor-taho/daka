$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

& npm.cmd ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& npm.cmd run check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
