# Studio Bars

English lyric-writing studio for Hip-Hop, R&B, House and Pop (working title). Local-first; Royal Blue & Amber design with a yellow ruled writing pad.

**Status: Phase 1B (music player and playlists).** Lyric editor with locked lines, autosave, history, notes, import/export, plus a built-in music player with personal playlists, A–B loops, pitch-preserving speed and music linked to songs. No rhyme tools or AI yet. See `docs/planning/STUDIO_BARS_MASTER_BUILD_PLAN.md` for the full plan and `HANDOVER.md` for current state.

## Run it
Needs Node 22 LTS and Python 3.11+ (Git for cloning).

- Linux/macOS: `./scripts/dev.sh`
- Windows (PowerShell): `.\scripts\dev.ps1` *(untested on Windows so far)*

Then open http://localhost:5173. Backend API: http://localhost:8000/health (docs at http://localhost:8000/docs).

Your songs are stored in `data/private/studio_bars.db` and your imported music in `data/media/` on the computer running the backend. Both folders are git-ignored and nothing is uploaded anywhere.

Music: click **♪ Library** at the bottom, tick the consent box, and add audio files (mp3, wav, flac, ogg, opus, m4a, aac). Playback shortcuts (only when you are not typing): Space play/pause, ←/→ seek 5 s, `[` set loop start, `]` set loop end, `\` clear loop, M mute.

## Check everything
`./scripts/check.sh` (lint, formatting, type-check, unit tests, build).

`./scripts/e2e.sh` runs the browser acceptance test against a throwaway database (needs Playwright's Chromium).

## Privacy
Never commit `.env`, lyrics, databases or audio. See `.gitignore` and `docs/planning/GITHUB_WORKFLOW.md`.
