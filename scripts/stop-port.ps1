param(
  [ValidateRange(1, 65535)]
  [int]$Port = 14100
)

$ErrorActionPreference = "Stop"

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
$processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)

foreach ($processId in $processIds) {
  if ($processId -le 0) {
    continue
  }

  $processName = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
  Write-Host ("Stopping the old process on port {0}: PID {1} ({2})" -f $Port, $processId, $processName)
  Stop-Process -Id $processId -Force
}

$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  $remainingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $remainingListener) {
    exit 0
  }

  Start-Sleep -Milliseconds 200
}

throw "Port $Port is still in use after waiting 10 seconds."
