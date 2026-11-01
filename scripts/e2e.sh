#!/usr/bin/env bash
# Starts both servers on a THROWAWAY database, runs the browser acceptance test, cleans up.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
export STUDIO_BARS_DB="$TMP/e2e.db"
export STUDIO_BARS_MEDIA_DIR="$TMP/media"
export MEDIA_DIR="$TMP/media"
export FAKE_DM="http://127.0.0.1:8765"
# the online word helper points at a local stand-in, so tests never touch the internet
export STUDIO_BARS_DATAMUSE_URL="$FAKE_DM"
export STUDIO_BARS_AUTO_SNAPSHOT_SECONDS=300
cleanup() { kill ${BACK:-} ${FRONT:-} ${FAKE:-} 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
node "$ROOT/e2e/fake_datamuse.cjs" 8765 >"$TMP/fake.log" 2>&1 &
FAKE=$!
cd "$ROOT/backend"
if [ ! -d .venv ]; then python3 -m venv .venv && .venv/bin/pip install -q -r requirements-dev.txt; fi
. .venv/bin/activate
uvicorn app.main:app --port 8000 >"$TMP/back.log" 2>&1 & BACK=$!
cd "$ROOT/frontend"
node node_modules/vite/bin/vite.js --port 5173 --strictPort >"$TMP/front.log" 2>&1 &
FRONT=$!
for i in $(seq 1 40); do
  curl -sf localhost:8000/health >/dev/null && curl -sf localhost:5173 >/dev/null && break
  sleep 0.5
done
cd "$ROOT/e2e"
run() { if [ -d node_modules ]; then node "$1"; else NODE_PATH="${NODE_PATH:-$(npm root -g)}" node "$1"; fi; }
run phase1.cjs
run phase1b.cjs
run phase2.cjs
run phase3.cjs
