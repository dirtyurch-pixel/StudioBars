# 0008: Song structure and flow tools (Phase 5)

Status: built (core set); awaiting owner review.

## Rules
1. Planning never edits lyrics. Vault, takes, plan, idea board and flow grids live in their own tables (migration 6) and are never joined to the lyric tables by triggers. Tests compare the lyrics before and after.
2. Text reaches the song only through the editor's guarded path (insert a copy / use a take after a confirmation), so locks hold and Undo works. A locked line can have takes saved for it but "Use" is not offered.
3. Flow is **manual**. The writer assigns each syllable to a slot (8th = 8, 16th = 16, triplet = 12 slots per 4/4 bar; 1 or 2 bars). There is no automatic alignment from BPM. Stress marks are from the dictionary; density and "stressed syllable off the main beats" are labelled estimates.
4. Scans (clichés, repeats, fillers, structure, rhyme chains) are rule-based estimates. The cliché list is a small bundled list of ~60 common phrases and does not claim to be complete. Repeats in chorus/hook/pre-chorus sections, or any repeat in a House song, are marked "looks intentional". Rhyme chains use each word's first dictionary pronunciation and flag words with other pronunciations.
5. No score, no "hit potential". Hook comparison is by keeping takes and marking favourites.

## Not built from the Phase 5 list (be aware)
House loop editor, a dedicated Pop pre-chorus contrast tool, a separate hook-testing screen with criteria, drag-and-drop section templates in the structure map, and per-genre flow presets. Takes/vault/plan/scan cover the underlying need for now.
