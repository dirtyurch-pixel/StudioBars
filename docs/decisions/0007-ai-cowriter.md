# 0007: AI co-writer (Phase 4)

Status: built; awaiting owner review.

## Rules
1. **The AI only proposes.** No code path in the AI layer writes to songs, sections or lines. Text enters a song only when the writer presses Insert or Replace, and then through the editor's normal guarded edit (so locks hold and Undo works). Tests compare the database before and after.
2. **Locked lines are read-only context.** They are marked `[LOCKED]` in the prompt; rewriting a locked target is refused with HTTP 423 before anything is sent.
3. **Nothing is sent without a preview.** `POST /api/ai/prepare` builds the prompt (no network) and returns it with an estimated cost and a hash; `POST /api/ai/suggest` only proceeds if the hash still matches what the server would send now.
4. **Minimal context.** Title, genres and the current section's lines. Other sections only if the writer ticks the box (or for hook/structure/critique, which need the whole song, and the preview says so). Notes/comments are never sent.
5. **Key handling.** Stored on the host (file mode 0600 in git-ignored `data/private/`, or environment variable). Never returned to the browser (last 4 characters only), never logged; library debug logging is silenced because it prints whole requests.
6. **Spending limit.** Monthly cap (default $5) checked before every request against worst-case cost (estimated input + max output tokens). Prices are estimates in `ai/pricing.py` (Claude API price list read 2026-10-06); actual usage comes from provider token counts.
7. **Own the numbers.** Syllables and rhyme quality are recomputed locally with the Phase 2 engine; anything the model claims is ignored.
8. **Distrust the answer.** The model is asked for JSON only. The server strips numbering/bullets/quotes, rejects markdown, section labels, HTML, newlines, over-long text, duplicates and copies of existing lines, and caps candidates. If nothing is left: `BAD_AI_ANSWER`, "nothing was changed".
9. **Prompt injection.** Song text is wrapped in `<song_data>` tags (any such tag inside lyrics is removed) and the system prompt says it is data, never instructions.
10. **Originality** cannot be verified automatically. The model is told to write original lines and the UI says so; the writer decides.

## Providers
- **Anthropic** via the official SDK (`anthropic==2.3.0`). No `temperature` is sent (rejected by current models). `output_config.effort = "low"` except on Haiku. Refusals (`stop_reason: refusal`) and each error class map to plain messages. Default model `claude-opus-5-5`.
- **OpenAI-compatible** (raw HTTP): covers Ollama and similar, key optional, prices entered by the user (default 0 = free).
- Server-side `fallbacks` (automatic switch to another model) is **not enabled**; it changes cost and behaviour silently and needs the owner's decision.

## Not done / later
Streaming output, prompt caching (requests are small), per-song AI history view, using the writer's own phrase bank as AI context.
