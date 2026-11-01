"""Meanings, synonyms, opposites and related ideas for a word, from WordNet only (no AI, no internet)."""

from __future__ import annotations

import re

from ..phonetics import engine
from ..phonetics.engine import readable_ipa
from ..phonetics.words import STOPWORDS, tokenize
from .heteronyms import said_as
from .wordnet import POS_LABEL, Pointer, Synset, WordNet, get_wordnet

SOURCE = "WordNet 3.0, Princeton University"
LIMITS = {"synonyms": 14, "antonyms": 8, "broader": 8, "narrower": 14, "related": 10, "imagery": 14}
_WORD = re.compile(r"[a-z]+")

HYPERNYM, HYPONYM = {"@", "@i"}, {"~", "~i"}
SIMILAR, ALSO, ATTRIBUTE, PERTAIN, DERIVED = "&", "^", "=", "\\", "+"
MERONYMS = {"%p", "%m", "%s"}


def _zipf(word: str) -> float:
    try:
        return engine.get_dictionary().zipf(word.lower()) or 0.0
    except OSError:
        return 0.0


def _targets(wn: WordNet, syn: Synset, symbols: set[str], whole_only: bool = True) -> list[Synset]:
    out = []
    for p in syn.pointers:
        if p.symbol in symbols and (not whole_only or p.source == 0):
            out.append(wn.synset(p.pos, p.offset))
    return out


def _names(synsets: list[Synset], exclude: set[str], cap: int) -> list[dict]:
    """One chip per related meaning (its commonest name), most familiar first."""
    seen, items = set(), []
    for s in synsets:
        for w in s.words[:2]:
            k = w.lower()
            if k not in seen and k not in exclude:
                seen.add(k)
                items.append({"word": w, "zipf": _zipf(w)})
                break
    items.sort(key=lambda i: -i["zipf"])
    return [{"word": i["word"]} for i in items[:cap]]


def _antonyms(wn: WordNet, syn: Synset, lemma: str) -> list[dict]:
    """Opposites of this word in this meaning (adjective satellites borrow their head word's)."""
    found: dict[str, str | None] = {}
    idxs = [i + 1 for i, w in enumerate(syn.words) if w.lower() == lemma.lower()]

    def collect(s: Synset, only: list[int] | None, via: str | None) -> None:
        for p in s.pointers:
            if p.symbol == "!" and (only is None or p.source in only):
                t = wn.synset(p.pos, p.offset)
                w = t.words[p.target - 1] if 0 < p.target <= len(t.words) else t.words[0]
                found.setdefault(w, via)

    collect(syn, idxs or None, None)
    if not found and syn.satellite:
        for head in _targets(wn, syn, {SIMILAR}):
            collect(head, None, head.words[0])
    return [
        {"word": w, **({"via": v} if v else {})}
        for w, v in list(found.items())[: LIMITS["antonyms"]]
    ]


def _synonyms(wn: WordNet, syn: Synset, lemma: str) -> list[dict]:
    items = []
    for w in syn.words:
        if w.lower() == lemma.lower():
            continue
        item: dict = {"word": w, "zipf": _zipf(w)}
        rk = wn.sense_rank(syn.pos, w, syn.offset)
        if rk and rk[0] > 1:
            first = wn.first_sense(syn.pos, w)
            item["shift"] = {
                "rank": rk[0],
                "of": rk[1],
                "usually_means": (first.definition[:110] if first else ""),
            }
        items.append(item)
    items.sort(key=lambda i: ("shift" in i, -i["zipf"]))
    return [{k: v for k, v in i.items() if k != "zipf"} for i in items[: LIMITS["synonyms"]]]


def _similar(wn: WordNet, syn: Synset, lemma: str) -> list[dict]:
    """Adjectives: words in the linked "similar to" group (quick, speedy for fast). Close, not identical."""
    if syn.pos != "a":
        return []
    heads = _targets(wn, syn, {SIMILAR}) if syn.satellite else [syn]
    groups: list[Synset] = []
    for h in heads:
        groups.append(h)
        groups.extend(_targets(wn, h, {SIMILAR}))
    items, seen = [], {lemma.lower()}
    for g in groups:
        for w in g.words:
            if w.lower() in seen:
                continue
            seen.add(w.lower())
            item: dict = {"word": w, "zipf": _zipf(w)}
            rk = wn.sense_rank(g.pos, w, g.offset)
            if rk and rk[0] > 1:
                first = wn.first_sense(g.pos, w)
                item["shift"] = {
                    "rank": rk[0],
                    "of": rk[1],
                    "usually_means": first.definition[:110] if first else "",
                }
            items.append(item)
    items.sort(key=lambda i: ("shift" in i, -i["zipf"]))
    return [{k: v for k, v in i.items() if k != "zipf"} for i in items[: LIMITS["synonyms"]]]


def _terms(text: str, wn: WordNet) -> set[str]:
    out: set[str] = set()
    for w in _WORD.findall(text.lower()):
        if len(w) < 3 or w in STOPWORDS:
            continue
        out.add(w)
        for pos in ("n", "v", "a"):
            out.update(wn.morphy(w, pos))
    return out


