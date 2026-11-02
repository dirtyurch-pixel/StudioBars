# 0011: Independent phone app (steps 1 to 3 of 4)

Status: steps 1, 2 and 3 built; awaiting owner review.

The owner wants a phone app that works on its own and syncs with the PC later. Earlier work made the phone a window onto
a server; that was the wrong default and is corrected here.

## How it works
- The same React app is built in "phone mode" (`VITE_LOCAL=1`). In that mode `src/api.ts` sends song calls to
  `src/local/localApi.ts` instead of a server, and every other call fails politely ("not in the phone version yet").
- Songs, notes, locks and history are stored in the browser's own database (IndexedDB) **on the device**. Nothing is sent
  anywhere. Saves are serialised with Web Locks so two open tabs cannot mix changes.
- The rules are the PC rules, ported from `backend/app/service.py`: locked lines can never change or disappear, a save
  from a stale copy is refused (409), restores will not overwrite locked lines, imports always create a new song,
  automatic snapshots at most every 5 minutes.
- Text/Markdown/JSON import and export are a line-for-line port of `backend/app/textio.py`, so files move between the
  PC and phone versions unchanged.
- **Back up all songs / Restore a backup** on the songs page (one JSON file). Restoring adds songs as new; it never
  overwrites. The app asks the browser to keep its data (`navigator.storage.persist()`); browsers may still refuse.
- Published by `.github/workflows/pages.yml` to `https://dirtyurch-pixel.github.io/StudioBars/` (needs Pages turned on).

## Step 1 includes
Songs list, new song, writing pad, sections, locked lines, notes, undo/redo, autosave, history and restore,
import (txt/md/json), export, backup/restore, works offline, installable to the home screen.

## Step 2 includes (rhymes and words on the device)
- Syllable counts in the margin, rhyme colours, the Rhymes tab (all filters incl. part of speech, your own
  pronunciations, phrase rhymes) and the Words tab (meanings, synonyms, the phrase bank).
- The Python rhyme/word code is ported to TypeScript (`src/local/phonetics`, `src/local/lexicon`, `src/local/localWords.ts`).
  `parity.test.ts` checks the phone code gives the SAME answers as the PC code on real data (fixture made by
  `scripts/make_phone_parity.py`).
- The dictionaries are copied unmodified into the phone build (`frontend/phone-data.mjs`) with their licences:
  CMU dictionary and the familiarity list (~1.2 MB to download) are stored for offline use when the app is first opened;
  WordNet (~8 MB) downloads the first time the Words tab or the part-of-speech filter is used, then works offline.
- The optional online helper (Datamuse) works on the phone too, calling api.datamuse.com straight from the browser
  (Datamuse allows this). Same rules as the PC: OFF by default, only the one word you look up is sent, no cookies,
  4-second timeout, rate limit, answers saved on the device for 7 days, saved answers shown when the service is down.
  Added on the owner's request: "Sounds like" (`sl`) results, and autocomplete in the lookup boxes (`/sug`) that runs
  only while you type in that box with the helper on, waits for a 300 ms pause, and saves answers.
  "Spelled like" (`sp`) is not offered: it needs wildcard patterns, not a single word.
  Datamuse: 100,000 free requests a day today; an API key is announced from 1 February 2027.
- The database moved to version 3 (adds your pronunciations, phrases, settings and saved online answers); songs from step 1 are kept (tested).

## Step 3 includes (AI, Craft and Melody on the device)
- The AI co-writer runs on the phone and calls Claude directly with the official SDK (`@anthropic-ai/sdk` 0.134.0,
  browser mode, loaded only when the AI is used). Same rules as the PC: preview before sending, the exact prompt text,
  monthly limit checked before every request, locked lines read-only, answers checked and numbers worked out on the phone.
  The AI wording (rules, tasks, helper styles, models, prices) is copied from the PC version into `src/local/ai/promptData.json`;
  a backend test fails if the copy drifts.
