# STUDIO BARS — MASTER BUILD PLAN

**Version:** 1.4  
**Purpose:** A step-by-step implementation specification for Claude Code or OpenAI Codex.  
**Status:** Approved product direction; implementation not started.  
**Owner:** Personal-use project.  
**Last updated:** 2026-11-01
**Naming:** Studio Bars is a temporary working name; final branding and availability must be checked before public release.
**Version 1.4 additions:** Consolidated starter package, consistent Studio Bars naming, separate development prompts, GitHub gate and setup checklist.
**Version 1.1 additions:** All 15 approved enhancements, built-in local music player, personal playlists, portable playback bar, loops and project-linked listening sessions.
**Version 1.2 additions:** GitHub publishing after each authorised phase, strict no-build-until-commanded policy, explicit approval gates, and safe Git/CI procedures.
**Version 1.3 additions:** Twelve approved competitor-inspired features and an integrated Writing Session Mode. All newly approved features are planning requirements only; no development is authorised.

> **IMPORTANT FOR THE CODING AGENT:** Read this document fully before writing code. Build **only one phase at a time**. Do NOT begin Phase 0 or run any build, installation, GitHub, code-generation or deployment action until the owner explicitly orders that specific stage to start. Reading and planning alone are permitted. Do not skip acceptance tests. At the end of every authorised phase, commit and push only the tested phase changes to the owner-approved GitHub repository (subject to connectivity and permissions), then give plain-English results, command(s) to run, files changed, test outcomes, push status, known problems, and the exact next phase. Do **not** start the next phase without the owner's approval. Avoid claiming a feature works unless you tested it. Never silently change locked or approved lyrics.

---

## 1. Product vision

Create **Studio Bars**, an original, polished, local-first English-language songwriting application for **Hip-Hop, R&B, House and Pop**. Support genre combinations, but no other language or genre-specific implementation in the initial scope.

It is a **collaborative writing studio**, not just a text generator. The user controls the writing, selects and locks approved lines, and uses a lyric editor, pronunciation-aware dictionaries, rhyme and stress analysis, and optional AI suggestions.

### Product principles

1. **Lyrics are the source of truth.** The AI proposes, never silently edits.
2. **Locked lines must not change** through AI actions, bulk edits, imports, or accidental edits without explicit unlocking.
3. **Local-first data.** Song projects, lyrics, settings, snapshots and the basic language tools work locally; AI and Datamuse may need internet.
4. **Reliable analysis vs subjective guidance.** Clearly label measured facts, estimates, and creative opinions. BPM alone does not tell us a vocalist's actual flow.
5. **Genre-aware, not genre-prescriptive.** Musical conventions are suggestions, not rigid rules.
6. **Clean, fast and usable** on Windows PC and phone. Keyboard/mobile typing should take priority over effects and decoration.
7. **Music while writing.** Local audio playback and playlists must never interrupt lyric typing, selection, AI suggestions or autosave.
8. **Original output.** Never scrape or reproduce copyrighted lyric catalogues. References can inform techniques, not copying.
9. **Accessibility.** Comfortable contrast, readable text, keyboard navigation, scalable font size, reduced motion.

### Not in initial scope

- Moroccan Darija or multilingual songwriting.
- Automatic song production, beat generation, VST plugin creation, or direct FL Studio integration.
- Streaming-platform account connections, music downloading, DRM bypass, or redistributing commercial recordings. The included player handles user-selected local files that the user has rights to play.
- Audio-to-MIDI, exact automatic vocal timing, or melody detection in the first releases.
- Paid subscriptions, accounts, public sharing, or multiuser collaboration for the first version.
- Guaranteed 'hit' or 'quality' scores; no false claims about commercial success.

---

## 2. Agreed UI design

### Approved colour scheme: **Royal Blue & Amber**

Use a single consistent design system on phone and desktop, with sensible light-on-dark contrast and a **warm-yellow lined writing pad**.

| Token | Suggested HEX | Usage |
|---|---|---|
| `--bg` | `#09152E` | Midnight-navy app background |
| `--panel` | `#1746A2` | Royal-blue sections; use darker shades as needed for contrast |
| `--panel-dark` | `#101F42` | Dark inset panels and sidebars |
| `--paper` | `#FFF0B3` | Warm-yellow notebook paper |
| `--paper-ink` | `#172036` | Dark lyric text |
| `--paper-rule` | `#A5B4C5` | Subtle horizontal notebook rules |
| `--accent` | `#FFBA24` | Amber primary action buttons |
| `--selected` | `#3478F6` | Selected navigation/tool state |
| `--surface-text` | `#F8FAFF` | Text on dark surfaces |
| `--muted` | `#B7C5E1` | Secondary text |
| `--danger` | `#D84359` | Destructive-action warning |

**Visual rules:** Smooth rounded corners, restrained shadows, clean typography, generous spacing; line spacing should match actual notebook rules. No excessive gradients, neon bloom, ornamental fake phone frame, unnecessary advertising, or fake controls. Numbers in the paper margin show *estimated syllables*, not bar numbers; make this explicit. Avoid confusing a lyric line with a musical bar.

**Additional selectable themes (later):** Sunset Gold & Deep Purple, Ocean Teal & Coral, Emerald Green & Rose. Keep the same component layouts. Check accessible contrast for each.

### Persistent music controls (new in v1.1)

- **Desktop:** dockable compact player at the bottom, optional expanded playlist drawer; never hide the yellow writing pad.
- **Phone:** narrow mini-player above bottom navigation or in a non-obstructing sticky region; expand for playlist, queue and A–B looping. Collapse during typing when keyboard is open; leave a reachable play/pause control.
- Show title, optional artist/artwork, elapsed/duration, seek, play/pause, previous/next, repeat-one/repeat-all, shuffle, volume/mute (where supported), and loop section A–B.
- Audio plays independently of navigation between song sections or tabs; interacting with transport controls must not steal writing focus when avoidable.
- Match Royal Blue & Amber theme; accessible icons, large touch targets, keyboard shortcuts that are suppressed while typing in the editor.

### Desktop layout

