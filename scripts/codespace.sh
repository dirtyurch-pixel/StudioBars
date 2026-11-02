#!/usr/bin/env bash
# Runs Studio Bars inside a GitHub Codespace. The forwarded port is PRIVATE (only you, signed in to GitHub, can open it).
# Never make port 8000 public: the app has no accounts of its own unless STUDIO_BARS_ACCESS_PIN is set.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
setup() {
  cd "$ROOT/frontend" && npm ci && VITE_API_URL="" npm run build
  cd "$ROOT/backend" && { [ -d .venv ] || python3 -m venv .venv; } && .venv/bin/pip install -q -r requirements-dev.txt
}
if [ "${1:-}" = "--setup" ]; then setup; exit 0; fi
[ -f "$ROOT/frontend/dist/index.html" ] && [ -d "$ROOT/backend/.venv" ] || setup
cd "$ROOT/backend"
STUDIO_BARS_SERVE_FRONTEND="$ROOT/frontend/dist" exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
