"""Phase 5 analysis: syllable stress for the flow grid, clichés and repetition, structure scan, rhyme chains.

Everything here is an ESTIMATE from the dictionary and simple rules. It points things out; it never edits
lyrics and it never claims to judge quality or commercial success.
"""

from __future__ import annotations

import re
import statistics

from .phonetics.engine import classify, has_stress, is_vowel
from .phonetics.words import STOPWORDS, Resolver, analyze_lines, guess_syllables, tokenize

CLICHES = [
    "heart of gold", "broken heart", "tears fall", "tears like rain", "cold as ice", "burning desire",
    "fire in my soul", "set me free", "love hurts", "stand the test of time", "end of the road",
    "light at the end of the tunnel", "dream come true", "head over heels", "lost without you",
    "can't live without you", "you complete me", "forever and always", "forever and a day",
    "take my breath away", "against all odds", "every step of the way", "turn back time",
    "rise above", "rise from the ashes", "walk through fire", "like a diamond", "shine like a star",
    "reach for the stars", "sky is the limit", "money talks", "ride or die", "king of the world",
    "cry me a river", "dance the night away", "party all night", "no pain no gain",
    "heart on my sleeve", "wear my heart", "wild and free", "young and free", "hold on tight",
    "never let go", "this is the end", "roller coaster", "break the chains", "caught in the rain",
    "falling apart", "heart skips a beat", "butterflies in my stomach", "fly so high",
    "hands in the air", "one more night", "all I need is you", "you and me against the world",
]  # fmt: skip
FILLERS = frozenset(
    "just really very like so kinda sorta basically literally actually totally honestly".split()
)
INTENTIONAL_TYPES = {"chorus", "hook", "pre-chorus"}


