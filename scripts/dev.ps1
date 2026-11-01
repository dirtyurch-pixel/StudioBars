# Windows PowerShell: starts backend (8000) and frontend (5173). Ctrl+C stops the frontend; close the backend window after.
# NOTE: written in Phase 0 but NOT yet run on Windows (built in a Linux container).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\backend"
if (-not (Test-Path .venv)) { py -3 -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install -q -r requirements-dev.txt
$backend = Start-Process -PassThru -FilePath ".\.venv\Scripts\python.exe" `
  -ArgumentList "-m","uvicorn","app.main:app","--port","8000"
try {
  Set-Location "$root\frontend"
  if (-not (Test-Path node_modules)) { npm ci }
  npm run dev
} finally {
  if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id }
}