- **Left sidebar:** My Songs, New Song, recent songs, song sections, genre/profile, settings.
- **Centre:** prominent yellow ruled-pad editor with editable lyrics; section tabs (Verse, Pre-Chorus, Chorus, Bridge, Outro, custom), toolbar, line numbers, syllable counts, lock state, save status.
- **Right sidebar:** tabs for Suggestions, Rhymes, Thesaurus, Structure, Flow; suggestions should never hide the actual editor.
- **Top controls:** title, genres, BPM (optional), time signature (optional), undo/redo, export.
- **Bottom or side dock:** always-accessible music mini-player; playlist editor opens without replacing the lyric editor.
- **Resize:** sidebar width and right pane should be resizable; mobile UI must not require desktop-sized side panels.

### Phone layout

- Song title and genre in a compact header.
- **Lined yellow writing pad at the top.** Keep it legible while the on-screen keyboard is visible; allow expanding it to fullscreen.
- A horizontal or bottom tool selector: Lyrics, Rhymes, Thesaurus, Suggestions, Flow, Music (Chord support only later if actually useful).
- Suggestions appear in a **collapsible bottom panel** with clear actions **Preview / Insert / Replace (with confirmation)**, not automatically applied.
- Preserve cursor position, selection, scroll position and keyboard focus while switching tools.
- Standard Android browser keyboard must not be obscured by app controls. Handle small screens and safe areas.

**Design references:** The three mobile/desktop screenshots supplied by the owner show a lyric writing pad with a lower/side suggestion panel. Copy the *general interaction pattern*, not proprietary branding/assets/UI pixel-for-pixel. The user explicitly wants a more modern design and yellow ruled notebook instead of white.

---

## 3. User journeys

### New song

1. Click **New Song**.
2. Enter title, choose Hip-Hop / R&B / House / Pop (one or multiple), optional song concept, mood, narrative perspective, BPM, time signature.
3. Choose a suggested template or blank song; templates are editable, not compulsory.
4. Add/reorder/edit song sections and lyric lines.
5. Autosave locally; clear save indicator.

### Co-writing a line

1. Select a line or position for the next line.
2. Choose **Find Rhyme / Suggest Next Line / Improve Flow / Wordplay / Change Emotion / Shorten / Make More Conversational**.
3. Show analysis context: nearby lyrics, rhyme target, preferred syllable range, writing goal, genre, current narrative.
4. Show **3–5 original candidate lines** with explanations and pronunciation/syllable *estimates* where relevant.
5. User previews or inserts a candidate. Never overwrite automatically.
6. User may **lock** a final line.

### Lyric analysis

Highlight word or phrase -> look up pronunciation, syllable count, perfect/near rhyme, meaning, related words, and rhyme phrases. Colour-code rhyme families optionally. Mark uncertainty where pronunciations differ. Repetitions and clichés should be advisory, not automatic failures.

### Listen and write (new in v1.1)

1. Open **Music Library** and import one or more local audio files using a chooser or desktop drag-and-drop. Support only formats verified on the target platform and clearly report unsupported files. Do not silently upload the audio.
2. Add tracks to **personal playlists**, rename a playlist, rearrange or remove tracks, and build an up-next queue. Repeated playlist entries are allowed where intentional.
3. Start a playlist, open a song project, and keep music playing while composing, using AI, saving and navigating the app.
4. Provide pause/resume, seek, previous/next, shuffle, repeat-one/repeat-all, adjustable volume when possible, and **A–B looping** for repeating a section while composing.
5. Optionally link a playlist or individual track to a song project. Remember the link and last playback position as a convenience; do not assume a synced copy of the audio exists on another device.
6. If a file was moved, its permission was lost, or the format is not playable, display a recovery/relink action while preserving playlist metadata.

### Save, export and recover

Autosave, manual snapshots, revision history, import plain text, export .txt/.md/.json with sections. Support export of a complete local backup; users can restore without an account. Delete requires confirmation and should be recoverable for a limited period when possible.

---

## 4. Technical architecture

**Recommended for version 1:**

- Frontend: **React + TypeScript + Vite**.
- Styling: Tailwind CSS with CSS variables/design tokens.
- Rich text editor: Prefer a well-supported editor framework such as **TipTap/ProseMirror** or Lexical, but evaluate whether a simpler line-based text editor would better preserve structured lyrics; document the decision in Phase 0. Avoid a homegrown `contenteditable` implementation without robust selection/undo tests.
- Backend: **Python + FastAPI**.
- Database: **SQLite** (local, versioned migrations, backups). FTS5 may be useful for song search.
- HTTP API contract: OpenAPI / typed client where practical.
- AI: Provider adapter to support model choice and interchangeable APIs. **Store API keys only in the backend or secure OS credential storage, never in the frontend or source control**.
- Windows app packaging: **Tauri** only after the web app works. Packaging a Python backend requires a real distribution plan; do not assume Tauri automatically bundles it. First release can run locally as a web app with a launcher.
- Phone: responsive browser/PWA. For remote access, explicitly plan a secure hosted backend or safe private networking; a PWA alone cannot reach a home PC anywhere.
- Development: Python virtual environment, Node LTS, `package-lock.json`, lockfile for Python dependencies, lint, typecheck, automated tests, Git.

### Suggested repository structure

```text
studio-bars/
  README.md
  PROJECT_SPEC.md
  AI_RULEBOOK.md
  HANDOVER.md
  docs/
    research/
      songwriting-structure.md
      rhyme-phonetics.md
      rhythm-flow.md
      genre-hiphop.md
      genre-rnb.md
      genre-house.md
      genre-pop.md
    decisions/
  frontend/
    src/
      components/
      music/
      editor/
      pages/
      themes/
      api/
      types/
  backend/
    app/
      api/
      db/
      models/
      services/
        music/
        rhymes/
        thesaurus/
        ai/
        analysis/
      migrations/
  data/
    README.md
    licenses/
  tests/
  scripts/
```

**Note:** Do not put secret API keys in `data/` or commit personal lyric databases by default. Put development-specific personal data and secrets in ignored locations.

---

## 5. Database and language resources

### 5.1 External language resources

