# 0009: Writing helpers, personal style and scratch vocals (Phase 6, core set)

Status: built (core set); awaiting owner review.

## Built
- **Helper styles** (AI personas): Co-writer, Lyric editor, Rhyme specialist, Vocal coach, Critical reviewer. They are just extra visible instruction lines added to the system prompt (shown in the UI, included in the "what will be sent" hash). The safety rules (locked lines, data-not-instructions, plain single lines) are always kept. They are not separate agents.
- **Metaphor ideas** and **Wordplay / double meaning** AI tasks (rewrite the chosen unlocked line).
- **My style (Writing DNA)**: opt-in per song, computed on demand from approved songs, never stored as a file, never sent to the AI, forgettable in one click.
- **Singability and breath** notes in the Scan tab: lines that are long for one breath (with a suggested breath point) and consonant pile-ups. Estimates from the dictionary, not from a recording.
- **Scratch vocal recorder**: records in the browser (MediaRecorder), stores the file in the media folder, plays it back, lets you nudge the start offset and add a note. The offset is where the music was when you pressed record; **microphone and device delay are not measured**, so nothing claims exact sync.

## Important limits
- Browsers allow the microphone only on **https:// or localhost**. Over plain `http://192.168…` on a phone or tablet the recorder shows an explanation instead of a button. To record on a phone, serve the app over https (for example behind a private tunnel such as Tailscale).
- Recorded files are not removed when a song is moved to the trash (only when the take is deleted).
- Use headphones if recording over playing music.

## Not built from the Phase 6 list
Waveform display and beat markers on the player, voice-to-lyrics transcription (needs an online or on-device speech model and explicit design), Songwriting Training Mode lessons, forced alignment/audio analysis (the plan says not to promise it without validation).
