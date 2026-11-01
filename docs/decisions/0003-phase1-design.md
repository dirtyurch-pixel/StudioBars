# 0003 Phase 1 design decisions

- **Editor:** one text input per lyric line with stable IDs (the line-based approach from 0001). Enter splits, Backspace joins, multi-line paste splits into lines. Long lines scroll sideways inside their input instead of wrapping, so the ruled-paper lines always line up. Revisit after a real phone test.
- **Lock rule enforced three times:** the editor refuses the change; the API refuses a save that would edit or drop a locked line (HTTP 423); the database itself refuses (triggers). Locked lines may be moved. Lock state changes only through the lock/unlock endpoints, never through a normal save.
- **Autosave:** whole-song save, 0.7 s after the last keystroke, with a version number. A second window or tab that saves first causes a "changed elsewhere" pause, never a silent overwrite.
- **Undo/redo:** song-level, in the browser. An undo or redo that would touch a locked line is skipped with a message.
- **Revisions:** automatic snapshot at most every 5 minutes while saving, manual snapshots, and one before every restore. A restore is refused (with the list of lines) if it would change or remove a locked line.
- **Import:** always creates a new song; shows a preview first; never overwrites. DOCX/PDF import is not part of Phase 1.
- **Delete:** moves a song to the trash (nothing in it is changed). There is no automatic purge in Phase 1.
- **Line numbers, not syllable counts:** real syllable estimates need the pronunciation dictionary (Phase 2). The pad shows plain line positions and says so.
- **Database:** SQLite file at `data/private/studio_bars.db` (git-ignored); override with `STUDIO_BARS_DB`.
