# Phone / tablet mode on Windows: ONE address serves the whole app, protected by a PIN.
# Usage:  $env:STUDIO_BARS_ACCESS_PIN = "123456"; .\scripts\serve.ps1     (NOT yet run on Windows)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $env:STUDIO_BARS_ACCESS_PIN -or $env:STUDIO_BARS_ACCESS_PIN.Length -lt 6) {
  Write-Host 'Set a PIN of at least 6 characters first, for example:  $env:STUDIO_BARS_ACCESS_PIN = "123456"'
  exit 1
}
$port = if ($env:PORT) { $env:PORT } else { "8000" }
Set-Location "$root\frontend"
if (-not (Test-Path node_modules)) { npm ci }
$env:VITE_API_URL = ""
npm run build
Set-Location "$root\backend"
if (-not (Test-Path .venv)) { python -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install -q -r requirements-dev.txt
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "Open this on your phone or tablet (same Wi-Fi):  http://${ip}:$port"
Write-Host "Sign in with your PIN. Press Ctrl+C to stop."
$env:STUDIO_BARS_SERVE_FRONTEND = "$root\frontend\dist"
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port $port
