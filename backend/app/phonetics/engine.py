"""Pronunciation dictionary, rhyme keys and rhyme search. Pure logic: no web, no database.

Pronunciations are ARPAbet phoneme tuples with stress digits on vowels, e.g.
("F", "EY1", "D"). "Rhyme" here is sound-based, never spelling-based.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
Phones = tuple[str, ...]

VOWELS = frozenset("AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW".split())
CONSONANTS = frozenset("B CH D DH F G HH JH K L M N NG P R S SH T TH V W Y Z ZH".split())
ARPABET = VOWELS | CONSONANTS

IPA = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ", "EH": "ɛ", "ER": "ɝ",
    "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ", "UW": "u",
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h", "JH": "dʒ",
    "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "r", "S": "s",
    "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}  # fmt: skip

# Consonants that sound alike enough for a "near" (slant) rhyme.
_CLASS = {
    "P": "P", "B": "P", "T": "T", "D": "T", "K": "K", "G": "K", "F": "F", "V": "F",
    "S": "S", "Z": "S", "SH": "SH", "ZH": "SH", "CH": "CH", "JH": "CH", "TH": "TH", "DH": "TH",
    "M": "N", "N": "N", "NG": "N",
}  # fmt: skip

QUALITY_ORDER = ["homophone", "rich", "perfect", "near", "assonance", "consonance"]
RANK = {q: i for i, q in enumerate(QUALITY_ORDER)}


def is_vowel(p: str) -> bool:
    return p[-1:].isdigit()


def base(p: str) -> str:
    return p.rstrip("012")


def syllable_count(phones: Phones) -> int:
    return sum(1 for p in phones if is_vowel(p))


def stress_pattern(phones: Phones) -> str:
    return "".join(p[-1] for p in phones if is_vowel(p))


def stress_index(phones: Phones) -> int | None:
    """Index of the vowel a rhyme starts from: last primary stress, else last secondary, else last vowel."""
    for want in ("1", "2"):
        for i in range(len(phones) - 1, -1, -1):
            if is_vowel(phones[i]) and phones[i][-1] == want:
                return i
    for i in range(len(phones) - 1, -1, -1):
        if is_vowel(phones[i]):
            return i
    return None


def has_stress(phones: Phones) -> bool:
    return any(is_vowel(p) and p[-1] in "12" for p in phones)


def rhyme_parts(phones: Phones) -> tuple[Phones, Phones, int] | None:
    """(onset, key, trailing_syllables). The key is the sound from the stressed vowel to the end."""
    i = stress_index(phones)
    if i is None:
        return None
    j = i
    while j > 0 and not is_vowel(phones[j - 1]):
        j -= 1
    onset = tuple(base(p) for p in phones[j:i])
    key = tuple(base(p) for p in phones[i:])
    trailing = sum(1 for p in phones[i + 1 :] if is_vowel(p))
    return onset, key, trailing


def ending_type(trailing: int) -> str:
    return "masculine" if trailing == 0 else "feminine" if trailing == 1 else "dactylic"


def readable_ipa(phones: Phones) -> str:
    out = []
    for p in phones:
        b = base(p)
        s = IPA.get(b, b.lower())
        if is_vowel(p):
            if b == "AH":
                s = "ʌ" if p[-1] in "12" else "ə"
            if b == "ER" and p[-1] == "0":
                s = "ɚ"
            if p[-1] == "1":
                s = "ˈ" + s
            elif p[-1] == "2":
                s = "ˌ" + s
        out.append(s)
    return "".join(out)


def _near_key(key: Phones) -> Phones:
    return tuple(_CLASS.get(p, p) for p in key)


def classify(src: Phones, cand: Phones) -> str | None:
    """How well does `cand` rhyme with `src`? None if it does not."""
    a, b = rhyme_parts(src), rhyme_parts(cand)
    if a is None or b is None:
        return None
    (on_a, key_a, tr_a), (on_b, key_b, tr_b) = a, b
    if tuple(src) == tuple(cand):
        return "homophone"
    if key_a == key_b:
        return "rich" if on_a == on_b else "perfect"
    if tr_a != tr_b:
        return None
    if _near_key(key_a) == _near_key(key_b) and key_a[0] == key_b[0]:
        return "near"
    vow_a = tuple(p for p in key_a if p in VOWELS)
    vow_b = tuple(p for p in key_b if p in VOWELS)
    if vow_a == vow_b:
        return "assonance"
    if key_a[1:] == key_b[1:]:
        return "consonance"
    return None


# ---------------------------------------------------------------- multisyllable tails (experimental)


def tail(phones: Phones, syllables: int) -> Phones | None:
    """Sounds from the vowel `syllables` places from the end to the end, stress numbers removed."""
    vowels = [i for i, p in enumerate(phones) if is_vowel(p)]
    if syllables < 1 or len(vowels) < syllables:
        return None
    return tuple(base(p) for p in phones[vowels[-syllables] :])


def classify_tail(a: Phones, b: Phones) -> str | None:
    """perfect: same sounds. near: same vowels with consonants that sound alike. assonance: vowels only."""
    if a == b:
        return "perfect"
    if len(a) == len(b) and tuple(_CLASS.get(p, p) for p in a) == tuple(
        _CLASS.get(p, p) for p in b
    ):
        return "near"
    if tuple(p for p in a if p in VOWELS) == tuple(p for p in b if p in VOWELS):
        return "assonance"
    return None


# ---------------------------------------------------------------- dictionary


def parse_dict(text: str) -> dict[str, list[Phones]]:
    out: dict[str, list[Phones]] = {}
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        head, _, rest = line.partition(" ")
        word = head.split("(", 1)[0].lower()
        phones = tuple(rest.split())
        if word and phones:
            out.setdefault(word, []).append(phones)
    return out


def load_frequency(path: Path) -> dict[str, float]:
    freq: dict[str, float] = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                if line.startswith("#") or "\t" not in line:
                    continue
                w, z = line.rstrip("\n").split("\t")
                freq[w] = float(z)
    except OSError:
        return {}
    return freq


@dataclass(frozen=True)
class Candidate:
    word: str
    phones: Phones
    quality: str
    zipf: float | None
    syllables: int
    ending: str
    via: Phones  # which pronunciation of the searched word this one rhymes with


class Dictionary:
    def __init__(self, prons: dict[str, list[Phones]], freq: dict[str, float]):
        self.prons = prons
        self.freq = freq
        self._tails: dict[int, dict[Phones, list[tuple[str, Phones]]]] = {}
        self.by_key: dict[Phones, list[tuple[str, Phones]]] = {}
        self.by_vowel: dict[tuple[str, int], list[tuple[str, Phones]]] = {}
        self.by_coda: dict[Phones, list[tuple[str, Phones]]] = {}
        for w, plist in prons.items():
            for ph in plist:
                parts = rhyme_parts(ph)
                if parts is None:
                    continue
                _, key, trailing = parts
                self.by_key.setdefault(key, []).append((w, ph))
                self.by_vowel.setdefault((key[0], trailing), []).append((w, ph))
                self.by_coda.setdefault(key[1:], []).append((w, ph))

    def tail_index(self, syllables: int) -> dict[Phones, list[tuple[str, Phones]]]:
        """Words grouped by their last N syllables' sounds. Built the first time it is asked for."""
        if syllables not in self._tails:
            idx: dict[Phones, list[tuple[str, Phones]]] = {}
            for w, plist in self.prons.items():
                for ph in plist:
                    t = tail(ph, syllables)
                    if t is not None:
                        idx.setdefault(t, []).append((w, ph))
            self._tails[syllables] = idx
        return self._tails[syllables]

    def vowel_index(self, syllables: int) -> dict[Phones, list[tuple[str, Phones]]]:
        key = -syllables
        if key not in self._tails:
            idx: dict[Phones, list[tuple[str, Phones]]] = {}
            for t, items in self.tail_index(syllables).items():
                idx.setdefault(tuple(p for p in t if p in VOWELS), []).extend(items)
            self._tails[key] = idx
        return self._tails[key]

    @property
    def has_frequency(self) -> bool:
        return bool(self.freq)

    def zipf(self, word: str) -> float | None:
        return self.freq.get(word) if self.freq else None

    def search(
        self,
        sources: list[Phones],
        word: str,
        qualities: set[str],
        min_syllables: int | None = None,
        max_syllables: int | None = None,
        endings: set[str] | None = None,
        min_zipf: float | None = None,
        extra: list[tuple[str, Phones]] | None = None,
        overridden: set[str] | None = None,
        prefer: set[str] | None = None,
    ) -> list[Candidate]:
        """All rhymes for any of `sources`, best quality first, then most familiar first."""
        overridden = overridden or set()
        best: dict[str, Candidate] = {}
        for src in sources:
            parts = rhyme_parts(src)
            if parts is None:
                continue
            _, key, trailing = parts
            pool: dict[tuple[str, Phones], None] = {}
            for c in self.by_key.get(key, ()):
                pool[c] = None
            if {"near", "assonance"} & qualities:
                for c in self.by_vowel.get((key[0], trailing), ()):
                    pool[c] = None
            if "consonance" in qualities:
                for c in self.by_coda.get(key[1:], ()):
                    pool[c] = None
            for c in extra or ():
                pool[c] = None
            for w, ph in pool:
                if w == word or (w in overridden and (w, ph) not in (extra or ())):
                    continue
                q = classify(src, ph)
                if q is None or q not in qualities:
                    continue
                cparts = rhyme_parts(ph)
                if cparts is None:
                    continue
                syl = syllable_count(ph)
                if min_syllables is not None and syl < min_syllables:
                    continue
                if max_syllables is not None and syl > max_syllables:
                    continue
                end = ending_type(cparts[2])
                if endings and end not in endings:
                    continue
                z = self.zipf(w)
                if min_zipf is not None and self.has_frequency and (z is None or z < min_zipf):
                    continue
                cand = Candidate(w, ph, q, z, syl, end, src)
                old = best.get(w)
                if old is None or RANK[q] < RANK[old.quality]:
                    best[w] = cand
        mine = prefer or set()
        # best rhyme quality first; within a quality, the user's own words, then the most familiar
        return sorted(
            best.values(),
            key=lambda c: (RANK[c.quality], 0 if c.word in mine else 1, -(c.zipf or 0), c.word),
        )


_lock = threading.Lock()
_dictionary: Dictionary | None = None


def get_dictionary() -> Dictionary:
    """Load the bundled dictionary once per process (about a second, then instant)."""
    global _dictionary
    if _dictionary is None:
        with _lock:
            if _dictionary is None:
                text = (DATA_DIR / "cmudict.dict").read_text(encoding="utf-8", errors="replace")
                freq_path = Path(
                    os.environ.get("STUDIO_BARS_FREQ_FILE", str(DATA_DIR / "frequency_en.tsv"))
                )
                _dictionary = Dictionary(parse_dict(text), load_frequency(freq_path))
    return _dictionary


def reset_dictionary() -> None:
    """For tests: forget the loaded dictionary (e.g. to simulate missing frequency data)."""
    global _dictionary
    with _lock:
        _dictionary = None
