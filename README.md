# Studio Bars

English lyric-writing studio for Hip-Hop, R&B, House and Pop (working title). Local-first; Royal Blue & Amber design with a yellow ruled writing pad.

**Status: Phases 0-8 built (core sets); see HANDOVER.md and docs/RELEASE_CHECKLIST.md for what is and is not tested.** Lyric editor with locked lines, autosave, history, notes, import/export, a built-in music player with personal playlists, A–B loops, pitch-preserving speed and music linked to songs, offline pronunciation and rhyme tools (estimated syllables, rhyme colours, a rhyme finder with filters, your own word pronunciations), a word-meaning dictionary and thesaurus (WordNet), a personal phrase and slang bank, and an optional online word helper that is off by default. An optional AI co-writer (Claude, or a free local model) that only suggests lines: you choose Insert or Replace, locked lines are never touched, and a monthly spending limit applies. See `docs/planning/STUDIO_BARS_MASTER_BUILD_PLAN.md` for the full plan and `HANDOVER.md` for current state.

## Run it
Needs Node 22 LTS and Python 3.11+ (Git for cloning).

- Linux/macOS: `./scripts/dev.sh`
- Windows (PowerShell): `.\scripts\dev.ps1` *(untested on Windows so far)*

Then open http://localhost:5173. Backend API: http://localhost:8000/health (docs at http://localhost:8000/docs).

Your songs are stored in `data/private/studio_bars.db` and your imported music in `data/media/` on the computer running the backend. Both folders are git-ignored and nothing is uploaded anywhere.

Music: click **♪ Library** at the bottom, tick the consent box, and add audio files (mp3, wav, flac, ogg, opus, m4a, aac). Words tab: meanings, synonyms (with a warning when a word's meaning may shift), opposites and imagery from WordNet; "My phrases" is your own slang bank; "Online ideas" is optional and off until you switch it on.

Rhymes: tap a line (or select one word) and open the **Rhymes** tab. Everything works offline. Pronunciation data: CMU Pronouncing Dictionary (see `licenses/`).

Playback shortcuts (only when you are not typing): Space play/pause, ←/→ seek 5 s, `[` set loop start, `]` set loop end, `\` clear loop, M mute.

## Check everything
`./scripts/check.sh` (lint, formatting, type-check, unit tests, build).

`./scripts/e2e.sh` runs the browser acceptance test against a throwaway database (needs Playwright's Chromium).

## Privacy
Never commit `.env`, lyrics, databases or audio. See `.gitignore` and `docs/planning/GITHUB_WORKFLOW.md`.

## Credits
- Pronunciations: CMU Pronouncing Dictionary, Carnegie Mellon University.
- Meanings and word relations: WordNet 3.0, Princeton University (licence in `licenses/wordnet-LICENSE.txt`).
- Word familiarity (optional): derived from `wordfreq` (CC BY-SA 4.0), see `licenses/wordfreq-NOTICE.txt`.
- Optional online helper: this app uses the Datamuse API (https://www.datamuse.com/api/).

## Using it on a phone or tablet (same Wi-Fi)
On the computer that holds your songs: `STUDIO_BARS_ACCESS_PIN=123456 ./scripts/serve.sh` (Windows: `$env:STUDIO_BARS_ACCESS_PIN="123456"; .\scripts\serve.ps1`). Open the address it prints on your phone, enter the PIN, then use the browser's "Add to home screen". The computer must stay on. See `docs/decisions/0002-phone-access.md`.
