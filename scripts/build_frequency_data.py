"""Builds backend/app/phonetics/data/frequency_en.tsv from the `wordfreq` package.

NOT a project dependency: install wordfreq in a scratch environment, run this once, commit the TSV.
The output is derived from wordfreq's data, which is licensed CC BY-SA 4.0 (see licenses/).
Usage: python scripts/build_frequency_data.py OUTPUT.tsv [N]
"""

import re
import sys

from wordfreq import top_n_list, zipf_frequency

out = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 60000
ok = re.compile(r"^[a-z]+(?:'[a-z]+)?$")
words = [w for w in top_n_list("en", n * 2, wordlist="large") if ok.match(w)][:n]
with open(out, "w", encoding="utf-8") as f:
    f.write("# word<TAB>zipf. Derived from wordfreq 3.1.1 (large_en), CC BY-SA 4.0. See licenses/wordfreq-NOTICE.txt\n")
    for w in words:
        f.write(f"{w}\t{zipf_frequency(w, 'en', wordlist='large'):.2f}\n")
print("wrote", len(words), "words ->", out)
