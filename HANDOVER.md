# Handover

## Current state
- Phase 0 (foundation): done, pushed (commit ed1298f).
- **Phase 1 (core editor and saving): built, tested here, awaiting owner review.** Phase 1B is NOT started and not authorised.

## How to run / check
- Run: `./scripts/dev.sh` (Windows: `.\scripts\dev.ps1`, not yet run on Windows) then open http://localhost:5173
- Unit + lint + type + build: `./scripts/check.sh`
- Real-browser acceptance test: `./scripts/e2e.sh` (throwaway database, needs Playwright Chromium)

## Phase 1 test evidence (run in a Linux container, not on Windows or a phone)
- Backend: 51 pytest tests (locks, versions, revisions, comments, import/export, validation, migrations, startup race).
- Frontend: 32 Vitest tests (editing rules, autosave, offline, conflict, lock handling, dashboard states).
- Browser: 37 checks in real Chromium covering the plan's acceptance test: create a song, edit 3 sections, lock 2 lines, try to edit them (blocked), reload, restore a revision, export and import with no loss, plus Focus Mode, undo/redo, paste, offline recovery, two-window conflict, phone-width layout, trash/restore.

## Known limitations (honest list)
1. **Not tested on a real phone or tablet.** The "keyboard does not cover the line" check was simulated by shrinking the browser window. Android keyboards sometimes send Backspace/Enter differently from desktop; the on-screen "+ Line below / Delete line / Lock line" buttons exist as a fallback. Needs a real-device test.
2. **Phone/tablet cannot reach the app yet.** The app runs on the computer that hosts it and only accepts the local web address. Remote/phone access is the open decision in `docs/decisions/0002-phone-access.md` (needed before Phase 1B).
3. `dev.ps1` has not been run on Windows.
4. Very long lines scroll sideways inside the line box (they do not wrap), to keep the ruled lines aligned.
5. Margin shows line numbers only. Syllable estimates arrive with Phase 2.
6. DOCX/PDF import is not included (TXT, Markdown and JSON only), as planned.
7. Deleted songs stay in the trash; there is no automatic purge or permanent-delete in Phase 1.
8. Undo history is per browser session (lost on reload); saved snapshots are not.
9. Importing always makes a new song; there is no "replace this song's lyrics" import.
10. The API has no sign-in. It is for local use only and listens on this computer only.
11. GitHub Actions results are unconfirmed until a run is seen on GitHub.
12. `npm audit` notices were not reviewed.

## Bugs found and fixed while testing
- Two requests arriving together on a brand-new database crashed one of them (shown to the user as a confusing network error). Fixed with a one-time locked migration; regression tests added and proven to fail without the fix.
- On a phone, options above the pad pushed it ~475px down. They now collapse into a "Song & section options" drawer.
- Markdown import mistook the exported "Genres:/BPM:" lines for lyrics. Fixed.

## Open items for owner
- Phone access model (docs/decisions/0002-phone-access.md)
- Real-device typing test when a way to run the app on your devices exists
- Plan fixes proposed earlier: phase numbering, split Phases 5 and 6, add LineTiming/ChordMark tables before they are needed
