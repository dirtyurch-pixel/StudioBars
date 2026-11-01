#!/usr/bin/env bash
# Runs every Phase 0 check. Exits non-zero on first failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
. .venv/bin/activate
ruff check . && ruff format --check . && pytest -q
cd "$ROOT/frontend"
npm run lint && npm run typecheck && npm run format:check && npm test && npm run build
echo "ALL CHECKS PASSED"
