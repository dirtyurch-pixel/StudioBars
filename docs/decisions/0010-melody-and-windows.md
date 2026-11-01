# 0010: Melody sketch (Phase 8 core) and Windows launch (Phase 7 core)

Status: built (core set); awaiting owner review.

## Melody sketch
- Notes on a 16th-note grid (4/4, up to 64 bars; C2 to C7), one chord symbol per bar. Stored in its own tables (migration 9); lyrics are never touched.
- **Hum to melody**: the browser listens through the microphone, estimates one pitch every ~30 ms with autocorrelation (`frontend/src/melody/pitch.ts`, tested with synthetic tones, silence and noise), smooths it, and snaps runs of steady pitch to notes on the grid at the song's BPM. It handles ONE voice at a time; breathy, quiet or noisy humming gives "no clear pitch". The result is a starting sketch to correct by hand, not a transcription.
- **Lyric fit** compares the section's estimated syllables with the number of notes in plain words.
- Chord symbols are checked against a simple pattern (C, Am, G7, Fmaj7, D/F#, Bbm, Esus4, Cadd9 ...). There is no automatic chord detection or suggestion.
- Not built: audio playback of chords, key detection, lyric-to-melody *generation*, MIDI export.

## Windows
- `start-studio-bars.bat` (this PC only) and `start-studio-bars-phone.bat` (PIN-protected, same Wi-Fi) build the app and start one server. They have **not been run on Windows**. A real installer (.exe) is not built.
