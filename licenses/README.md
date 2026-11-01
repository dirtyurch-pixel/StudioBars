# Licence and attribution plan

Phase 0 bundled no third-party data. **Phase 2 bundles two data files** (see `backend/app/phonetics/data/README.md`): the CMU Pronouncing Dictionary (CMU permissive licence: `cmudict-LICENSE.txt`) and an optional word-familiarity list derived from `wordfreq` (CC BY-SA 4.0: `wordfreq-NOTICE.txt`). Dependencies are standard open-source packages (React, Vite, Tailwind, FastAPI, etc.) under their own licences (see `package-lock.json` / `requirements.txt`).

Later phases, to verify at the time of use and record here with full notices:
- CMU Pronouncing Dictionary (Phase 2): DONE, upstream file, notice kept
- Princeton WordNet (Phase 3)
- Datamuse API terms (Phase 3, online, optional)
- Word frequency: DONE for Phase 2 (derived list, CC BY-SA 4.0, optional). Part-of-speech data: Phase 3 (WordNet).
