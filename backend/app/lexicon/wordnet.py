"""Princeton WordNet 3.0, read straight from the original files.

The index files list each word's meanings from most to least common. The data files are read
by byte offset, so a meaning is only parsed when it is needed and memory stays small.
"""

from __future__ import annotations

import mmap
import os
import re
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(
    os.environ.get("STUDIO_BARS_WORDNET_DIR", str(Path(__file__).parent / "data" / "wordnet"))
)

POS_ORDER = ["n", "v", "a", "r"]
POS_FILE = {"n": "noun", "v": "verb", "a": "adj", "r": "adv"}
POS_LABEL = {"n": "noun", "v": "verb", "a": "adjective", "r": "adverb"}
POS_FROM_NAME = {"noun": "n", "verb": "v", "adjective": "a", "adverb": "r"}

# WordNet's own suffix rules for finding the base form of a word ("morphy")
_RULES = {
    "n": [("s", ""), ("ses", "s"), ("ves", "f"), ("xes", "x"), ("zes", "z"), ("ches", "ch"), ("shes", "sh"), ("men", "man"), ("ies", "y")],
    "v": [("s", ""), ("ies", "y"), ("es", "e"), ("es", ""), ("ed", "e"), ("ed", ""), ("ing", "e"), ("ing", "")],
    "a": [("er", ""), ("est", ""), ("er", "e"), ("est", "e")],
    "r": [],
}  # fmt: skip
_MARKER = re.compile(r"\((?:a|p|ip)\)$")


@dataclass(frozen=True)
class Pointer:
    symbol: str
    pos: str
    offset: int
    source: int  # 0 = the whole meaning, otherwise 1-based word number
    target: int


@dataclass(frozen=True)
class Synset:
    pos: str  # n v a r (satellite adjectives count as a)
    offset: int
    words: tuple[str, ...]  # display form, spaces instead of underscores
    definition: str
    examples: tuple[str, ...]
    pointers: tuple[Pointer, ...] = field(default=())
    satellite: bool = False

    @property
    def id(self) -> str:
        return f"{self.pos}{self.offset:08d}"


def _display(w: str) -> str:
    return _MARKER.sub("", w).replace("_", " ")


def parse_gloss(gloss: str) -> tuple[str, tuple[str, ...]]:
    examples = tuple(re.findall(r'"([^"]+)"', gloss))
    cut = gloss.find('; "')
    definition = gloss if cut < 0 else gloss[:cut]
    if definition.startswith('"') and examples:
        definition = ""
    return definition.strip(), examples


def parse_synset(line: str) -> Synset:
    head, _, gloss = line.partition(" | ")
    f = head.split(" ")
    offset, ss_type, wcnt = int(f[0]), f[2], int(f[3], 16)
    i = 4
    words = []
    for _ in range(wcnt):
        words.append(_display(f[i]))
        i += 2
    pcnt = int(f[i])
    i += 1
    ptrs = []
    for _ in range(pcnt):
        sym, off, pos, st = f[i], int(f[i + 1]), f[i + 2], f[i + 3]
        ptrs.append(Pointer(sym, "a" if pos == "s" else pos, off, int(st[:2], 16), int(st[2:], 16)))
        i += 4
    definition, examples = parse_gloss(gloss.strip())
    pos = "a" if ss_type == "s" else ss_type
    return Synset(pos, offset, tuple(words), definition, examples, tuple(ptrs), ss_type == "s")


