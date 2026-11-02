# 0013: Design A, "Asphalt & Orange" (visual and navigation refactor)

Status: built in 8 stages, each tested. The design spec came from an outside review (ChatGPT) and the owner
chose it. This was a visual and navigation change only. Song data, backups, editing rules, offline use, AI
settings and spending controls are unchanged.

| Stage | What changed |
|---|---|
| 1 | Foundation. One token set (asphalt black, signal orange, warm cream notebook) with older names kept as aliases. DM Sans, Barlow Condensed and Archivo Black are bundled and precached (OFL). Buttons are 44px. Settings → Appearance adds a theme (Dark / Light / Match phone) and a lyric text size (S–XL). |
| 2 | Home. "STUDIO BARS." header, "Your songs" with one orange **+ New**, search by title or genre, flat song rows with a ⋯ menu (Open / Delete…), and Back up and Import rows. |
| 3 | Editor. Compact header (title, genre/BPM/save status, undo/redo, ⋯ menu). Notebook with line numbers on the left and syllables on the right. Lock and notes icons appear only where used. A toolbar acts on the active line. Lighter rhyme marks with solid, dashed or dotted underlines. |
| 4 | Phone writing mode. While a lyric line has the keyboard, the header slims, tools and the music bar step aside (music keeps playing), and the line toolbar sits on the keyboard (Lock, Notes, Rhymes, + Line, Delete, play/pause, Undo, Done). This uses `interactive-widget=resizes-content`, with a `visualViewport` fallback (`--kb`). |
| 5 | Tools grouped: Write (Notes), Words (Rhymes, Dictionary), Craft (Craft tools, AI), More (Music, History, Export). On PC they form a side panel; on a phone, a bottom bar plus a sheet. |
| 6 | Music player. On phones, a slim bar (play, title, time, progress line, Library, Open player) and a full-screen player with everything else. The PC keeps the full bar. |
| 7 | Tablet and PC. At 1200px and wider: song list, notebook and tools in three columns. At 861–1199px: notebook and tools. Both side panels can be collapsed. |
| 8 | Checks (`e2e/design_checks.cjs`). Every theme colour pair reaches 4.5:1 contrast in dark and light. Nothing to tap is under 32px (most are 44px). Keyboard-only song creation works; this fixed a bug where the dialog stole focus from the title box. Escape closes menus. No sideways scrolling at 320px wide or with XL lyrics. |

Not done, and noted for later:
- The PC opens "Song details" (genre, BPM, section and display options) by default. It's in the ⋯ menu to hide.
- Rhyme family letters (A, B, C…) are not drawn on the words. The underline style is the non-colour cue.
- Real-device check of the keyboard behaviour on the owner's Samsung S21 (Chrome) is still to do.
