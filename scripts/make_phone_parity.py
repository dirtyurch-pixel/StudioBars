"""Writes the PC version's answers for a fixed set of questions, so the phone version can be checked against them.

Run from backend/:  .venv/bin/python ../scripts/make_phone_parity.py
"""

import json
from pathlib import Path

from app.lexicon.service import describe
from app.lexicon.wordnet import POS_FROM_NAME, get_wordnet
from app.phonetics import engine
from app.phonetics.words import Resolver, analyze_lines

d = engine.get_dictionary()
r = Resolver(d, {})
wn = get_wordnet()

LINES = [
    ["I walk alone beneath the city lights", "Counting every shadow in the rain", "Nobody calls me anymore tonight", "My heart of gold is breaking down again"],
    ["Runnin' through the night, nothin' feels right", "Jay's on the mic, twenty-four seven", "808 drums and a hi-hat", "Café au lait, zzqx blorp"],
    ["", "Fire fire", "the a an"],
]
WORDS = ["fade", "nothin'", "jay's", "twenty-four", "808", "café", "zzqx", "record", "orange", "hi-hat", "fire"]
RHYMES = [
    ("fade", "perfect,near", False, None, None, "", "familiar"),
    ("fade", "perfect,near,assonance,consonance", True, None, None, "", "any"),
    ("orange", "perfect,near,assonance", False, None, None, "", "any"),
    ("lights", "perfect", False, 2, 3, "", "familiar"),
    ("money", "perfect,near", False, None, None, "feminine", "common"),
    ("fire", "perfect,near", False, None, None, "", "familiar"),
]
POS_RHYMES = [("night", "noun"), ("fade", "verb")]
DESCRIBE = [("bank", "", ""), ("bank", "money in the account", ""), ("bank", "", "river water fishing"), ("lead", "", ""), ("fast", "", ""), ("tear", "", ""), ("zzqx", "", ""), ("running", "", "")]
TAILS = [("cold as ice", 2), ("all night long", 3), ("money", 2)]


def rhymes(word, qualities, ident, mn, mx, endings, fam, pos=None):
    info = r.lookup(word)
    want = set(qualities.split(","))
    if ident:
        want |= {"homophone", "rich"}
    min_zipf = {"any": None, "familiar": 3.0, "common": 4.0}[fam]
    cands = d.search([p.phones for p in info.prons], word, want, mn, mx, set(endings.split(",")) - {""} or None, min_zipf)
    if pos:
        want_pos = POS_FROM_NAME[pos]
        cands = [c for c in cands if wn.usual_pos(c.word) == want_pos]
    return [[c.word, c.quality, c.syllables, c.ending] for c in cands[:120]] + [["TOTAL", len(cands)]]


out = {
    "analyze": [analyze_lines(lines, r) for lines in LINES],
    "words": {w: r.lookup(w).to_json() for w in WORDS},
    "rhymes": [rhymes(*q) for q in RHYMES],
    "pos_rhymes": [rhymes(w, "perfect,near", False, None, None, "", "familiar", pos) for w, pos in POS_RHYMES],
    "describe": [describe(w, c, None, around=a) for w, c, a in DESCRIBE],
    "usual_pos": {w: wn.usual_pos(w) for w in ["run", "fast", "night", "quickly", "blue", "zzqx", "running", "leaves"]},
    "tails": [[" ".join(engine.tail(tuple(x for t in [r.lookup(w) for w in phrase.split()] for x in t.prons[0].phones), n) or ()), sorted({w for w, _ in d.vowel_index(n).get(tuple(p for p in engine.tail(tuple(x for t in [r.lookup(w) for w in phrase.split()] for x in t.prons[0].phones), n) if p in engine.VOWELS), [])})[:200]] for phrase, n in TAILS],
}
dest = Path(__file__).resolve().parents[1] / "frontend" / "src" / "local" / "parity.fixture.json"
dest.write_text(json.dumps(out, ensure_ascii=False, sort_keys=True))
print("wrote", dest, dest.stat().st_size // 1024, "KB")
