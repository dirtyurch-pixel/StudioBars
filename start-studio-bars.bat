@echo off
REM Studio Bars on this Windows computer only (no PIN needed, nothing is shared on the network).
REM NOT yet tested on Windows. Needs Python 3.12+ and Node 20+ installed once.
setlocal
cd /d "%~dp0"
if not exist frontend\node_modules ( pushd frontend & call npm ci & popd )
if not exist backend\.venv ( python -m venv backend\.venv )
call backend\.venv\Scripts\python.exe -m pip install -q -r backend\requirements-dev.txt
set VITE_API_URL=
pushd frontend & call npm run build & popd
set STUDIO_BARS_SERVE_FRONTEND=%~dp0frontend\dist
start "" http://localhost:8000
pushd backend
..\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
popd