1. **CMU Pronouncing Dictionary** (`cmudict`): dictionary of American English phoneme sequences, syllable stress; primary source for pronunciation-based rhyme and syllable analysis. Source: https://github.com/cmusphinx/cmudict . Preserve attribution/licence file.
2. **Princeton WordNet**: lexical meanings and synonym relationships, with word-sense distinctions. Official site: https://wordnet.princeton.edu/ . Include required licence notices and version information. Synonyms are often context-dependent: do not automatically swap them into lyrics.
3. **Datamuse API**: optional online word search for rhymes/semantic associations, https://www.datamuse.com/api/ . Treat as optional, rate-limited, subject to API access conditions; the editor must work when it is down. Never hard-code unstable API terms; check up-to-date requirements before integration.
4. **Personal songwriting lexicon**: original or properly licensed idioms, slang, contractions, phrases, phonetic variants, emotional and metaphor fields. Design ability to add, tag, review and remove entries. Do **not** bulk copy lyrics or copyrighted text into the library.
5. **Accent variants**: initial dictionary based mainly on US pronunciation; plan British English/alternate user-defined pronunciations later. Be explicit about uncertainty.

### 5.2 Data model — minimum entities

- `Song(id, title, concept, mood, point_of_view, bpm_nullable, time_signature_nullable, created_at, updated_at)`
- `SongGenre(song_id, genre)`
- `SongSection(id, song_id, label, section_type, position)`
- `LyricLine(id, section_id, position, text, is_locked, created_at, updated_at)`
- `SongRevision(id, song_id, created_at, snapshot_json, description)`
- `ProjectSettings(song_id, syllable_display, rhyme_highlighting, pronunciation_variant, preferred_suggestion_count)`
- `WordEntry(id, spelling, part_of_speech, source, frequency_if_licensed)`
- `Pronunciation(id, word_id, phonemes, syllable_count, stress_pattern, accent, provenance)`
- `WordSense(id, word_id, sense_id, definition, provenance)`
- `WordRelation(source_sense_id, target_sense_id, relationship)`
- `RhymeIndex(pronunciation_id, rhyme_key)` or a documented equivalent; derive rhyme keys from last stressed vowel through word end for canonical perfect rhyme, and support additional fuzzy similarity strategies separately.
- `PhraseEntry(id, phrase, meaning_nullable, phonetic_variant_nullable, tags, source, licence)`
- `Suggestion(id, song_id, target_line_id_nullable, input_context_hash, output_text, generation_settings_json, accepted_at_nullable)`
- `AudioTrack(id, title, artist_nullable, album_nullable, duration_nullable, file_reference, content_hash_nullable, media_type, storage_mode, available, added_at)` — store local path/file identifier separately from UI; never assume a browser file chooser path remains valid across restarts.
- `MusicPlaylist(id, name, created_at, updated_at)`
- `PlaylistTrack(id, playlist_id, track_id, position)` — join rows have their own IDs so optional duplicates and ordering work.
- `PlaybackState(id, track_id_nullable, playlist_id_nullable, position_seconds, repeat_mode, shuffle_enabled, volume, updated_at)`
- `SongAudioLink(song_id, track_id_nullable, playlist_id_nullable, loop_a_seconds_nullable, loop_b_seconds_nullable)`
- `SongIdea(id, song_id_nullable, type, text, tags_json, created_at)`, `VaultItem(id, type, text, tags_json, pronunciation_nullable, created_at)`
- `LyricAlternative(id, lyric_line_id, proposed_text, source, created_at, selected_at_nullable)` — alternatives do not replace approved text without explicit action.
- `VocalTake(id, song_id, track_id_nullable, file_reference, recorded_at, notes_nullable)` — recording audio stored privately in later phase.
- `FlowPattern(id, song_section_id, grid_json, time_signature, created_at)` — separate from written text.
- `WritingProfile(id, summary_json, source_revision_ids_json, updated_at)` — opt-in analysis of **user-owned** lyrics only.

Migration scripts must version schema changes. All user-facing mutations should be transaction-safe. Preserve stable IDs across reordering and revisions.

### 5.3 Reliability rules for language analysis

- **Rhyme detection is sound-based**, not based only on spelling.
- Distinguish perfect rhyme, near rhyme, assonance, consonance, internal rhyme, multisyllabic/phrase rhyme.
- Syllables are pronunciation-dependent: report variants where known.
- Stress is approximate from written text; do not claim to know the actual sung/rap performance.
- Line length is **not** a bar count. Beat assignment needs a rhythm grid or recorded timing.
- Lyrics with contractions, names and slang require graceful fallback or user-edited pronunciation.
- Never mark a creative choice as an objective mistake solely because it differs from a template.

---

## 6. The AI co-writer and its hard rules

Implement a **provider-neutral service** that requests structured results. API failure should not interrupt manual writing.

### AI prompt inputs

- Current song metadata (genres, theme, mood, point of view, intended audience/tone).
- Current section role and nearby **approved/context** lyrics.
- Selected text and requested operation.
- Rhyme target phonemes or candidate list from deterministic engine if requested.
- Optional target syllable range; clarify that spoken/sung realization varies.
- Desired creativity, directness, imagery, complexity, and taboo/cliché preferences.
- Explicit locked-line list (read-only context, never write target).

### AI output schema (example)

```json
{
  "operation": "suggest_next_line",
  "candidates": [
    {
      "text": "Original candidate lyric",
      "reason": "Why this fits the context",
      "estimated_syllables": null,
      "rhyme_target": null,
      "warnings": []
    }
  ]
}
```

Recompute numeric/phonetic analysis on backend rather than blindly trusting AI fields. Validate all model output. Reject suggestions that contain extraneous metadata as lyric text. Do not embed private songs in telemetry.

### Core restrictions

- The AI **may suggest** but **must not automatically write into the editor**.
- Locked lines are immutable to AI and bulk actions; unlocking requires a deliberate user action.
- Preserve the narrative subject, pronouns, tense and emotional situation unless the user requests a change.
- Offer alternatives rather than insisting on a single rewrite.
- No copying of existing released lyrics, no imitation requiring close reproduction of a living artist's distinctive lines; provide technique-based guidance instead.
- Identify awkward rhymes and empty clichés without reflexively replacing natural conversational language.
- Never invent certainty about flow, melody or pronunciation from text alone.

