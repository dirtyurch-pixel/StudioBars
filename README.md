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

## Try it from a phone with no computer (GitHub Codespaces)
Open https://codespaces.new/dirtyurch-pixel/StudioBars/tree/claude/new-session-q0jfb4 , sign in to GitHub and press "Create codespace". When it has built (a few minutes the first time), open the **Ports** tab and tap the link for port 8000. The link is private to your GitHub account (https, so the microphone works). Never set the port to Public. Your songs live inside that codespace; GitHub stops it after a while and deletes it after inactivity, so export anything you want to keep (Export tab). Free accounts have a monthly allowance of codespace hours.

## Put it on the internet with its own link (Render, optional)
`render.yaml` and the `Dockerfile` let a cloud host run Studio Bars and give you one permanent https address you can add to your phone's home screen. Create a free Render account, then choose **New > Blueprint**, pick this repository and the branch `claude/new-session-q0jfb4`, and enter a PIN (6+ characters) when asked. The container refuses to start without a PIN. **Caveats:** your lyrics then live on Render's servers; on the free plan the app sleeps when idle and **your songs are erased whenever it restarts** (keep them safe with the Export tab); keeping songs needs a paid plan with a disk (see the comments in `render.yaml`). The image build itself could not be tested where this was written (no Docker), only the start-up steps.

## The independent phone app (no computer needed)
A version of Studio Bars that runs entirely on your phone or tablet: songs are saved on the device and it works with no internet. It is published as a web page at **https://dirtyurch-pixel.github.io/StudioBars/** (after GitHub Pages is turned on for this repository: Settings > Pages > Source: GitHub Actions). Open it and use "Add to Home screen". It has the writing pad, locked lines, notes, history, import/export and backup (step 1), plus syllables, rhyme colours, the Rhymes tab, word meanings and the phrase bank working offline (step 2); AI and syncing with the PC version come in later steps. See `docs/decisions/0011-independent-phone-app.md`.
