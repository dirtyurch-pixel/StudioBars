# Project spec (summary)

Authoritative source: `docs/planning/STUDIO_BARS_MASTER_BUILD_PLAN.md` (v1.4) and `docs/planning/PRODUCT_DECISIONS.md`.

- English only; Hip-Hop, R&B, House, Pop (hybrids allowed). Not a DAW.
- Stack: React + TypeScript + Vite + Tailwind; Python FastAPI; SQLite (from Phase 1).
- AI proposes only; locked lines are immutable (enforced in the API and database).
- Build one authorised phase at a time. Approval of one phase never covers the next.
- Phase 0 delivers: repo scaffold, `/health`, frontend connection check, lint/type/test tooling, CI (tests only), decision records.

## Phase 1 delivers
Responsive Royal Blue & Amber UI with yellow ruled pad; song list (create, delete to trash, restore); metadata and genres; sections (add, rename, retype, reorder, delete); line editor with stable IDs, paste splitting, undo/redo; lock protection (editor, API and database); SQLite with versioned migrations; autosave with visible status, offline retry and conflict detection; snapshots and restore; line notes; TXT/Markdown/JSON export; TXT/Markdown/JSON import with preview; keyboard shortcuts and Focus Mode. See `docs/decisions/0003-phase1-design.md`.