---

## 7. Genre profiles (configurable defaults, not constraints)

| Dimension | Hip-Hop | R&B | House | Pop |
|---|---|---|---|---|
| Focus | Wordplay, rhyme chains, rhythm, narrative | Emotion, singability, phrasing | Groove, short repeatable hooks, silence | Hook clarity, memorable sections, singability |
| Suggestions | Internal/multi rhymes, punchlines, syllable placement | Conversational wording, tension, vocal-space planning | Hook compression, repetition variations, arrangement cues | Title/hook refinement, pre-chorus lift, contrast |
| Pitfalls to check | Forced rhyme, inconsistent perspective, overcrowded bar | Clumsy word stress, lack of emotional progression | Too many words, weak rhythmic identity | Vague hook, filler verses, forced pre-chorus |

Support combinations e.g. Hip-Hop/R&B or House/Pop by blending **suggestion preferences** rather than restricting features.

Song structures/templates should be editable. Support common phrases/sections such as 4/8/16 bars as planning choices only. A verse's number of written lines does not automatically equal its bar count.

---

## 8. Phase-by-phase execution plan

### PHASE 0 — Project setup and architecture decisions

**Goal:** A working development setup and documented decisions, no major features yet.

Tasks:
- Check Windows environment and available Node/Python/Git versions; give explicit, tested commands for PowerShell.
- Initialise repository, React/Vite/TypeScript/Tailwind frontend and Python/FastAPI backend.
- Choose and justify lyric editor library (TipTap/Lexical vs simpler line-based design), considering cursor, structured lines, undo, locking, mobile typing.
- Establish linting, formatting, type checking, tests and basic CI instructions.
- Create root `README.md`, `PROJECT_SPEC.md`, `AI_RULEBOOK.md`, `HANDOVER.md`, `.gitignore`, licence/attribution plan.
- Implement a minimal `/health` backend route and frontend connection test.

**Acceptance:** One-command documented development startup (or one command per service); frontend launches, backend health responds, lint/tests run without errors. No secrets committed.

**STOP and report; push the verified Phase 0 changes to GitHub if authorised, then await approval for Phase 1.**

### PHASE 1 — Core editor and reliable saving

Tasks:
- Implement responsive desktop/mobile Royal Blue & Amber UI with yellow ruled pad.
- Song dashboard; create/rename/delete songs; metadata and genre selection.
- Song sections add/reorder/delete/custom label.
- Line editor with stable IDs, cursor behavior, multiline/paste, undo/redo, formatting only if reliably implemented.
- Locked line protection on every write path and explicit unlock.
- SQLite models, migrations, autosave with visible status, snapshots/history and recovery.
- Export/import plain text and JSON with round-trip data integrity.
- Proper loading, empty, error, offline states.

**Acceptance:** Can create a song, edit 3 sections, lock two lines, attempt to edit them (blocked), close/reopen, restore revisions, export and import without data loss. Mobile keyboard does not cover active line. Test lock invariants and save/restore automatically.

**STOP and report; await approval for Phase 1B.**

### PHASE 1B — Built-in music player and personal playlists (new; implement after Phase 1)

**Goal:** Hear your own imported music while writing on the same screen. This is a required feature, not a later optional extra.

Tasks:
- Build a **local-first personal music library** with multi-file import, metadata (when readable), track title editing, optional artwork, file type/size validation and graceful unsupported-file handling. Do not fetch remote commercial tracks.
- On desktop, support import by file picker and drag-and-drop; on phones use the platform picker. Where browser storage cannot persist the original file handle, **explicitly copy with consent into managed app storage** or ask user to relink the file on a later session. Verify quota and warn before copying large files.
- Playlist CRUD (create/rename/delete), add/remove/reorder tracks, up-next queue, and a way to select the playing playlist. Distinguish deleting a playlist from deleting underlying audio.
- Persistent mini-player in desktop and mobile editors: play/pause, seek, next/previous, elapsed/duration, volume/mute when supported, shuffle, repeat one/all/off, **A–B loop** with clear/reset controls. Show loading/error/ended states.
- Playing music must **not** stop when switching editor tabs or sections, selecting text, viewing rhyme suggestions or autosaving. Keep player state outside remounted editor components.
- Link a song to a track/playlist and optionally store a loop region for that song. Reloading a project should restore links and settings; autoplay must comply with browser/platform restrictions and may require user action.
- Add keyboard shortcuts for playback **only** when an editable field is not focused; on mobile ensure bottom controls do not block keyboard or editor.
- **Platform policy:** audio from a Windows local library is **not** automatically available on Android. Explain separate importing or a later opt-in synchronisation system. Avoid exposing local file paths to AI requests, logs or web calls.

Acceptance:
- Import 10 audio files, make two playlists, reorder tracks, play while editing a song, switch sections, request a rhyme, autosave, and verify uninterrupted playback.
- Pause, seek, skip, shuffle/repeat and A–B loop work. Navigate away and back without unexpected resets; reload and verify the restored playlist metadata/links and documented audio access behaviour.
- Unsupported/corrupt/moved files do not crash the app; import errors are visible; no unintended audio uploads.
- Mobile keyboard and mini-player coexist without blocking text; mobile platform may require manual play after reload due to autoplay rules.

**STOP and report; await approval for Phase 2.**

### PHASE 2 — Pronunciation and rhyme tools

Tasks:
- Add CMU dictionary via versioned installer/download or Python package; include notices.
- Build word normalizer/tokenizer with original-text preservation.
- Build phoneme-aware perfect rhyme and syllable lookup with pronunciation variants.
- Implement rhyme panel: perfect/near, candidate pronunciation, word-class where known.
- Highlight internal and end-rhyme families; let user turn highlights on/off.
- Add editable custom pronunciations and unknown-word handling.
- Make phonetics tests with words sharing endings but different spelling and words with same spelling but different pronunciations.

**Acceptance:** Deterministic phonetic rhyme detection; counts correctly for test dictionary entries; doesn't silently assign a single count to ambiguous forms; acceptable performance on normal lyrics; offline operation.