def _signature(wn: WordNet, syn: Synset) -> set[str]:
    text = " ".join([syn.definition, *syn.examples, *syn.words])
    for h in _targets(wn, syn, HYPERNYM):
        text += " " + " ".join(h.words)
    return _terms(text, wn)


def describe(
    word: str,
    context: str = "",
    pos: str | None = None,
    wn: WordNet | None = None,
    around: str = "",
) -> dict:
    wn = wn or get_wordnet()
    raw = wn.senses(word, pos)

    # commonest part of speech first (by WordNet's tagged-usage counts), meanings keep their own order
    def usage(p: str) -> tuple[int, int]:
        lemmas = wn.morphy(word, p)
        return (
            max(
                (wn.index[p][lm][0] for lm in lemmas), default=-1
            ),  # tagged uses in WordNet's sample text
            max(
                (len(wn.index[p][lm][1]) for lm in lemmas), default=0
            ),  # more meanings = richer everyday use
        )

    order = sorted("nvar", key=lambda p: (tuple(-x for x in usage(p)), "nvar".index(p)))
    rank = {p: i for i, p in enumerate(order)}
    raw.sort(key=lambda t: rank[t[0]])
    forms = sorted({lemma for _, lemma, _, _ in raw})
    out: dict = {
        "word": word.lower(),
        "found": bool(raw),
        "forms": [f.replace("_", " ") for f in forms],
        "senses": [],
        "pos_counts": {
            POS_LABEL[p]: sum(1 for t in raw if t[0] == p)
            for p in "nvar"
            if any(t[0] == p for t in raw)
        },
        "total_senses": len(raw),
        "context_used": False,
        "reordered": False,
        "notes": [],
        "source": SOURCE,
    }
    if not raw:
        out["notes"].append(
            f"WordNet does not have “{word}”. It may be slang, a name, or spelled differently."
        )
        return out

    own = _terms(" ".join(forms), wn) | {word.lower()}
    # words from the line being written count double; words from the lines next to it count once
    ctx = (
        _terms(" ".join(t.norm for t in tokenize(context)), wn) - own if context.strip() else set()
    )
    near = (
        _terms(" ".join(t.norm for t in tokenize(around)), wn) - own - ctx
        if around.strip()
        else set()
    )
    use_context = bool(ctx or near)
    dic = engine.get_dictionary()
    senses = []
    for order, (p, lemma, no, syn) in enumerate(raw):
        total = len(wn.index[p][lemma][1])
        phones = said_as(lemma, p, syn.definition)
        sense = {
            "id": syn.id,
            "pos": p,
            "pos_label": POS_LABEL[p],
            "sense_no": no,
            "of": total,
            "lemma": lemma.replace("_", " "),
            "definition": syn.definition,
            "examples": list(syn.examples[:3]),
            "synonyms": _synonyms(wn, syn, lemma.replace("_", " ")),
            "similar": _similar(wn, syn, lemma.replace("_", " ")),
            "antonyms": _antonyms(wn, syn, lemma.replace("_", " ")),
            "broader": _names(_targets(wn, syn, HYPERNYM), own, LIMITS["broader"]),
            "narrower": _names(_targets(wn, syn, HYPONYM), own, LIMITS["narrower"]),
            "related": _names(
                _targets(wn, syn, {SIMILAR, ALSO, ATTRIBUTE, PERTAIN}), own, LIMITS["related"]
            ),
            "imagery": _names(_targets(wn, syn, MERONYMS), own, LIMITS["imagery"]),
            "said_as": None,
            "fit": None,
            "_order": order,
        }
        if phones:
            ph = tuple(phones.split())
            known = ph in dic.prons.get(lemma, [])
            sense["said_as"] = {"phones": phones, "ipa": readable_ipa(ph), "in_dictionary": known}
        if use_context:
            sig = _signature(wn, syn)
            own_hits, near_hits = sorted(ctx & sig), sorted(near & sig)
            sense["fit"] = {
                "score": 2 * len(own_hits) + len(near_hits),
                "matched": (own_hits + near_hits)[:4],
                "best": False,
            }
        senses.append(sense)

    if use_context:
        out["context_used"] = True
        ranked = sorted(senses, key=lambda s: (-(s["fit"]["score"]), s["_order"]))
        top = ranked[0]["fit"]["score"]
        if top > 0:
            if len(ranked) > 1 and top > ranked[1]["fit"]["score"]:
                ranked[0]["fit"]["best"] = True
            out["reordered"] = [s["id"] for s in ranked] != [s["id"] for s in senses]
            senses = ranked
    for s in senses:
        s.pop("_order", None)
    out["senses"] = senses
    if len({s["said_as"]["phones"] for s in senses if s["said_as"]}) > 1:
        out["notes"].append(
            "This word is said differently depending on its meaning. Each meaning shows how it is said."
        )
    return out


def usual_pos_label(word: str) -> str | None:
    p = get_wordnet().usual_pos(word)
    return POS_LABEL.get(p) if p else None


__all__ = ["describe", "usual_pos_label", "Pointer"]
