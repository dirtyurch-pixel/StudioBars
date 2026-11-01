# Studio Bars

English lyric-writing studio for Hip-Hop, R&B, House and Pop (working title). Local-first; Royal Blue & Amber design with a yellow ruled writing pad.

**Status: Phase 1 (core editor and saving).** Lyric editor, locked lines, autosave, history, notes, import/export. No music player, rhyme tools or AI yet. See `docs/planning/STUDIO_BARS_MASTER_BUILD_PLAN.md` for the full plan and `HANDOVER.md` for current state.

## Run it
Needs Node 22 LTS and Python 3.11+ (Git for cloning).

- Linux/macOS: `./scripts/dev.sh`
- Windows (PowerShell): `.\scripts\dev.ps1` *(untested on Windows so far)*

Then open http://localhost:5173. Backend API: http://localhost:8000/health (docs at http://localhost:8000/docs).

Your songs are stored in `data/private/studio_bars.db` on the computer running the backend (never committed to Git).

## Check everything
`./scripts/check.sh` (lint, formatting, type-check, unit tests, build).

`./scripts/e2e.sh` runs the browser acceptance test against a throwaway database (needs Playwright's Chromium).

## Privacy
Never commit `.env`, lyrics, databases or audio. See `.gitignore` and `docs/planning/GITHUB_WORKFLOW.md`.