**STOP and report; await approval for Phase 3.**

### PHASE 3 — Word meanings, thesaurus, and phrase lexicon

Tasks:
- Integrate Princeton WordNet with licence notices and sense-aware search.
- Synonym/antonym and related concept panel; label potential changes of meaning.
- Optional Datamuse adapter with timeout, rate limiting, caching and offline fallback; clearly identify online results.
- Personal phrase/slang bank (user-created entries with meaning, pronunciation, tags).
- Phrase-level/multisyllabic rhyme support as an **experimental** tool until validated.
- Research/test pronunciation differences where relevant.

**Acceptance:** Synonyms are distinguished by sense where possible, API outage doesn't freeze editor, user phrase is persisted/searchable, no copyright or licence violations.

**STOP and report; await approval for Phase 4.**

### PHASE 4 — AI co-writer

Tasks:
- Build AI provider abstraction, secure key entry/storage, model configuration, budget/usage controls.
- Create task-specific prompts: next line, rewrite, imagery, punchline, emotion, hook, structure, critique.
- Produce and validate structured 3–5 candidate suggestions per request; show clear error states.
- Suggestions may Preview, Insert, or request Replace **with confirmation**; nothing silently applied.
- Ensure locked lines are immutable at model layer and database layer.
- Include surrounding context, rhyme data and desired genre; label approximate scores.
- Avoid provider-specific lock-in; log errors without exposing full lyric content or keys.

**Acceptance:** No AI call can modify a locked line; malformed response handled safely; suggestions are original, contextual, and only written after user action. Basic offline mode retains editor and dictionaries.

**STOP and report; await approval for Phase 5.**

### PHASE 5 — Song structure, narrative and advanced flow tools

Tasks:
- Structure map with editable song sections and optional suggested templates.
- Narrative planner: scene, conflict, turning point, emotional arc; advisory only.
- Rhythmic grid for 4/4 initially, user-assignable note attacks to 8th/16th subdivisions.
- Show stress markers, syllable density by assigned bar, rhyme placements and breath suggestions as *estimates*.
- **Multisyllabic Rhyme Laboratory**: phrase-level rhyme matching, stress-aware comparisons, internal rhyme chains and strictness controls; display alternate pronunciations and never overclaim an exact match.
- **Cliché and Repetition Detector**: highlight possible clichés, filler, reused phrases and accidental repetition; distinguish intentional hooks and repeated House lyrics.
- **Song Idea and Concept Board**: capture themes, characters, scenes, titles, moods, story arcs and hooks as reusable project notes.
- **Flow Designer**: edit user-assigned syllable onsets with eighth/sixteenth/triplet subdivisions, pauses, accents, rhyme locations, rhythmic variations and flow switches. No fake automatic alignment from BPM alone.
- **Hook Testing Laboratory**: compare versions, use explicit qualitative criteria, record user favourites; never claim to calculate commercial success.
- **Lyric Structure Scanner**: map section types, phrase lengths, rhyme families, density, repeats, contrast, story development and missing narrative transitions.
- **Punchline and Hook Vault**: save and tag reusable user-authored ideas, rhyme combinations, short hooks and unassigned bars; insert copies without deleting originals.
- **Alternative Takes**: preserve multiple candidates for lines and choruses; compare/preview and choose with an explicit operation that respects locks.
- Hook lab, section repetition tracking, House loop editor, Pop pre-chorus contrast, R&B phrasing, Hip-Hop rhyme chains.
- BPM metronome; distinguish beat grid planning from analysing actual performance.

**Acceptance:** User can map syllables to bars manually, vary subdivision, compare flow patterns, and keep lyric text unchanged. Edge cases tested across 4 genres.

**STOP and report; await approval for Phase 6.**

### PHASE 6 — Advanced creativity, performance and audio-aware features (optional future milestone)

Tasks:
- **Upgrade** the Phase 1B music player (already working) with a waveform, linked beat markers, transport timecodes and writing-region A–B loop presets; do not rebuild the basic player from scratch.
- **Metaphor and Wordplay Workshop**: topic-to-image maps, sensory details, contrasts, puns and double-meaning suggestions, with explanations and contextual selection.
- **AI Writing Personas**: Co-writer, Lyric Editor, Rhyme Specialist, Vocal Coach and Critical Reviewer. Implement as provider-independent, inspectable prompt profiles, not separate fictional agents.
- **Personal Writing DNA**: opt-in analysis of user-approved, locally stored original lyrics for vocabulary, rhyme/phrase tendencies, common imagery and habits. Private by default; allow profile review, refresh and delete. Do not automatically include whole song library in AI requests.
- **Voice-to-Lyrics Capture**: recorded spoken ideas, transcription with explicit permission, review/edit before inserting, preserve optional original recording; use on-device where feasible and clearly disclose any online transcription.
- **Songwriting Training Mode**: lessons on rhyme chains, imagery, hooks, cadence and phrasing using original exercises, human-editable assessment and examples.
- **Singability and Breath Assistant**: suggest breathing points, note where syllables may be crowded, show pronunciation variants and allow syllable stretching; label unrecorded estimations clearly.
- **Vocal Take Recorder**: capture a scratch vocal with explicit microphone permission, local files, play/compare takes and note timing offsets; account for recording latency and avoid unfounded timing precision.
- Import local audio beats in common formats and play alongside the editor.
- Time markers, loop ranges, metronome sync, and manual phrase alignment.
- Optional scratch vocal recording, with explicit recording consent/permissions.
- Evaluate forced alignment and audio analysis based on reliable test data; do not promise exact alignment without audio and model validation.

**Acceptance:** Existing Phase 1B playback remains stable. Each of the 7 advanced creativity/performance additions has a working interface and saved data where needed; microphone and optional transcription permission are explicit, recordings can be deleted, flows and critiques are advisory, and failed AI/audio calls cannot corrupt lyrics. Clear alignment workflow; no unreliable claims about exact word or beat timing.

**STOP and report; await approval for Phase 7.**

### PHASE 7 — Packaging, backups, hardening

