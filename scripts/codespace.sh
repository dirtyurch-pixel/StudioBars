#!/usr/bin/env bash
# Runs Studio Bars inside a GitHub Codespace. The forwarded port is PRIVATE (only you, signed in to GitHub, can open it).
# Never make port 8000 public: the app has no accounts of its own unless STUDIO_BARS_ACCESS_PIN is set.
# While the first build runs (a few minutes) a small "still building" page is served on the same port.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
if [ ! -f "$ROOT/frontend/dist/index.html" ] || [ ! -d "$ROOT/backend/.venv" ]; then
  HOLD="$(mktemp -d)"
  cat > "$HOLD/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10"><title>Studio Bars</title>
<body style="font:18px system-ui;background:#09152e;color:#f8faff;padding:32px">
<h1>Studio Bars is building…</h1><p>The first start takes about 3 to 5 minutes. This page refreshes by itself.</p></body>
HTML
  python3 -m http.server "$PORT" --directory "$HOLD" >/dev/null 2>&1 &
  HOLD_PID=$!
  ( set -e
    cd "$ROOT/frontend" && npm ci && VITE_API_URL="" npm run build
    cd "$ROOT/backend" && { [ -d .venv ] || python3 -m venv .venv; } && .venv/bin/pip install -q -r requirements-dev.txt
  ) || { echo "Build failed. See the lines above." >&2; sleep 86400; exit 1; }
  kill "$HOLD_PID" 2>/dev/null; sleep 1
fi
cd "$ROOT/backend"
STUDIO_BARS_SERVE_FRONTEND="$ROOT/frontend/dist" exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
