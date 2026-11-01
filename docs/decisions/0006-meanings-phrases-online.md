# 0006 Word meanings, phrase bank and the optional online helper (Phase 3)

## Where the dictionary facts come from
**Princeton WordNet 3.0**, bundled unmodified (`backend/app/lexicon/data/wordnet/`, checksummed, licence kept with every copy at `licenses/wordnet-LICENSE.txt`). It works entirely offline. Nothing in the Words tab is produced by AI; the tab says so, and when the AI co-writer arrives (Phase 4) its suggestions will be labelled separately.

## Meanings, synonyms and "meaning may change"
- Each **meaning** is shown separately, most common first within each part of speech, with its own definition, examples, synonyms, opposites, "a kind of", "kinds of it", related words and imagery (parts and make-up).
- Parts of speech are ordered by how the word is actually used (WordNet's tagged-usage counts, then number of meanings).
- A synonym gets a **⚠** when this meaning is not its commonest one. Hovering says what it usually means instead ("firm" more often means "securely fixed"). Safe synonyms are listed first.
- Adjectives have no true synonyms in WordNet; their linked group (quick, speedy for fast) appears as **Close in meaning**.
- **Fits your line**: meanings are re-ordered by word overlap with the line you are writing (that line counts double, neighbouring lines once). It is simple word matching, not understanding, and the panel says so. When two meanings tie, nothing is crowned "best".

## Same spelling, different sound
A small table (`heteronyms.py`, ~23 words such as lead, tear, bass, wind, live, close) shows how each *meaning* is said. A test checks every entry against the CMU dictionary, so it cannot drift. Known gap: the dictionary lacks the "argument" pronunciation of *row*, and spells the noun *refuse* with a Z.

## Part-of-speech filter for rhymes
"Usually a noun / verb / adjective / adverb", from WordNet's tagged-usage counts and base-form rules (made → make, so "made" is a verb). Words WordNet does not know (names, slang, some inflections) are left out and the panel says how many.

## Phrase bank
Your phrases and slang with meaning, "sounds like", and tags; search across all of them; duplicates refused; export to a JSON file. Syllables and sound come from the words themselves or from "sounds like". Stored only in your local database.

## Phrase rhymes (EXPERIMENTAL)
Compares the last 1 to 4 syllables of a phrase with single words and your own phrases/taught words: *perfect* (same sounds), *near* (alike consonants), *same vowels*. It uses the first dictionary pronunciation of each word in your phrase and cannot find multi-word rhymes that are not in your phrase bank. It is labelled experimental everywhere until it has been checked against real use. The fuller Multisyllabic Rhyme Laboratory is Phase 5.

## Optional online helper (Datamuse)
- **Off by default**, switched on by a checkbox that states what it does. Your choice is remembered.
- Only **one word** (typed or selected) is ever sent: no lyrics, no titles, no cookies, no identifiers. The request is made by the Studio Bars server, not your browser.
- Every answer is labelled **online** (live) or **saved copy**. Answers are kept 7 days; when the service is unreachable you see the saved answer, marked as saved, or a plain message if there is none. Writing is never affected.
- Safeguards: 4 s timeout, a rate limit (a burst of 10, then about 2 per second: plenty for tapping through words, far below Datamuse's limits, and it stops any runaway loop), at most 5,000 saved answers.
- **Datamuse's terms today** (datamuse.com/api, read 2026-11-01): free and keyless now, but **from 1 February 2027 an API key is required** on every request, limited to 100,000 requests per day per key. Their public page does not say how a key is passed, so the app sends none: after that date the service will refuse requests, the app will say "it may now need an API key", and saved answers keep working. Adding a key means getting one from Datamuse and adding one small step to `lexicon/online.py` once their documentation says how; the key would live only on the server side and never in the browser or in Git.
- Datamuse asks apps to acknowledge it in their documentation: **this app uses the Datamuse API (https://www.datamuse.com/api/) for the optional online helper.** Datamuse says its servers keep a temporary log of queries, discarded at the end of the day.
- Tested with a real request against the live service on 2026-11-01 (one word, "fade"); automated tests use a local stand-in and never touch the internet.

## Not in Phase 3 (by design)
AI proposals (Phase 4), the full Multisyllabic Rhyme Laboratory (Phase 5), a Datamuse API key (see above), British word forms, word-sense disambiguation beyond line-overlap, insertion of words into the lyric (nothing in this phase ever writes to your lyrics).