Tasks:
- Windows packaging and documented upgrade path; bundle backend correctly if using Tauri.
- Mobile PWA polish and documented local-network/secure remote access options.
- Theme selector for four agreed palettes, theme contrast audits.
- Backup/restore, database migrations, crash recovery, performance testing, installer testing.
- Security checks for local API exposure, path traversal, input validation, secrets, untrusted model output.

**Acceptance:** Install and run on a fresh supported Windows machine; backup survives an upgrade; no loss of locked lines; phone usability checked at common screen widths.

**STOP and report.**

---

## 9. Tests required throughout

### Automated

- Backend: `pytest` for API, database, rhyme service, invalid input, migrations, locking, snapshot recovery.
- Frontend: Vitest + React Testing Library for editing, keyboard shortcuts, stable line selection, theme contrast as feasible.
- End-to-end: Playwright for new song, autosave, lock protection, revision restore, import/export, mobile layout.
- Static: TypeScript strict mode, lint, Python formatter/linter, dependency checks.

### Player and playlist regression tests (new in v1.1)

- Import multiple files with mixed valid/unsupported formats, long titles, missing metadata, duplicate track names, and a corrupt file.
- Playlist create/rename/reorder/delete, up-next queue, repeat/shuffle, volume, seek, A–B loop including A > B invalid input, and behavior at track end.
- Keep music playing while typing rapidly, switching between song tabs, opening AI suggestions, autosaving, and restoring a snapshot.
- Handle mobile background/screen-lock restrictions honestly; never promise seamless background audio on every browser/OS.
- Test Android file permissions, browser storage quota, lost/revoked file access, backup/restore of **playlist metadata** versus actual audio files, and manual relink.
- Verify no media is uploaded or transmitted to AI without an explicit separate feature and consent.

### Manual songwriting tests

- Detect rhymes across different spelling and ambiguous pronunciation.
- Distinguish a typed line from a bar: do not infer line = one bar.
- Test contractions, hyphenated compounds, slang, named entities, punctuation and emoji.
- Confirm AI respects mood, narrator and approved lines.
- Compare user-selected hook options without replacing the original.
- Simulate loss of AI connection, internet, and unexpected editor close.
- Verify mobile keyboard, selection, scroll, long-line wrapping and bottom sheet behaviour.

### Privacy and legal

- Preserve dictionary and source licences/attributions.
- Do not collect song text without user permission; don't accidentally send full song library to APIs.
- Explicitly disclose when a lyric excerpt is sent to an AI provider.
- Never log API keys; no keys in frontend bundles.
- No copyrighted commercial-song corpus bundled without permission.

---

## 10. Coding-agent working agreement and GitHub policy (v1.2 — mandatory)

### Absolute approval gate — planning is not permission to build

- **Status: PLANNING ONLY / NOT AUTHORISED TO BUILD.** The presence of this file in Claude Code or Codex is NOT permission to implement anything.
- Until the owner gives an explicit instruction such as **"Start Phase 0 now"**, agents may **read files, inspect the existing project, explain requirements, and propose plans** only.
- Before that command, do **not** initialise Git, create GitHub repositories, install dependencies, modify source, write application code, run builds, start servers, create CI workflows, commit, push or deploy. Do not interpret vague acknowledgements as approval.
- Every subsequent phase needs a fresh explicit authorisation: **"Start Phase 1"**, **"Start Phase 1B"**, etc. Approval for one phase never permits the next.
- The owner can pause development at any time. No background or autonomous continuation is permitted.

### GitHub rules once Phase 0 is explicitly authorised

1. Ask the owner for an **approved GitHub repository destination** (existing repository URL or new repository name), GitHub account permissions, and whether it must be private. **Default to private** and do not create or connect a repository without permission.
2. Use Git for source versioning. Work in a dedicated branch for each phase, e.g. `phase-0-setup`, `phase-1-editor`, `phase-1b-music`, `phase-2-rhymes`. Keep `main` stable.
3. Commit and **push each authorised, completed and tested stage** to the approved GitHub repository. Prefer a pull request for review and merge into `main` only when the owner approves; publishing the stage branch is sufficient until approval.
4. Do not push code that fails required tests as a completed phase. If blocked, explain the issue; request permission to push a clearly labelled work-in-progress branch if desired.
5. Record the commit SHA, remote branch, pull-request URL (if any), tests run, pass/fail status, and known limitations in `HANDOVER.md` and the end-of-phase report. Never claim a push succeeded without confirming it.
6. No secrets, API keys, tokens, `.env`, personal song files, private audio, SQLite databases, local paths containing private data, or large imported media in Git. Maintain and test `.gitignore`. Use environment variable examples without real credentials. Avoid Git LFS unless separately approved.
7. GitHub Actions CI may run tests after pushing. Do not configure deployment/release workflows, billable cloud jobs, or automatic publishing without explicit owner approval.
8. If GitHub access/network/permissions are missing, keep the tested work and local commit intact and **report push blocked**. Do not claim the phase is fully published or proceed to the next phase.
9. Do not force-push, delete branches or repositories, rewrite shared history, or publish the repository publicly without explicit approval.

### End-of-phase sequence (only after a phase has been authorised)

1. Read `PROJECT_SPEC.md`, `AI_RULEBOOK.md`, `HANDOVER.md` and this plan. Inspect actual repository state.
2. Explain the limited scope and implement **only** the authorised phase.
3. Run required tests and manually verify the phase acceptance criteria.
4. Update `HANDOVER.md` and any relevant documentation.
5. Check tracked files for credentials, private lyrics/audio and generated files; create a descriptive commit.
6. Push the stage branch to approved GitHub remote; confirm remote commit and CI result where available.
7. Deliver the end-of-phase report and **STOP**. Do not merge or begin the next phase without separate owner approval.

**Required end-of-phase report format:**

```text
AUTHORISED PHASE:
What changed (plain English):
How to run it (copy-paste commands):
Tests executed and results:
What I personally need to test:
Known problems or limitations:
Files changed:
GitHub repository (private/public):
Branch and commit SHA:
Push status (confirmed / blocked):
Pull request and CI status (if configured):
Next phase (NOT started):
Awaiting explicit approval: YES
```