class WordNet:
    def __init__(self, directory: Path = DATA_DIR):
        self.dir = directory
        self.index: dict[str, dict[str, tuple[int, tuple[int, ...]]]] = {p: {} for p in POS_ORDER}
        self.exc: dict[str, dict[str, list[str]]] = {p: {} for p in POS_ORDER}
        self._maps: dict[str, mmap.mmap] = {}
        self._files = []
        for p in POS_ORDER:
            self._load_index(p)
            self._load_exc(p)
            f = open(directory / f"data.{POS_FILE[p]}", "rb")  # noqa: SIM115 - kept open for mmap
            self._files.append(f)
            self._maps[p] = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)

    def _load_index(self, pos: str) -> None:
        idx = self.index[pos]
        with open(self.dir / f"index.{POS_FILE[pos]}", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("  "):
                    continue
                p = line.split()
                psyms = int(p[3])
                tag = int(p[5 + psyms])
                idx[p[0]] = (tag, tuple(int(x) for x in p[6 + psyms :]))

    def _load_exc(self, pos: str) -> None:
        with open(self.dir / f"{POS_FILE[pos]}.exc", encoding="utf-8") as fh:
            for line in fh:
                p = line.split()
                if len(p) >= 2:
                    self.exc[pos][p[0]] = p[1:]

    # ---------------------------------------------------------------- lookups
    @lru_cache(maxsize=8192)  # noqa: B019 - one WordNet per process
    def synset(self, pos: str, offset: int) -> Synset:
        mm = self._maps[pos]
        end = mm.find(b"\n", offset)
        return parse_synset(mm[offset:end].decode("utf-8"))

    def morphy(self, word: str, pos: str) -> list[str]:
        """Possible base forms of `word` for this part of speech that WordNet knows."""
        w = word.lower().strip().replace(" ", "_")
        if not w:
            return []
        idx = self.index[pos]
        found: list[str] = []
        if w in self.exc[pos]:
            found.extend(x for x in self.exc[pos][w] if x in idx)
        if w in idx and w not in found:
            found.insert(0, w)
        for suffix, repl in _RULES[pos]:
            if w.endswith(suffix) and len(w) > len(suffix):
                cand = w[: -len(suffix)] + repl
                if cand in idx and cand not in found:
                    found.append(cand)
        return found

    def senses(
        self, word: str, pos_filter: str | None = None
    ) -> list[tuple[str, str, int, Synset]]:
        """(pos, base form, sense number, meaning) for every meaning, most common first within each part of speech."""
        out = []
        for pos in POS_ORDER:
            if pos_filter and pos != pos_filter:
                continue
            seen: set[int] = set()
            for lemma in self.morphy(word, pos):
                for n, off in enumerate(self.index[pos][lemma][1], start=1):
                    if off not in seen:
                        seen.add(off)
                        out.append((pos, lemma, n, self.synset(pos, off)))
        return out

    def usual_pos(self, word: str) -> str | None:
        """The part of speech this word is most often used as (by WordNet's tagged-usage counts)."""
        best: tuple[int, int] | None = None
        best_pos = None
        for rank, pos in enumerate(POS_ORDER):
            lemmas = self.morphy(word, pos)
            if not lemmas:
                continue
            score = max(self.index[pos][lm][0] for lm in lemmas)
            key = (score, -rank)
            if best is None or key > best:
                best, best_pos = key, pos
        return best_pos

    def knows(self, word: str) -> bool:
        return any(self.morphy(word, p) for p in POS_ORDER)

    def sense_rank(self, pos: str, lemma: str, offset: int) -> tuple[int, int] | None:
        """(rank, total) of this meaning among the lemma's meanings, 1 = most common."""
        entry = self.index[pos].get(lemma.lower().replace(" ", "_"))
        if not entry or offset not in entry[1]:
            return None
        return entry[1].index(offset) + 1, len(entry[1])

    def first_sense(self, pos: str, lemma: str) -> Synset | None:
        entry = self.index[pos].get(lemma.lower().replace(" ", "_"))
        return self.synset(pos, entry[1][0]) if entry else None


_lock = threading.Lock()
_wordnet: WordNet | None = None


def get_wordnet() -> WordNet:
    global _wordnet
    if _wordnet is None:
        with _lock:
            if _wordnet is None:
                _wordnet = WordNet()
    return _wordnet
