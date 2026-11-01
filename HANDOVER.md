# Handover

## Current state
- Phase 0 (foundation), Phase 1 (editor, locks, autosave, history, notes, import/export), Phase 1B (music player, playlists) and Phase 2 (pronunciation, syllables, rhymes) are done.
- Phase 3 (word meanings, phrase bank, optional online helper) done.
- **Phase 4 (AI co-writer): built, tested here against local stand-ins for Claude, awaiting owner review.** Phase 5 is NOT started and not authorised.

- **Phone/tablet mode (owner request, outside the original phase order): built.** One address, mandatory PIN, installable. Phases 5-8 are NOT built.

## How to run / check
- Run: `./scripts/dev.sh` (Windows: `.\scripts\dev.ps1`, not yet run on Windows) then open http://localhost:5173
- Unit + lint + type + build: `./scripts/check.sh`
- Real-browser acceptance tests (Phases 1, 1B, 2, 3, 4): `./scripts/e2e.sh` (throwaway database and media folder; the online helper and the AI co-writer are pointed at local stand-ins, so no test touches the internet or spends money; needs Playwright Chromium)

## What Phase 3 added
- **Words tab**: meanings from WordNet 3.0 shown one meaning at a time (definition, examples, synonyms, opposites, "a kind of", "kinds of it", related, imagery), common meaning first, **⚠ on synonyms whose meaning may shift**, meanings ordered by what fits the line you are on, and how each meaning of lead/tear/bass/wind… is said.
- **Rhymes tab**: part-of-speech filter now works (noun/verb/adjective/adverb); **Phrase (experimental)** mode matches the last 1–4 syllables of a phrase; optional online rhymes.
- **My phrases**: personal slang/phrase bank (meaning, "sounds like", tags, search, tag filter, export).
- **Online ideas** (Datamuse): **off by default**, sends only one typed word, saved answers, offline fallback.
- Design, rules and licence notes: `docs/decisions/0006-meanings-phrases-online.md`.

## What Phase 4 added (AI co-writer)
- **AI tab** (off until set up). Tasks: next line, rewrite, shorter, more conversational, stronger imagery, stronger punchline, more emotion, rhyme help, hook ideas, structure ideas, critique.
- **The AI only proposes.** Candidates are labelled "AI suggestion" with a local syllable estimate and a rhyme badge (both computed by this app, never taken from the AI). You choose Preview, Insert below, Replace (asks first) or Copy. Insert/Replace use the same guarded edit path as typing, so **a locked line can never change**, and Undo works. Locked lines are sent as read-only context; asking to rewrite a locked line is refused before anything is sent.
- **Two steps, always:** "Show what will be sent" (no network, shows the exact text, section list, estimated and worst-case cost) then "Send to AI". The server refuses to send unless the text you saw is still exactly what would be sent.
- **Your key stays on the host computer** (`data/private/ai_key_anthropic`, owner-only, git-ignored) or in the `STUDIO_BARS_AI_KEY`/`ANTHROPIC_API_KEY` environment variable. The browser sends it once and is never sent it back (only the last 4 characters). It is never logged.
- **Monthly spending limit** (default $5): each request is checked before sending using its worst-case cost; usage is counted from the token counts the provider reports.
- **Providers:** Claude through the official `anthropic` SDK (default model Claude Opus 5.5; Haiku 5.5, Sonnet 5.5 and Fable 5.1 selectable with a per-request cost estimate), or any OpenAI-compatible server such as Ollama (free, local, prices default to 0).
- Bad answers (not JSON, markdown, labels, duplicates, copies of your own lines, refusals) are dropped; if nothing usable is left you see "nothing was changed".
- Design and rules: `docs/decisions/0007-ai-cowriter.md`.

## Phase 4 test evidence (Linux container; not Windows, not a phone/tablet)
- Backend: 303 pytest tests (48 new: key never returned or logged, no AI writes to the lyric tables, locked-line refusal and read-only context, hash must match, changed song invalidates it, budget blocks before sending, rate limit, every provider error mapped to a plain message without leaking the key or lyrics, refusal, malformed answers, offline, OpenAI-compatible adapter, prompt-injection text stays data).
- Frontend: 156 Vitest tests (AI panel, setup, insert operation).
- Browser: 28 Phase 4 checks plus 37 + 48 + 45 + 62 from earlier phases, run in sequence.
- **Not tested:** a real call to Claude. No key was available here and a key must never be pasted into chat. The code path is exercised against local servers that speak Claude's wire format through the real SDK; the first real call happens when you add your key on your computer and press "Test connection".

