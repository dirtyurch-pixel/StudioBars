# Studio Bars: brief for an outside reviewer

Studio Bars is a lyric-writing studio for Hip-Hop, R&B, House and Pop. It has a Royal Blue & Amber design and a yellow
"legal pad" editor. Please give honest criticism: what is weak, risky, confusing or missing. Praise is not needed.

- Code: https://github.com/dirtyurch-pixel/StudioBars (branch `claude/new-session-q0jfb4`)
- Try the phone version (no install, works offline): https://dirtyurch-pixel.github.io/StudioBars/
- Owner's situation: one person, mostly on a phone. Wants an app that works on its own on the phone, plus a PC version,
  with sync between them later.

## Two versions, one codebase
| | PC version | Phone version |
|---|---|---|
| UI | React 18 + TypeScript + Vite | the same React app, built with `VITE_LOCAL=1` |
| Data | FastAPI + SQLite (`backend/`), 10 migrations | IndexedDB in the browser (`frontend/src/local/`) |
| Hosting | runs on the user's computer (Windows `.bat` launchers) | static files on GitHub Pages, service worker for offline |
| AI key | stored on the computer, never sent to the browser | stored in the browser (user is warned), sent only to Anthropic |

`frontend/src/api.ts` sends each call either to the server or to the local TypeScript port. The phonetics, scan,
craft and AI-prompt logic was ported from Python to TypeScript. "Parity" tests (`frontend/src/local/parity.test.ts`)
check that both give identical output on the same input.

## Features (all built and tested)
- **Editor:** sections and lines, line locks (nothing, including AI, can change a locked line), autosave with
  version checks, history snapshots, line notes, import/export (txt/json), full backup and restore.
- **Music player:** import your own audio files (format sniffing, size and duplicate checks), playlists, shuffle and
  repeat, speed changes with pitch kept, A–B loop, each song remembers its beat and loop. Waveform with tap tempo, beat 1,
  bar lines and snap-loop-to-beat.
- **Words:** CMU pronouncing dictionary, syllable counts, rhyme families coloured per line, rhyme search
  (perfect/near/assonance etc.), custom pronunciations, WordNet meanings, a phrase bank, and an optional online helper
  (Datamuse: off by default, one word at a time).
- **AI co-writer:** Claude via the user's own key, or any OpenAI-compatible server such as Ollama. Suggestions only,
  shown before anything is sent; monthly spending cap; locked lines are protected.
- **Craft:** flow grid (syllables on 8th/16th/triplet slots), alternative takes per line, vault, song plan, cliché,
  repetition and filler scan, structure scan, singability notes, internal rhyme chains, "My style" profile, and a scratch
  vocal recorder.
- **Melody:** a melody sketch on a 16th grid, chords per bar, hum-to-melody, and a lyric-fit check.

## Testing
- Backend: 366 pytest tests, plus ruff.
- Frontend: 238 vitest tests, plus tsc, eslint and prettier.
- Browser: about 15 Playwright suites (`scripts/e2e.sh`) run against the PC version, a PIN-locked phone mode, and the
  standalone phone build. This includes the full music suite on the phone build and a phone-sized screen run.
- AI is tested against local stand-ins (`e2e/fake_ai.cjs`), never the real API. CI runs on GitHub Actions.

## Known weak spots (be tough on these)
1. **Phone data lives only in browser storage.** The browser can clear it, so the app relies on the user making manual
   backups. Music is not included in the backup.
2. **AI key in the browser** (phone version): anyone using that browser could use the key. There is a warning, and the
   key is kept off the page after it is saved, but there is no encryption at rest.
3. **Python and TypeScript copies of the same logic:** parity tests guard them, but every change has to be made twice.
4. **No sync yet** between phone and PC (planned last). The data model has no conflict handling for it yet.
5. **Never tested on real devices** (iPhone/Safari, real Android) or on real Windows; only headless Chromium.
6. **Rhyme quality** is only as good as CMUdict. Slang and made-up words fall back to a spelling-based guess.
7. Big components (`SongEditor.tsx`, `MusicDrawer.tsx`) are getting long.

## Questions for you
1. How does this compare to existing lyric apps (e.g. RhymeZone, Rhymer's Block, Genius-style writers, DAW notepads)?
   What is missing that a working rapper or songwriter would expect?
2. Is "same React app, two storage back ends" a sound design, or would you structure it differently?
3. What is the best way to sync phone (IndexedDB) and PC (SQLite) later, for one user, with offline edits on both?
4. Any security or privacy problems, especially the browser-stored API key and the PIN-locked serving mode?
5. Is the Python/TypeScript duplication worth it, or should the logic live in one place (e.g. TypeScript only)?
6. Which unbuilt features matter most: voice-to-lyrics, training drills, House loop editor, "spelled like" search,
   Windows installer?
7. Is anything in the UI likely to confuse a non-technical user on a phone?

Key places to look: `frontend/src/api.ts`, `frontend/src/local/`, `frontend/src/pages/SongEditor.tsx`,
`frontend/src/music/`, `backend/app/`, `docs/decisions/` (one file per design decision), `scripts/e2e.sh`.
