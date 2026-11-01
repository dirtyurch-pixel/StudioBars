# 0005 Pronunciation, syllables and rhymes (Phase 2)

**Everything here works offline.** No lookup leaves your computer. The only network use in the whole app remains the local connection between the page and the Studio Bars server.

## Data and licences
- **CMU Pronouncing Dictionary** (126,052 words, ARPAbet sounds with stress). The unmodified upstream file from https://github.com/cmusphinx/cmudict is bundled with CMU's notice (`licenses/cmudict-LICENSE.txt`). The PyPI package called `cmudict` is a GPL-3.0 wrapper and is deliberately **not** used.
- **Word familiarity** (optional): a 60,000-word list derived from `wordfreq`, licensed **CC BY-SA 4.0** with the credits in `licenses/wordfreq-NOTICE.txt`. It is a separate data file; delete `backend/app/phonetics/data/frequency_en.tsv` and the app keeps working, with the familiarity filter switched off and a message saying why. *Owner decision:* keep it (better rhyme lists) or remove it (simpler licensing).
- **Part of speech** is not available: the dictionary has none. The filter is shown, disabled, with the reason; WordNet arrives in Phase 3.

## How a rhyme is decided (by sound, never spelling)
The "rhyme part" runs from the last strongly stressed vowel to the end of the word. Levels, best first:
1. **Homophone**: sounds exactly the same (write / right). Hidden unless you ask.
2. **Rich**: same ending and same starting sound (suppose / oppose). Hidden unless you ask.
3. **Perfect**: same rhyme part, different start (fade / made, nation / station).
4. **Near**: same vowel, ending consonants that sound alike (fade / late, home / stone).
5. **Same vowels** (assonance): fade / brave. 6. **Same ending** (consonance): bad / bed.
Perfect and Near are on by default; the others are one tap away. Results are ordered by quality, then your own taught words, then how familiar the word is.

## Syllables
Counted from the vowel sounds of the dictionary entry. A word with more than one dictionary pronunciation can have different counts (every 2–3, fire 1–2, family 2–3): the line then shows a **range** (e.g. 5–6) and the hover text names the words responsible. You can settle it with **Use only this one**. Unknown words get a vowel-group guess shown with **~**. About 2.6% of the 5,000 commonest words are ambiguous.

## Handling real lyrics
Contractions and `-in'` endings (nothin', runnin' are said with an N sound), possessives, hyphenated compounds, accents, curly quotes, emoji and numbers are tokenised with exact positions in your original text; nothing is ever rewritten. Numbers are read as ordinary numbers and flagged as guesses (808 is not "eight hundred eight" to a rapper: teach it).

## Rhyme colours
Computed per section. A "family" is two or more different words with the same rhyme part. Small filler words (the, to, and, me, my…) are ignored mid-line but count at a line end, because "me / free" and "you / blue" are classic end rhymes. Words with only a guessed sound never join a family. **End rhymes** colours line-ending families that have 2+ line ends; **All rhymes** also colours internal ones. Colours differ by hue *and* underline style so they do not rely on colour alone.

## Your own pronunciations
Stored in the database (one per word, replacing the dictionary version). Taught by "sounds like [word]" or by typing sounds. Removing one restores the dictionary. They also appear in rhyme results marked "mine".

## Not in Phase 2 (by design)
Phrase/multisyllable rhyme laboratory (Phase 5), British pronunciations, syllable stress "flow" grids (Phase 5), rhyme-colour settings stored per song (they are remembered per device), automatic grapheme-to-sound for unknown words.