def norm_line(t: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9' ]+", " ", t.lower().replace("’", "'")).split())


# ---------------------------------------------------------------- stress for the flow grid


def line_syllables(text: str, resolver: Resolver) -> list[dict]:
    """One entry per syllable: which word it belongs to and whether it is stressed (from the dictionary)."""
    out: list[dict] = []
    for wi, tok in enumerate(tokenize(text)):
        info = resolver.lookup(tok.norm)
        if info.has_phones and info.status != "guess":
            vowels = [p for p in info.prons[0].phones if is_vowel(p)]
            for k, v in enumerate(vowels):
                st = int(v[-1])
                out.append({"word": tok.text, "word_index": wi, "stress": 1 if st == 1 else 2 if st == 2 else 0, "first": k == 0, "guess": False})  # fmt: skip
        else:
            for k in range(max(1, guess_syllables(tok.norm))):
                out.append({"word": tok.text, "word_index": wi, "stress": None, "first": k == 0, "guess": True})  # fmt: skip
    return out


# ---------------------------------------------------------------- clichés, repeats, fillers


def scan_text(song: dict) -> dict:
    genres = {g.lower() for g in song.get("genres", [])}
    flat = []  # (section idx, section type, section label, line id, line text)
    for si, s in enumerate(song["sections"]):
        for ln in s["lines"]:
            if ln["text"].strip():
                flat.append((si, s["section_type"], s["label"], ln["id"], ln["text"]))

    cliches = []
    for _si, _t, label, lid, text in flat:
        n = f" {norm_line(text)} "
        for c in CLICHES:
            if f" {norm_line(c)} " in n:
                cliches.append({"line_id": lid, "section": label, "phrase": c, "text": text})

    groups: dict[str, list] = {}
    for item in flat:
        k = norm_line(item[4])
        if len(k.split()) >= 2:
            groups.setdefault(k, []).append(item)
    repeated_lines = []
    for items in groups.values():
        if len(items) < 2:
            continue
        intentional = "house" in genres or all(i[1] in INTENTIONAL_TYPES for i in items)
        repeated_lines.append({"text": items[0][4], "count": len(items), "line_ids": [i[3] for i in items], "sections": sorted({i[2] for i in items}), "intentional": intentional})  # fmt: skip

    grams: dict[str, set[str]] = {}
    for _si, _t, _label, lid, text in flat:
        words = norm_line(text).split()
        for i in range(len(words) - 3):
            grams.setdefault(" ".join(words[i : i + 4]), set()).add(lid)
    exact = {lid for r in repeated_lines for lid in r["line_ids"]}
    reused = []
    seen_phr: set[str] = set()
    for g, lids in sorted(grams.items(), key=lambda kv: -len(kv[1])):
        if len(lids) >= 2 and not lids <= exact and not any(g in p or p in g for p in seen_phr):
            seen_phr.add(g)
            reused.append({"phrase": g, "count": len(lids), "line_ids": sorted(lids)})

    filler = []
    for _si, _t, label, lid, text in flat:
        hits = [w for w in norm_line(text).split() if w in FILLERS]
        if len(hits) >= 2:
            filler.append({"line_id": lid, "section": label, "words": hits, "text": text})

    return {"cliches": cliches[:50], "repeated_lines": repeated_lines[:50], "reused_phrases": reused[:30], "filler": filler[:50]}  # fmt: skip


# ---------------------------------------------------------------- structure scan


def scan_structure(song: dict, resolver: Resolver) -> dict:
    sections = []
    for s in song["sections"]:
        texts = [ln["text"] for ln in s["lines"] if ln["text"].strip()]
        if not texts:
            sections.append({"label": s["label"], "type": s["section_type"], "lines": 0, "avg_syllables": None, "spread": None, "rhyme_families": 0, "end_rhyme_share": None})  # fmt: skip
            continue
        res = analyze_lines(texts, resolver)
        mids = [(ln["syllables"]["min"] + ln["syllables"]["max"]) / 2 for ln in res["lines"]]
        ends = [w for ln in res["lines"] for w in ln["words"] if w["is_end"]]
        in_family = sum(1 for w in ends if w["family"] is not None)
        sections.append({
            "label": s["label"], "type": s["section_type"], "lines": len(texts),
            "avg_syllables": round(statistics.fmean(mids), 1),
            "spread": round(statistics.pstdev(mids), 1) if len(mids) > 1 else 0.0,
            "rhyme_families": len(res["families"]),
            "end_rhyme_share": round(in_family / len(ends), 2) if ends else None,
        })  # fmt: skip

    notes: list[str] = []
    types = [s["type"] for s in sections if s["lines"]]
    if types and not ({"chorus", "hook"} & set(types)):
        notes.append(
            "There is no chorus or hook section yet. Many songs have one place that repeats."
        )
    if "chorus" in types and "verse" in types and not ({"pre-chorus", "bridge"} & set(types)):
        notes.append(
            "No pre-chorus or bridge. That is fine, but a short contrast section can make the chorus feel bigger."
        )
    for s in sections:
        if s["lines"] >= 4 and s["rhyme_families"] == 0:
            notes.append(
                f"“{s['label']}” has no rhyme pattern the dictionary can find (words it does not know are skipped)."
            )
        if s["spread"] is not None and s["spread"] >= 4:
            notes.append(
                f"“{s['label']}” has very uneven line lengths (about ±{s['spread']} syllables)."
            )
    ch = [s for s in sections if s["type"] == "chorus" and s["avg_syllables"]]
    vs = [s for s in sections if s["type"] == "verse" and s["avg_syllables"]]
    if ch and vs:
        c, v = (
            statistics.fmean(s["avg_syllables"] for s in ch),
            statistics.fmean(s["avg_syllables"] for s in vs),
        )
        if abs(c - v) < 1:
            notes.append(
                "Chorus and verse lines are about the same length. A different length or rhythm can help the chorus stand out."
            )
    return {"sections": sections, "notes": notes, "disclaimer": "Estimates from the dictionary and simple rules. These are prompts to think about, not verdicts."}  # fmt: skip


# ---------------------------------------------------------------- singability / breath (estimates)

LONG_LINE = 14
CROWDED_RUN = 5  # consonant sounds in a row, counting across word boundaries


def singability(song: dict, resolver: Resolver) -> list[dict]:
    notes = []
    for sec in song["sections"]:
        for ln in sec["lines"]:
            text = ln["text"]
            if not text.strip():
                continue
            toks = tokenize(text)
            infos = [resolver.lookup(t.norm) for t in toks]
            syl = sum((i.syl_min + i.syl_max) / 2 for i in infos)
            if syl > LONG_LINE:
                # suggest a breath at the comma/dash/word closest to the middle
                breaks = [t.end for t in toks[:-1] if text[t.end : t.end + 1] in ",;:-—"] or [
                    toks[len(toks) // 2 - 1].end
                ]
                mid = len(text) / 2
                at = min(breaks, key=lambda b: abs(b - mid))
                notes.append({"line_id": ln["id"], "section": sec["label"], "kind": "long", "text": text, "detail": f"About {round(syl)} syllables is a lot for one breath. A breath could go after “{text[:at].split()[-1]}”.", "breath_after": at})  # fmt: skip
            run, worst, where = 0, 0, ""
            for t, info in zip(toks, infos, strict=True):
                if not info.has_phones:
                    run = 0
                    continue
                for p in info.prons[0].phones:
                    if is_vowel(p):
                        run = 0
                    else:
                        run += 1
                        if run > worst:
                            worst, where = run, t.text
            if worst >= CROWDED_RUN:
                notes.append({"line_id": ln["id"], "section": sec["label"], "kind": "crowded", "text": text, "detail": f"Several consonants pile up near “{where}” ({worst} in a row), which can be hard to say quickly.", "breath_after": None})  # fmt: skip
    return notes[:60]


# ---------------------------------------------------------------- internal rhyme chains

STRICTNESS = {
    "strict": {"homophone", "rich", "perfect"},
    "normal": {"homophone", "rich", "perfect", "near"},
    "loose": {"homophone", "rich", "perfect", "near", "assonance"},
}


def rhyme_chains(
    lines: list[str], resolver: Resolver, strictness: str = "normal", window: int = 4
) -> dict:
    allowed = STRICTNESS[strictness]
    members = []  # (line, word index, tok, phones)
    for li, text in enumerate(lines):
        toks = tokenize(text)
        for wi, tok in enumerate(toks):
            info = resolver.lookup(tok.norm)
            if (
                not info.has_phones
                or info.status == "guess"
                or tok.norm in STOPWORDS
                and wi != len(toks) - 1
            ):
                continue
            ph = info.prons[0].phones
            if has_stress(ph):
                members.append((li, wi, tok, ph, info.ambiguous or len(info.prons) > 1))

    parent = list(range(len(members)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    pairs: dict[tuple[int, int], str] = {}
    for a in range(len(members)):
        for b in range(a + 1, len(members)):
            if members[b][0] - members[a][0] > window:
                break
            if members[a][2].norm == members[b][2].norm:
                continue
            q = classify(members[a][3], members[b][3])
            if q in allowed:
                pairs[(a, b)] = q
                parent[find(a)] = find(b)

    comps: dict[int, list[int]] = {}
    for i in range(len(members)):
        comps.setdefault(find(i), []).append(i)
    chains = []
    for idxs in comps.values():
        if len(idxs) < 2:
            continue
        lines_in = [members[i][0] for i in idxs]
        qs = [q for (a, b), q in pairs.items() if a in idxs and b in idxs]
        order = ["homophone", "rich", "perfect", "near", "assonance"]
        weakest = max(qs, key=order.index) if qs else None
        chains.append({
            "members": [{"line": members[i][0], "word": members[i][2].text, "start": members[i][2].start, "end": members[i][2].end, "alternate_pronunciations": members[i][4]} for i in idxs],  # fmt: skip
            "internal": len(set(lines_in)) < len(lines_in),
            "weakest_link": weakest,
        })  # fmt: skip
    chains.sort(key=lambda c: (-len(c["members"]), c["members"][0]["line"]))
    return {"chains": chains[:40], "strictness": strictness, "note": "Uses each word's first dictionary pronunciation. Words with other pronunciations are flagged; a match is never guaranteed."}  # fmt: skip
