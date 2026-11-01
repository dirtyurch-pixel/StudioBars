# Project spec (summary)

Authoritative source: `docs/planning/STUDIO_BARS_MASTER_BUILD_PLAN.md` (v1.4) and `docs/planning/PRODUCT_DECISIONS.md`.

- English only; Hip-Hop, R&B, House, Pop (hybrids allowed). Not a DAW.
- Stack: React + TypeScript + Vite + Tailwind; Python FastAPI; SQLite (from Phase 1).
- AI proposes only; locked lines are immutable (enforced in the API and database).
- Build one authorised phase at a time. Approval of one phase never covers the next.
- Phase 0 delivers: repo scaffold, `/health`, frontend connection check, lint/type/test tooling, CI (tests only), decision records.

## Phase 1 delivers
Responsive Royal Blue & Amber UI with yellow ruled pad; song list (create, delete to trash, restore); metadata and genres; sections (add, rename, retype, reorder, delete); line editor with stable IDs, paste splitting, undo/redo; lock protection (editor, API and database); SQLite with versioned migrations; autosave with visible status, offline retry and conflict detection; snapshots and restore; line notes; TXT/Markdown/JSON export; TXT/Markdown/JSON import with preview; keyboard shortcuts and Focus Mode. See `docs/decisions/0003-phase1-design.md`.

## Phase 1B delivers
Local music library (consented copy into private storage, validated by extension and contents), personal playlists (create/rename/delete, reorder, repeated tracks, delete without touching audio), a persistent player (play/pause, seek, previous/next, volume/mute, shuffle, repeat off/all/one, A–B loop, 0.75×–1.25× speed with pitch preserved, play-next queue), missing-file recovery with relink, remembered playback state, and the Writing Session foundation (song linked to music with saved loop, speed and position). See `docs/decisions/0004-music-player.md`.

## Phase 2 delivers
Offline pronunciation dictionary (CMU), syllable estimates per line (ranges for ambiguous words, `~` for guesses), rhyme finder (perfect / near / same vowels / same ending, plus homophones and rich rhymes on request) with syllable, ending-type and word-familiarity filters, rhyme-family colours for end and internal rhymes (on/off), word lookup from the cursor or selection, ambiguous-pronunciation chooser, unknown-word handling, and personal pronunciations. See `docs/decisions/0005-pronunciation-and-rhymes.md`.

## Phase 3 delivers
WordNet 3.0 meanings by sense (definitions, examples, synonyms flagged when the meaning may shift, opposites, kinds, imagery), line-aware ordering of meanings, pronunciation by meaning for same-spelling words, a working part-of-speech filter for rhymes, a personal phrase and slang bank (searchable, tagged, exportable), experimental phrase rhymes, and an optional, off-by-default online word helper with disclosure, rate limiting, caching and offline fallback. See `docs/decisions/0006-meanings-phrases-online.md`.
