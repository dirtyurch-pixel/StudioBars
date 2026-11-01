# Handover

## Current state
- Phase 0 (foundation): done. Phase 1 (editor, locks, autosave, history, notes, import/export): done.
- **Phase 1B (music player, playlists, speed, Writing Session foundation): built, tested here, awaiting owner review.** Phase 2 is NOT started and not authorised.

## How to run / check
- Run: `./scripts/dev.sh` (Windows: `.\scripts\dev.ps1`, not yet run on Windows) then open http://localhost:5173
- Unit + lint + type + build: `./scripts/check.sh`
- Real-browser acceptance tests (both Phase 1 and 1B): `./scripts/e2e.sh` (throwaway database and media folder; needs Playwright Chromium)

## Phase 1B test evidence (Linux container; not Windows, not a phone/tablet)
- Backend: 79 pytest tests (upload validation, fake/corrupt/oversize/chunked files, filename safety, Range streaming, playlists incl. duplicates/reorder, missing-file relink, playback state, song links, leakage checks).
- Frontend: 60 Vitest tests (queue/shuffle/repeat rules, A–B loop rules, player controls, pitch/speed, keyboard guard while typing, compact mode, import consent and per-file reports).
- Browser: 48 Phase 1B checks in real Chromium (plus the 37 Phase 1 checks), run three times in a row with the same result. They import 10 real WAV files plus a damaged WAV, a fake MP3 and a .txt (3 correctly refused), build playlists, play while typing/locking/saving/switching sections/navigating (the audio element is never reloaded), test pause/seek/next/previous/auto-advance/repeat/shuffle/mute, speed 0.85× and 0.75× with pitch preserved, A–B loop (stays inside, wraps, rejects A after B), link music to a song and restore it after reload (paused), delete a file and relink it, phone layout with the player collapsing while typing, and that no network traffic left localhost.

## Known limitations (honest list)
1. **Not tested on a real phone or tablet, and not on Windows.** Phone checks use a phone-sized browser window and a shrunk viewport to imitate the keyboard. Real mobile browsers differ (autoplay rules, background/lock-screen audio, codecs such as FLAC/Opus on iOS).
2. **Browser audio support differs.** The test browser has no MP3/AAC codecs, so the checks used WAV. MP3/M4A/AAC import is validated by the server and by whether *your* browser can play the file; if it cannot, the file is reported and skipped.
3. **Phone/tablet access is still the open decision** (`docs/decisions/0002-phone-access.md`). Music lives on the computer running the backend and does not sync between devices.
4. Titles come from file names (editable). Tag reading and artwork are not included (tag libraries are GPL; artwork skipped).
5. The "play next" queue lasts until the page reloads; the playing playlist is not refreshed if you edit it while it plays.
6. Playlists reorder with ▲▼ buttons, not drag and drop.
7. Audio is not part of backups yet (Phase 7). Deleting a track deletes its copied file.
8. The API still has no sign-in; it listens on this computer only.
9. `dev.ps1` still unrun on Windows; `npm audit` notices not reviewed.
10. Earlier Phase 1 limitations still apply (see git history of this file).

## Bugs found and fixed while testing 1B
- Starting several requests together on a brand-new database could still fail about 1 time in 6 (switching to WAL mode was outside the lock). Fixed; 0 failures in 40 repeats.
- If a track was linked to a song while playing from a playlist, later speed/loop changes were not saved to the link. Fixed.

## Open items for owner
- Phone access model (docs/decisions/0002-phone-access.md)
- Real-device test of typing + music on a phone/tablet once a way to run the app there exists
- Plan fixes proposed earlier: phase numbering, split Phases 5 and 6, add LineTiming/ChordMark tables before they are needed