## Phase 3 test evidence (Linux container; not Windows, not a phone/tablet)
- Backend: 255 pytest tests (all earlier ones plus WordNet file integrity and licence, reading and base forms, meanings by sense, synonym shift flags, line-aware ranking, every heteronym checked against the dictionary, the online helper incl. the real network code against a local test server, phrase bank, phrase rhymes, part-of-speech filter, security cases).
- Frontend: 141 Vitest tests (Words panel, online helper, phrase bank, phrase rhymes, Rhymes panel changes).
- Browser: 62 Phase 3 checks plus 37 + 48 + 45 from earlier phases, run in sequence on one server, repeated.
- One real request to the live Datamuse service (the single word "fade") confirmed the adapter handles its actual answers.

## Licensing and terms (needs your attention)
1. **WordNet 3.0** (27 MB, unmodified, Princeton licence travels with every copy).
2. **Datamuse**: free and keyless today, **API key required from 1 February 2027** (100,000/day/key). Their public page does not say how a key is sent, so none is sent; after that date the helper will report "may now need an API key" and fall back to saved answers. Acknowledgement is in the README and `licenses/README.md`. Decision for you: do you want an online helper at all once a key is needed? It can simply stay off.
3. Carried over from Phase 2: the CC BY-SA word-familiarity list (optional, removable). The repository is public.

## Known limitations (honest list)
1. **Not tested on a real phone/tablet or on Windows.** Phone checks use a phone-sized browser window.
2. **"Fits your line" is word matching, not understanding.** Short or generic lines often tie, and then no meaning is crowned best. It never hides a meaning.
3. WordNet is a 2006 dictionary: little slang, few modern terms, no sense of tone or genre. It lists *possible* meanings; it cannot say which one you intend.
4. "Usually a noun/verb…" comes from WordNet's small tagged-usage counts and can be debatable (for instance "fast" ranks as an adverb first). Words WordNet does not know are left out of that filter, with a count.
5. **Phrase rhymes are experimental**: they use the first dictionary pronunciation of each word, compare only the end of the phrase, and only find single words and your own saved phrases/words (not arbitrary multi-word rhymes).
6. The online helper cannot be used after Datamuse starts requiring a key until a key mechanism is added. Offline saved answers are kept 7 days as "fresh" and longer as "saved".
7. A heteronym table covers about 23 words; other same-spelling words show one pronunciation. The dictionary lacks the "argument" sound of *row*.
8. AI limits: it cannot verify that a suggested line is original (it is told not to quote songs, but you must judge); syllable counts are estimates; the AI sees only what the preview shows; the SDK retries a failed request once. Server-side model fallbacks are deliberately NOT enabled (needs your decision).
9. Earlier limitations still apply (no phone access to the PC yet, music stays on the host computer, local API has no sign-in, `dev.ps1` unrun on Windows, `npm audit` notices unreviewed, US pronunciations only).

## Bugs found and fixed while testing Phase 3
- Looking up a word after clicking a new line briefly used the *previous* line as context, so the wrong meaning of "bank" came first. Context from a new line now applies immediately; only typing within a line waits.
- The line you are on and the lines beside it were mixed together, so a stray word next door could outvote the real clue. The current line now counts double.
- After opening a phrase's rhymes once, the Rhymes tab kept jumping back to phrase mode every time. The request is now used once.
- The Words tab asked the server again on every keystroke and flickered; it now waits for a pause and keeps the last answer on screen.
- Four entries in my heteronym table disagreed with the dictionary; found by a consistency test and corrected.
- **Import dialog race (an old Phase 1 bug, found only by CI):** reading a chosen file takes a moment, and when it finished the dialog filled the title from the file name using a stale copy of the title, so a title you had already typed was replaced by the file name ("e2e"). It never failed on the fast development machine; it failed on the slower GitHub runner. Fixed (the current title is checked when applying), with a regression test proven to fail on the old code. To catch such things sooner, every browser suite now prints the page text and failed requests when it crashes, and the test script prints the backend log.
- The online helper's rate limit was too tight for tapping through words quickly (a burst of 5); it is now a burst of 10 then about 2 per second.

## Open items for owner
- Whether to keep the online helper once Datamuse needs a key (or leave it off).
- Keep or remove the CC BY-SA familiarity list (Phase 2 item).
- Phone access model (docs/decisions/0002-phone-access.md).
- Real-device test of typing, rhyme tools, Words tab and music on a phone/tablet once a way to run the app there exists.
- Plan fixes proposed earlier: phase numbering, split Phases 5 and 6, add LineTiming/ChordMark tables before they are needed.
