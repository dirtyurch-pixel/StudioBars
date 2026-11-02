# Licence and attribution plan

Phase 0 bundled no third-party data. **Phase 2 bundled two data files and Phase 3 adds WordNet (27 MB, unmodified)** (see `backend/app/phonetics/data/README.md`): the CMU Pronouncing Dictionary (CMU permissive licence: `cmudict-LICENSE.txt`) and an optional word-familiarity list derived from `wordfreq` (CC BY-SA 4.0: `wordfreq-NOTICE.txt`). Dependencies are standard open-source packages (React, Vite, Tailwind, FastAPI, etc.) under their own licences (see `package-lock.json` / `requirements.txt`).

Later phases, to verify at the time of use and record here with full notices:
- CMU Pronouncing Dictionary (Phase 2): DONE, upstream file, notice kept
- Princeton WordNet 3.0 (Phase 3): DONE, unmodified files, full licence kept with every copy (`wordnet-LICENSE.txt`), checksum manifest tested
- Datamuse API (Phase 3, online, optional, off by default): terms read 2026-11-01. Free and keyless until 1 Feb 2027, then an API key is required (100,000 requests/day/key). **Acknowledgement: this app uses the Datamuse API (https://www.datamuse.com/api/) for the optional online helper.** See `docs/decisions/0006-meanings-phrases-online.md`.
- Word frequency: DONE for Phase 2 (derived list, CC BY-SA 4.0, optional). Part-of-speech data: DONE in Phase 3 (WordNet).
- Anthropic Python SDK `anthropic` 2.3.0 (Phase 4, MIT licence, listed in `backend/requirements.txt`): used only when you turn the AI on with a Claude key. Claude is a trademark of Anthropic; this app is not made or endorsed by Anthropic. See `docs/decisions/0007-ai-cowriter.md`.
- Anthropic TypeScript SDK `@anthropic-ai/sdk` 0.134.0 (phone version, MIT licence, listed in `frontend/package.json`): used only when you turn the AI on with your Claude key.

## Fonts (Design A, "Asphalt & Orange")
- DM Sans, Barlow Condensed and Archivo Black, bundled through `@fontsource/*` (npm), so they work offline.
  All three are licensed under the SIL Open Font License 1.1 (the licence text ships inside each package's `LICENSE`).
