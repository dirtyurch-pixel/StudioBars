#!/usr/bin/env bash
# Phone / tablet mode: ONE address serves the whole app, protected by a PIN.
# Usage: STUDIO_BARS_ACCESS_PIN=123456 ./scripts/serve.sh      (then open the printed address on your phone)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${STUDIO_BARS_ACCESS_PIN:-}" ]; then
  echo "Set a PIN first, for example:  STUDIO_BARS_ACCESS_PIN=123456 ./scripts/serve.sh" >&2
  echo "(Without a PIN anyone on your Wi-Fi could read your lyrics, so this script refuses to start.)" >&2
  exit 1
fi
if [ "${#STUDIO_BARS_ACCESS_PIN}" -lt 6 ]; then echo "Use a PIN of at least 6 characters." >&2; exit 1; fi
PORT="${PORT:-8000}"
cd "$ROOT/frontend"
[ -d node_modules ] || npm ci
VITE_API_URL="" npm run build
cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements-dev.txt
IP="$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || echo localhost) | awk '{print $1}')"
echo
echo "Open this on your phone or tablet (same Wi-Fi):  http://$IP:$PORT"
echo "Sign in with your PIN. Press Ctrl+C here to stop."
echo
STUDIO_BARS_SERVE_FRONTEND="$ROOT/frontend/dist" exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
