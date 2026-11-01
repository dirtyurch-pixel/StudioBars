"""Words in lyrics: tokenising, looking up how they sound, syllables per line, rhyme families."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from .engine import (
    CONSONANTS,
    VOWELS,
    Dictionary,
    Phones,
    base,
    has_stress,
    is_vowel,
    readable_ipa,
    rhyme_parts,
    stress_pattern,
    syllable_count,
)

LETTER = r"[^\W\d_]"
WORD_RE = re.compile(rf"{LETTER}+(?:[-'’]{LETTER}+)*['’]?|\d+(?:[.,]\d+)*")

# Small words that are filler in the middle of a line (they still count at the end of a line).
STOPWORDS = frozenset(
    """a an the and or but nor so yet for of to in on at by up as is am are was were be been
    it its i me my we us our you your he him his she her they them their this that these those
    do does did not no if then than too very can will would could should may might must
    oh uh ah yeah hey""".split()
)

_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


@dataclass(frozen=True)
class Pron:
    phones: Phones
    source: str  # dictionary | custom | derived | guess

    def to_json(self) -> dict:
        return {
            "phones": " ".join(self.phones),
            "ipa": readable_ipa(self.phones),
            "syllables": syllable_count(self.phones),
            "stress": stress_pattern(self.phones),
            "source": self.source,
        }


@dataclass
class WordInfo:
    norm: str
    status: str  # known | custom | derived | guess
    prons: list[Pron] = field(default_factory=list)
    syl_min: int = 1
    syl_max: int = 1
    note: str = ""

    @property
    def has_phones(self) -> bool:
        return bool(self.prons)

    @property
    def ambiguous(self) -> bool:
        return self.syl_min != self.syl_max

    def to_json(self) -> dict:
        return {
            "word": self.norm,
            "status": self.status,
            "pronunciations": [p.to_json() for p in self.prons],
            "syllables_min": self.syl_min,
            "syllables_max": self.syl_max,
            "ambiguous": self.ambiguous,
            "note": self.note,
        }


@dataclass(frozen=True)
class Token:
    text: str
    start: int
    end: int
    norm: str


def norm_word(w: str) -> str:
    return unicodedata.normalize("NFC", w).lower().replace("’", "'")


def tokenize(text: str) -> list[Token]:
    """Words and numbers with their exact positions in the original text. Nothing is changed."""
    return [
        Token(m.group(), m.start(), m.end(), norm_word(m.group())) for m in WORD_RE.finditer(text)
    ]


def _strip_accents(w: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", w) if not unicodedata.combining(c))


def number_words(n: int) -> list[str] | None:
    if n < 0 or n > 999_999:
        return None
    if n < 20:
        return [_ONES[n]]
    if n < 100:
        return [_TENS[n // 10]] + ([_ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [_ONES[n // 100], "hundred"] + (number_words(n % 100) or []) * (1 if n % 100 else 0)
    head = number_words(n // 1000) or []
    tail = number_words(n % 1000) or [] if n % 1000 else []
    return head + ["thousand"] + tail


def guess_syllables(word: str) -> int:
    """Rough vowel-group count for a word the dictionary does not know."""
    w = re.sub(r"[^a-z]", "", _strip_accents(word.lower()))
    if not w:
        return 1
    n = len(re.findall(r"[aeiouy]+", w))
    if n > 1 and w.endswith("e") and not w.endswith(("le", "ee", "ie", "ye")):
        n -= 1
    if w.endswith("ed") and n > 1 and not w.endswith(("ted", "ded")):
        n -= 1
    return max(1, n)


def _add_s(phones: Phones) -> Phones:
    last = base(phones[-1])
    if last in {"S", "Z", "SH", "ZH", "CH", "JH"}:
        return (*phones, "IH0", "Z")
    if last in {"P", "T", "K", "F", "TH"}:
        return (*phones, "S")
    return (*phones, "Z")


class Resolver:
    """Looks up words: your own pronunciations first, then the dictionary, then sensible fallbacks."""

    def __init__(self, dic: Dictionary, custom: dict[str, Phones] | None = None):
        self.dic = dic
        self.custom = custom or {}
        self._cache: dict[str, WordInfo] = {}

    def lookup(self, word: str) -> WordInfo:
        norm = norm_word(word)
        if norm not in self._cache:
            self._cache[norm] = self._resolve(norm, depth=0)
        return self._cache[norm]

    # -- internals
    def _dict(self, w: str) -> list[Phones] | None:
        return self.dic.prons.get(w) or self.dic.prons.get(_strip_accents(w))

    def _info(
        self, norm: str, status: str, phones: list[Phones], source: str, note: str = ""
    ) -> WordInfo:
        prons = [Pron(p, source) for p in phones]
        counts = [syllable_count(p) for p in phones]
        return WordInfo(norm, status, prons, min(counts), max(counts), note)

    def _resolve(self, norm: str, depth: int) -> WordInfo:
        if norm in self.custom:
            return self._info(
                norm, "custom", [self.custom[norm]], "custom", "Your own pronunciation."
            )
        found = self._dict(norm)
        if found:
            return self._info(norm, "known", found, "dictionary")
        if depth > 2:
            return self._guess(norm)

        # "nothin'", "runnin'": the dictionary has -ing; say it with an N sound
        m = re.match(r"^(.*in)['’]$", norm)
        if m:
            ing = self._dict(m.group(1) + "g")
            if ing:
                fixed = [tuple("N" if p == "NG" else p for p in ph) for ph in ing]
                return self._info(
                    norm, "derived", fixed, "derived", "Dropped-g ending: said like “-in”."
                )
        if norm.endswith("'") and len(norm) > 2:
            return self._resolve(norm.rstrip("'"), depth + 1)

        # possessive / "is" contractions: "jay's", "dre's"
        if norm.endswith("'s") and len(norm) > 3:
            root = self._resolve(norm[:-2], depth + 1)
            if root.has_phones and root.status != "guess":
                return self._info(
                    norm,
                    "derived",
                    [_add_s(p.phones) for p in root.prons],
                    "derived",
                    "Built from the base word.",
                )

        # hyphenated compounds: sound each part
        if "-" in norm:
            parts = [self._resolve(p, depth + 1) for p in norm.split("-") if p]
            if parts and all(p.has_phones for p in parts):
                combos: list[Phones] = [()]
                for part in parts:
                    combos = [c + p.phones for c in combos for p in part.prons[:2]][:6]
                return self._info(
                    norm, "derived", combos, "derived", "Built from the parts of the compound."
                )
            return self._guess(norm, sum(p.syl_min for p in parts) if parts else None)

        # plain numbers: say them in the usual way, but flag it as a guess
        if re.fullmatch(r"\d+", norm):
            words = number_words(int(norm)) if len(norm) <= 6 else None
            if words:
                parts = [self._resolve(w, depth + 1) for w in words]
                if all(p.has_phones for p in parts):
                    ph: Phones = tuple(x for p in parts for x in p.prons[0].phones)
                    info = self._info(
                        norm,
                        "guess",
                        [ph],
                        "guess",
                        "Read as a plain number. Add your own pronunciation if you say it differently (like “eight-oh-eight”).",
                    )
                    return info
            return self._guess(norm)

        if re.fullmatch(r"\d[\d.,]*", norm):
            return self._guess(norm)
        return self._guess(norm)

    def _guess(self, norm: str, syl: int | None = None) -> WordInfo:
        n = syl if syl else guess_syllables(norm)
        return WordInfo(norm, "guess", [], n, n, "Not in the dictionary: syllables are a guess.")


# ---------------------------------------------------------------- lines

MAX_LINES = 300


def custom_phones(raw: str) -> Phones:
    """Validate typed phonemes like 'B R OW1'. Raises ValueError with a plain-English reason."""
    toks = raw.upper().replace(",", " ").split()
    if not toks or len(toks) > 24:
        raise ValueError("Type between 1 and 24 sounds, separated by spaces, for example: B R OW1")
    out = []
    for t in toks:
        b = t.rstrip("012")
        if b not in VOWELS | CONSONANTS:
            raise ValueError(
                f"“{t}” is not a sound I know. Valid sounds: {', '.join(sorted(VOWELS | CONSONANTS))}."
            )
        if b in VOWELS and t == b:
            raise ValueError(
                f"The vowel {t} needs a stress number: {t}1 (strong), {t}2 (medium) or {t}0 (weak)."
            )
        if b in CONSONANTS and t != b:
            raise ValueError(f"The consonant {b} should not have a number.")
        out.append(t)
    if not any(is_vowel(p) for p in out):
        raise ValueError("A word needs at least one vowel sound.")
    return tuple(out)


def _line_syllables(infos: list[WordInfo]) -> dict:
    lo = sum(i.syl_min for i in infos)
    hi = sum(i.syl_max for i in infos)
    return {
        "min": lo,
        "max": hi,
        "exact": lo == hi,
        "guessed": any(i.status == "guess" for i in infos),
    }


def analyze_lines(lines: list[str], resolver: Resolver) -> dict:
    """Syllable estimates per line plus rhyme families across the given lines."""
    per_line: list[list[tuple[Token, WordInfo]]] = []
    for text in lines:
        per_line.append([(t, resolver.lookup(t.norm)) for t in tokenize(text)])

    # candidate rhyme members: words with phones and real stress, not function words
    groups: dict[Phones, list[tuple[int, int]]] = {}
    for li, items in enumerate(per_line):
        last = len(items) - 1
        for wi, (tok, info) in enumerate(items):
            if info.status == "guess" or not info.has_phones:
                continue
            # small words ("me", "you", "my") are filler mid-line but carry weight at a line end
            if tok.norm in STOPWORDS and wi != last:
                continue
            ph = info.prons[0].phones
            if not has_stress(ph):
                continue
            parts = rhyme_parts(ph)
            if parts:
                groups.setdefault(parts[1], []).append((li, wi))

    family_of: dict[tuple[int, int], int] = {}
    families: list[dict] = []
    for key, members in groups.items():
        if len({per_line[li][wi][0].norm for li, wi in members}) < 2:
            continue
        fid = len(families)
        end_count = sum(1 for li, wi in members if wi == len(per_line[li]) - 1)
        families.append(
            {
                "id": fid,
                "sound": readable_ipa(tuple(key)).replace("ˈ", ""),
                "size": len(members),
                "end_count": end_count,
            }
        )
        for m in members:
            family_of[m] = fid
    # number families by where they first appear, so colours are stable while typing below them
    order = sorted(
        range(len(families)), key=lambda f: min(m for m, v in family_of.items() if v == f)
    )
    renum = {old: new for new, old in enumerate(order)}
    families = sorted(({**families[o], "id": renum[o]} for o in order), key=lambda f: f["id"])
    family_of = {k: renum[v] for k, v in family_of.items()}

    out_lines = []
    for li, items in enumerate(per_line):
        out_lines.append(
            {
                "syllables": _line_syllables([i for _, i in items]),
                "words": [
                    {
                        "text": tok.text,
                        "start": tok.start,
                        "end": tok.end,
                        "status": info.status,
                        "syllables_min": info.syl_min,
                        "syllables_max": info.syl_max,
                        "is_end": wi == len(items) - 1,
                        "family": family_of.get((li, wi)),
                    }
                    for wi, (tok, info) in enumerate(items)
                ],
            }
        )
    unknown = sorted({i.norm for items in per_line for _, i in items if i.status == "guess"})
    return {"lines": out_lines, "families": families, "unknown_words": unknown}