- **Where the key lives:** in this browser's database on this device (never in Git, never shown back except its last
  4 characters, only ever sent to Anthropic). IMPORTANT: every GitHub Pages site under `dirtyurch-pixel.github.io`
  shares one browser storage area, so any other Pages site published from this account could read it. Use a key with a
  spending limit set at console.anthropic.com, and remove it in the AI tab if you publish other Pages sites.
- Craft (flow grid, takes, vault, plan and ideas, scans and rhyme chains, My style), Melody (notes, chords, humming, lyric fit)
  and scratch vocal recording run on the phone; recordings are stored in the browser's database on the device.
- `parity.test.ts` now also checks the scans, rhyme chains, syllable stress, the AI prompt and the AI-answer checks against
  the PC version (14 comparisons, all identical).

## Music player on the phone
- The same player as the PC (library, playlists with repeats, play/pause/next/previous, repeat, shuffle, speed with
  pitch kept, A–B loop, songs remembering their music, loop and speed). Audio files are copied into the browser's
  database on the device (`src/local/music.ts`, same checks as `backend/app/music.py`: real-format sniffing, size limit,
  duplicates noticed). Music is not part of "Back up all songs" and is not shared with the PC; add it on each device.
- Tested by running the whole Phase 1B music suite against the phone build (43 checks; the 5 PC-only checks about
  files on disk do not apply).

## Complete backup and restore (reliability phase, step 1)
- "Back up everything" makes ONE `.sbbackup` file (`src/local/archive.ts`): every stored record with its id (songs
  and trash, history, notes, takes, vault, melody, recordings, pronunciations, phrase bank, AI usage, settings),
  plus music, playlists and beat markers unless the writer unticks "Include music". Never included: the AI key, and the
  cache of online word answers. Layout: `SBARCH01`, manifest length, manifest JSON, then the audio files, each with
  a SHA-256.
- The app reads its own file back and checks it before saying anything. The message says "Download started",
  not "saved", because the app cannot see where the file ends up. "Last backup made …" is shown on the home screen.
- Restore checks the whole file first (damaged or cut-off files are refused, nothing changes), then:
  "Add what's missing" (anything already on the device is left alone; songs on both keep this device's version), or
  "Replace everything" (the device ends up exactly like the backup; the AI key on this device is kept). Either way
  it is ONE database transaction (all or nothing) and is read back afterwards. Older songs-only `.json` backups can
  still be added.
- Store writes now resolve only when the browser's transaction completes (not when the request is queued), and
  `Store.batch()` writes many records atomically.
- Tested: `archive.test.ts` (including a simulated failure half-way leaving the device unchanged) and
  `e2e/backup_restore.cjs` (real browser, two separate "phones", fake microphone, real audio).

## Waveform and beat markers (PC and phone)
- The player can show the track's waveform (`src/music/Waveform.tsx`, maths in `src/music/wave.ts`). The browser decodes
  the audio once and draws the loudest point of 800 slices; tap it to jump. Files over 80 MB are not drawn (memory on
  phones); beat markers still work. The A–B loop is shaded on it. Switch it on/off with "〰 wave" (remembered per
  browser; off by default on small screens).
- Beat markers: tap along ("Tap", median of the last taps, tempo folded into 40–240 BPM) or type the BPM, then
  "1 here" sets beat 1 at the playhead. Bar lines every 4 beats, live "bar N, beat N", and "Snap loop" moves A and B
  to the nearest beats. Saved per track: PC in `track_beats` (migration 10, `GET/PUT/DELETE
  /api/music/tracks/{id}/beats`), phone in the device's settings store. Deleting a track removes them.
- 4/4 only; no automatic beat detection (tempo is what you tap or type).
- Tested: `e2e/wave_beats.cjs` on the PC version, the phone version, and the phone version on a phone-sized screen.

## Not yet (later steps)
4. Syncing with the PC version (today: move songs with export/backup files).
The PC-only server features (PIN serving mode, server-side files) are not in the phone version.