---

## 11. Approved v1.1 feature inventory and delivery map

All **15** optional enhancements suggested during planning are **approved**, plus built-in music player/playlist support. **Do not silently drop any item.** Full acceptance requirements may be developed during the corresponding phase, but functionality should be demonstrated and tested before that phase can be accepted.

| # | Approved feature | Main phase |
|---|---|---|
| 1 | Multisyllabic Rhyme Laboratory | 5 (build on phase 3) |
| 2 | Metaphor and Wordplay Workshop | 6 (AI base in phase 4) |
| 3 | Cliché and Repetition Detector | 5 |
| 4 | Song Idea and Concept Board | 5 |
| 5 | Flow Designer | 5 |
| 6 | Vocal Take Recorder | 6 |
| 7 | Singability and Breath Assistant | 6 |
| 8 | Hook Testing Laboratory | 5 |
| 9 | Lyric Structure Scanner | 5 |
| 10 | AI Writing Personas | 6 |
| 11 | Personal Writing DNA | 6 |
| 12 | Voice-to-Lyrics Capture | 6 |
| 13 | Punchline and Hook Vault | 5 |
| 14 | Alternative Takes | 5 |
| 15 | Songwriting Training Mode | 6 |
| 16 | **Built-in music player, local imports and personal playlists** | **1B (required early)** |

**Practical schedule:** Phase 0 -> Phase 1 -> **Phase 1B Music** -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7. The player is delivered early so the owner can write while listening even before AI and advanced beat alignment work.

### Technical precautions for the music library

- First determine how the app is deployed. Browsers have sandboxed file APIs and may not retain access to arbitrary disk paths. The Python desktop backend can maintain a managed library for PC, but mobile browsers cannot use a PC-only path. Use explicit media import/copy/relink instead of assuming permanent browser paths.
- Store files or file references in a well-defined, non-public location outside the source tree. Use allow-listed formats, filename/path sanitisation, maximum import limits, and safe streaming. Prevent local file path traversal or unwanted file serving.
- Support MP3 and WAV if the actual runtime supports them; test AAC/M4A, FLAC, OGG/Opus per browser/OS and display compatibility rather than falsely guaranteeing every codec. Do not transcode unsupported formats automatically in the MVP.
- Distinguish metadata backup from large audio file backup. Default backup exports project and playlist metadata, with an optional separately labelled media-inclusive archive.
- If supporting reference commercial music, only use files the user is entitled to possess/play. Don't embed or share audio content in AI prompts or project exports by default.
- Audio controls, waveform, metronome and later recordings should use a consistent transport clock where practical; specify pause/seeking/loop edge cases before advanced timing code.

---

## 12. First message to paste into Claude Code or Codex (planning only)

> Read `STUDIO_BARS_MASTER_BUILD_PLAN.md` **version 1.4** in full. It covers the English-only Hip-Hop, R&B, House and Pop app, the 15 approved enhancements, music player, and GitHub-per-stage policy. **PLANNING ONLY: YOU ARE NOT AUTHORISED TO BUILD ANYTHING YET.** Do not write code, initialise repositories, install anything, run builds, commit, push, create GitHub repositories, or deploy. Review the plan and tell me what is required before Phase 0. Wait for my exact instruction **"Start Phase 0 now"**. Once authorised, complete only that phase, test it, commit and push its verified work to the GitHub repository I approve, then stop and wait for my order before starting another stage. Explain everything in plain English.

---

## 13. Open design decisions (resolve when relevant, not with speculative building)

- Editor implementation: structured line editor vs rich text; choose based on data integrity/mobile input.
- Local desktop packaging: browser-launcher for MVP vs bundled Python/Tauri for release.
- AI provider: choose only when Phase 4 begins, based on current pricing, privacy, API limits and required quality.
- Pronunciation support: start with US-dictionary baseline, add British or user-defined variants with proven data.
- Genre-specific rules: calibrate from research and user tests; allow easy personal adjustment.
- Chord display alongside lyrics: now approved as part of the optional melody/chord workspace; implement only when its specifically authorised phase begins.
- Music player storage: decide at Phase 1B whether desktop uses managed copies or user-selected linked files; verify Android storage behavior rather than promising cross-device file availability.
- Playback and licensing: local file player only; no third-party streaming-platform integration unless separately approved.



---

## 14. Approved v1.3 expansion: competitor-informed tools (PLANNING ONLY)

**Approval scope:** The owner approved **all twelve** proposed additions and the accompanying **Writing Session Mode**. These requirements expand the product roadmap; approval of features is **NOT permission to code, build, create a repository, commit, push or begin a phase**. The absolute approval gate in Section 10 still applies. Preserve existing features, phase sequencing and Royal Blue & Amber design.

| # | Feature | Delivery point | Minimum acceptance requirements |
|---|---|---|---|
| 17 | **Melody Sketchpad** | Advanced melody stage (after Phase 6) | Draw/edit pitched notes and durations; play back a simple melody; link lyric syllables to notes; save/restore without damaging lyrics. |
| 18 | **Hum-to-Melody** | Advanced melody stage | Record short humming/singing; estimate notes and timing; show confidence/uncertainty and allow manual correction; no accuracy guarantees. |
| 19 | **Lyric-to-Melody Fitter** | Advanced melody stage | Compare selected line's syllables and probable stresses with note timing; propose non-destructive adjustments; preserve locked lines. |
| 20 | **Pitch-preserving variable-speed player** | Phase 1B extension | Speed selection, including 0.75x/0.85x/1.0x, with pitch preserved where supported; verify browser/desktop behaviour and sound quality; speed changes must not affect lyric text. |
| 21 | **Automatic beat and section detection** | Phase 6 audio stage | Estimate BPM, beat/downbeat positions and tentative sections, show confidence; allow manual edits; never represent estimates as ground truth. |
| 22 | **Lyric-to-audio synchronisation** | Phase 5/6 | User links lines to timestamps or bars; during playback highlight/optionally auto-scroll current lyric; clicking mapped line seeks audio; manual correction. |
| 23 | **Advanced rhyme search filters** | Phase 2/3 | Filter by rhyme quality, syllable count, word stress, part of speech and approximate frequency; explain when any filter's data is missing. |
| 24 | **Context-aware dictionary** | Phase 3/4 | For selected word show pronunciation, definitions, synonyms, antonyms, rhymes and related imagery; distinguish dictionary facts from AI proposals; context-aware ranking. |
| 25 | **Lyric import/conversion** | Phase 1 extension | Import TXT/Markdown and, in later stage, DOCX/PDF; preview section parsing, preserve original and confirm before replacing; report extraction failures. |
| 26 | **Line comments and notes** | Phase 1 extension | Attach/edit/delete comments against stable line IDs; survive reorder, autosave and revision restore; protect locked lyrics. |
| 27 | **Optional real-time collaboration** | Future, separately authorised expansion | Permissions, authenticated access, conflict handling, revision attribution, privacy/security checks; **do not enable by default**. |
| 28 | **Keyboard shortcuts and Focus Mode** | Phase 1 extension | Desktop shortcut list with editor-safe key handling, hide panels without losing content; mobile writing focus leaves minimal music transport visible. |
| 29 | **Writing Session Mode** | Phase 1B foundation, expanded Phase 5/6 | Open song + linked audio/playlist + writing pad + relevant rhyme tools in one workspace; remember session state and loop/position; don't interrupt typing or autosave. |

