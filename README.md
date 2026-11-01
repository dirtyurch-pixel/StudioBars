# Studio Bars

English lyric-writing studio for Hip-Hop, R&B, House and Pop (working title). Local-first; Royal Blue & Amber design with a yellow ruled writing pad.

**Status: Phase 0 (foundation only).** No editor or features yet. See `docs/planning/STUDIO_BARS_MASTER_BUILD_PLAN.md` for the full plan and `HANDOVER.md` for current state.

## Run it
Needs Node 22 LTS and Python 3.11+ (Git for cloning).

- Linux/macOS: `./scripts/dev.sh`
- Windows (PowerShell): `.\scripts\dev.ps1` *(untested on Windows so far)*

Then open http://localhost:5173 — it should say "Backend OK". Backend API: http://localhost:8000/health

## Check everything
`./scripts/check.sh` (lint, formatting, type-check, tests, build).

## Privacy
Never commit `.env`, lyrics, databases or audio. See `.gitignore` and `docs/planning/GITHUB_WORKFLOW.md`.
