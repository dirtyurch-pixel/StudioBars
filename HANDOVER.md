# Handover

## Current state
- Phase 0 (foundation), Phase 1 (editor, locks, autosave, history, notes, import/export) and Phase 1B (music player, playlists) are done.
- **Phase 2 (pronunciation, syllables and rhyme tools): built, tested here, awaiting owner review.** Phase 3 is NOT started and not authorised.

## How to run / check
- Run: `./scripts/dev.sh` (Windows: `.\scripts\dev.ps1`, not yet run on Windows) then open http://localhost:5173
- Unit + lint + type + build: `./scripts/check.sh`
- Real-browser acceptance tests (Phase 1, 1B and 2): `./scripts/e2e.sh` (throwaway database and media folder; needs Playwright Chromium)

## What Phase 2 added
Offline CMU dictionary (126,052 words) with sound-based rhyme search; syllable estimates in the margin (range for ambiguous words, `~` for guesses); rhyme colours (end / all / off); a **Rhymes** tab with perfect / near / same-vowel / same-ending rhymes plus syllable, ending-type and familiarity filters; word lookup from the cursor line or a selected word; "Use only this one" for ambiguous words; unknown words can be taught ("sounds like…" or typed sounds); your pronunciations are saved and used everywhere. Design and rules: `docs/decisions/0005-pronunciation-and-rhymes.md`.

## Phase 2 test evidence (Linux container; not Windows, not a phone/tablet)
- Backend: 150 pytest tests, 71 of them new (data integrity hash, syllable counts incl. ambiguous words, rhyme quality levels, same-spelling/different-sound and different-spelling/same-sound cases, multisyllable rhymes, tokenizer offsets, contractions, -in' endings, hyphens, numbers, unknown words, custom pronunciations, filters, API validation, no network use, speed).
- Frontend: 101 Vitest tests, 41 of them new (highlight/segment logic, margin labels, debounced analysis that discards stale answers and survives an outage, pad overlay, Rhymes panel states).
- Browser: 44 Phase 2 checks plus the 37 Phase 1 and 48 Phase 1B checks, run in sequence on one server, repeated.
- Measured: dictionary loads in ~0.9 s (in the background at start-up), ~130 MB memory, ~0.6 ms to analyse a verse, ~35 ms for the widest rhyme search.

## Licensing (needs your attention)
1. **CMU dictionary**: unmodified upstream data file + CMU's notice. The PyPI `cmudict` package is GPL-3.0, so it is *not* used.
2. **Word-familiarity list** (`frequency_en.tsv`): derived from `wordfreq`, **CC BY-SA 4.0** with credits to Google Books Ngrams, Wikipedia, Leeds, ParaCrawl, OpenSubtitles and SUBTLEX (see `licenses/wordfreq-NOTICE.txt`). It is a separate, optional file in a public repository. If you prefer simpler licensing, delete it: the app keeps working and says the filter is unavailable. This is an owner decision.

## Known limitations (honest list)
1. **Not tested on a real phone/tablet or on Windows.** Phone checks use a phone-sized browser window.
2. **US pronunciations only** (CMU dictionary). British or regional ways of saying words need the "sounds like" tool. Rap and singing often stretch, drop or add syllables: counts are estimates from the dictionary, not a record of how you perform.
3. **Part-of-speech filter is shown but disabled** (the dictionary has no word classes). It arrives with WordNet in Phase 3.
4. Unknown words (slang, names, spellings like "2pac") get a vowel-group **guess** for syllables and cannot be searched for rhymes until you teach their sound. Numbers are read as plain numbers (808 → "eight hundred eight") and flagged as guesses.
5. Rhyme colours are computed for the visible section only (not across sections) and use the first dictionary pronunciation of each word. Near rhymes appear in the Rhymes tab, not as colours. Phrase/multisyllable rhymes across word boundaries are Phase 5.
6. Display choices (syllables vs line numbers, colour mode) are remembered on this device, not per song.
7. A very long line scrolls sideways inside its box; the colour layer follows it, but this is only checked in desktop Chromium.
8. Earlier limitations still apply (no phone access to the PC yet, music stays on the host computer, no sign-in on the local API, `dev.ps1` unrun on Windows, `npm audit` notices unreviewed).

## Bugs found and fixed while testing Phase 2
- On a phone, with a music track loaded, tapping any button while a text field had the keyboard open could **lose the tap**: the music bar grew over the button the instant focus left the field. The bar now waits before growing. (A Phase 1B interaction found only by Phase 2's tests; two new unit tests guard it.)
- The new display toolbar pushed the writing pad down the phone screen; it now lives in the collapsed options drawer on phones.
- Words you teach the app were buried under hundreds of dictionary rhymes; your own words now rank first within their rhyme quality.
- Small words (me, you, my…) were ignored as rhymes everywhere; they are now ignored only mid-line, where they are filler, and count at line ends.

## Open items for owner
- Keep or remove the CC BY-SA familiarity list (see Licensing)
- Phone access model (docs/decisions/0002-phone-access.md)
- Real-device test of typing, rhyme tools and music on a phone/tablet once a way to run the app there exists
- Plan fixes proposed earlier: phase numbering, split Phases 5 and 6, add LineTiming/ChordMark tables before they are needed
