#!/usr/bin/env bash
# Starts backend (port 8000) and frontend (port 5173). Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements-dev.txt
uvicorn app.main:app --port 8000 &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT
cd "$ROOT/frontend"
[ -d node_modules ] || npm ci
npm run dev
