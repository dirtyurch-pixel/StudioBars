# Language data (offline, read-only)

| File | What | Source | Licence |
|---|---|---|---|
| `cmudict.dict` | CMU Pronouncing Dictionary (135,166 entries; ARPAbet phonemes with stress digits) | https://github.com/cmusphinx/cmudict (`cmudict.dict`, `master`, retrieved 2026-11-01) | CMU permissive notice, see `licenses/cmudict-LICENSE.txt`. Copyright (C) 1993-2015 Carnegie Mellon University. |
| `frequency_en.tsv` | 60,000 most common English words with Zipf frequency | Derived from `wordfreq` 3.1.1 | CC BY-SA 4.0, see `licenses/wordfreq-NOTICE.txt`. Optional. |

`cmudict.dict` is the unmodified upstream file. SHA-256:
`81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22` (a test checks this).

The Python package named `cmudict` on PyPI is a wrapper licensed GPL-3.0-or-later. **Studio Bars does not use it**; only the original CMU data file is used, so no GPL code is included.

Nothing here is downloaded at run time: pronunciation and rhyme lookups work fully offline.
