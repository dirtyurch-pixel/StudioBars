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
# the AI co-writer talks to a local stand-in (never the real Claude), and its key file goes in the throwaway folder
export FAKE_AI="http://127.0.0.1:8766"
export STUDIO_BARS_AI_ANTHROPIC_URL="$FAKE_AI"
export STUDIO_BARS_AI_KEY_DIR="$TMP/private"
unset ANTHROPIC_API_KEY STUDIO_BARS_AI_KEY
cleanup() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "=== e2e failed (exit $code): backend log tail ==="; tail -40 "$TMP/back.log" 2>/dev/null || true
    echo "=== fake online service log ==="; tail -5 "$TMP/fake.log" 2>/dev/null || true
  fi
  kill ${PREVIEW:-} ${PHONE:-} ${BACK:-} ${FRONT:-} ${FAKE:-} ${FAKEAI:-} 2>/dev/null || true; rm -rf "$TMP"
}
trap cleanup EXIT
node "$ROOT/e2e/fake_datamuse.cjs" 8765 >"$TMP/fake.log" 2>&1 &
FAKE=$!
node "$ROOT/e2e/fake_ai.cjs" 8766 >"$TMP/fakeai.log" 2>&1 &
FAKEAI=$!
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
# phone/tablet mode: the built app served by the backend on ONE address, locked with a PIN (separate throwaway database)
cd "$ROOT/frontend"
VITE_API_URL="" node node_modules/vite/bin/vite.js build --outDir "$TMP/web" --emptyOutDir >"$TMP/build.log" 2>&1
cd "$ROOT/backend"
STUDIO_BARS_DB="$TMP/phone.db" STUDIO_BARS_ACCESS_PIN=246810 STUDIO_BARS_SERVE_FRONTEND="$TMP/web" \
  uvicorn app.main:app --host 127.0.0.1 --port 8100 >"$TMP/phone.log" 2>&1 & PHONE=$!
for i in $(seq 1 40); do curl -sf localhost:8100/health >/dev/null && break; sleep 0.5; done
# the independent phone version: plain files, NO server; songs live in the browser
cd "$ROOT/frontend"
VITE_LOCAL=1 VITE_BASE=/StudioBars/ node node_modules/vite/bin/vite.js build --outDir "$TMP/phone-local" --emptyOutDir >"$TMP/build-local.log" 2>&1
node node_modules/vite/bin/vite.js preview --outDir "$TMP/phone-local" --base /StudioBars/ --port 4174 --strictPort >"$TMP/preview.log" 2>&1 & PREVIEW=$!
for i in $(seq 1 40); do curl -sf http://127.0.0.1:4174/StudioBars/ >/dev/null && break; sleep 0.5; done
cd "$ROOT/e2e"
run() { if [ -d node_modules ]; then node "$1"; else NODE_PATH="${NODE_PATH:-$(npm root -g)}" node "$1"; fi; }
run phase1.cjs
run phase1b.cjs
run phase2.cjs
run phase3.cjs
run phase4.cjs
run phase5.cjs
run phase6.cjs
run phase8.cjs
run phase7.cjs
run phone_local.cjs
run phone_words.cjs