### Related competitor-informed enhancements also accepted in principle
- **Chord display alongside lyrics** in the advanced melody workspace; independent toggle and manual chord editing. It must not require building a full digital audio workstation.
- **Automatic scrolling and linked navigation** as part of feature 22.
- **Adjustable tempo, replay and loop aids** within the integrated music player.
- **No priority for built-in beat generation, external MIDI controller mapping, full DAW functionality or stem separation** in the core roadmap. These are not required Phase 0–7 deliverables.

### Build order changes (maintain small, independently authorised stages)
- **Phase 0:** Environment planning and foundation; no app code until specifically authorised.
- **Phase 1:** Basic editor and storage; add line comments, TXT/Markdown import, shortcuts and Focus Mode as separately testable tasks within this authorised phase. DOCX/PDF import can follow after reliable basic import.
- **Phase 1B:** Local music player, playlists, pitch-preserving speed changes and Writing Session Mode foundation.
- **Phase 2:** Pronunciation and rhyme analysis, including advanced filters where dictionaries support them.
- **Phase 3:** WordNet/Datamuse/word library, context-aware dictionary and vocabulary search.
- **Phase 4:** AI co-writer, non-destructive revisions and contextual suggestions.
- **Phase 5:** Advanced lyric features, bar/flow tools, lyric-to-timestamp mapping and Writing Session improvements.
- **Phase 6:** Vocal recording, beat/section detection (with manual corrections), lyric-to-audio synchronisation, voice capture and advanced analysis.
- **Phase 7:** Packaging, responsive mobile and Windows release checks. Do not imply advanced melody features are already finished.
- **Phase 8 (NEW, separate approval):** Melody Sketchpad, lyric-to-melody fitting, hum-to-melody and optional chord display.
- **Future independent approval:** Real-time collaboration; not part of initial personal-use release.

### Verification and technical guardrails
1. **No automatic rewrite:** Import, AI editing, melody fitting, comments, and timing updates must never change a locked lyric. Show proposed changes before applying.
2. **Audio timing:** Persist explicit source-audio IDs and line-level timing ranges. Changing speed must preserve logical source timestamps; mapping and loop playback must remain consistent.
3. **Playback constraints:** Pitch-preserving playback varies by browser, codec, device and rate; test each supported target and fall back clearly if unsupported.
4. **Music analysis limits:** BPM, downbeat, section boundaries and hummed notes are estimates. Supply confidence markers, easy manual override and test clips with known answers.
5. **Import safety:** Validate size and format; parse DOCX/PDF using suitable packages only after approval. Never execute embedded content. Scanned PDFs might need manual entry or optional extraction, not guaranteed parsing.
6. **Privacy:** Store personal lyrics and imported audio locally by default. No unrestricted remote media URLs, no uploaded private media or song archives in GitHub.
7. **Performance:** Keep media playback independent from expensive AI/rhyme analysis. No UI freezes while typing on phone or PC.
8. **Tests:** Add automated persistence, lock integrity, comment stability, import-preview, timing-seek, speed, and responsive layout checks appropriate to each phase.
9. **Traceability:** For every feature maintain an issue/task ID, acceptance tests and progress state in `HANDOVER.md`. Do not mark an item finished based only on a mock-up.
10. **GitHub stage policy:** After explicit approval to build a stage, test, commit and push to the owner's approved private remote stage branch, verify the push, report it, and STOP. No automatic next phase.

### Naming caution
The project name **Studio Bars** is a placeholder. Check name/domain/trademark availability before public distribution; do not assert availability without research.

**CURRENT STATUS: PLANNING ONLY. NO IMPLEMENTATION OR GITHUB CHANGES AUTHORISED.**



---

## 15. Studio Bars starter-pack operating policy (v1.4)

This master document is accompanied by:
- `START_HERE.md` for the owner.
- `CLAUDE_CODE_PLANNING_PROMPT.md` for the first Claude Code session.
- `CODEX_PLANNING_PROMPT.md` for the first Codex session.
- `PHASE_APPROVAL_TEMPLATES.md` for phase-by-phase authorisation.
- `GITHUB_WORKFLOW.md` for verified stage publishing and secrets protection.
- `PHASE_TRACKER.md` for acceptance and stage sign-offs.
- `PRODUCT_DECISIONS.md` for explicit decisions and open questions.
- `RESEARCH_SOURCES.md` for the selected technical and songwriting references.

**Permission:** Approval of the product plan or features is not approval to build. Only an unambiguous owner instruction naming a specific phase authorises it. No autonomous next phase, no unapproved repo creation, and no accidental public repository.

**Naming:** `Studio Bars` is a temporary project name, not a verified trademark or public product name.

**Status:** PLANNING ONLY. No code, dependency installation, GitHub activity or builds are authorised.

**End of master plan.**
