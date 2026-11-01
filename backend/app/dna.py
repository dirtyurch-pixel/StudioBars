"""Personal Writing DNA: what YOUR approved lyrics tend to do. Private, local, computed on demand, never stored,
never sent to the AI. Removing a song's approval removes it from the profile immediately."""

from __future__ import annotations

import statistics
from collections import Counter

from .db import tx
from .phonetics.words import STOPWORDS, Resolver, analyze_lines, tokenize
from .service import load_song, now

MIN_WORD_COUNT = 2


def approved_ids(conn) -> list[str]:
    return [r["song_id"] for r in conn.execute(
        "SELECT d.song_id FROM dna_songs d JOIN songs s ON s.id=d.song_id WHERE s.deleted_at IS NULL ORDER BY d.approved_at"
    )]  # fmt: skip


def approve(conn, song_id: str) -> dict:
    load_song(conn, song_id)  # 404 if missing
    with tx(conn):
        conn.execute("INSERT OR IGNORE INTO dna_songs VALUES (?,?)", (song_id, now()))
    return {"ok": True}


def remove(conn, song_id: str) -> dict:
    with tx(conn):
        conn.execute("DELETE FROM dna_songs WHERE song_id=?", (song_id,))
    return {"ok": True}


def clear(conn) -> dict:
    with tx(conn):
        conn.execute("DELETE FROM dna_songs")
    return {"ok": True}


def profile(conn, resolver: Resolver) -> dict:
    ids = approved_ids(conn)
    if not ids:
        return {"songs": [], "empty": True}
    words: Counter[str] = Counter()
    openers: Counter[str] = Counter()
    sounds: dict[str, Counter[str]] = {}
    syl_mids: list[float] = []
    words_per_line: list[int] = []
    end_total = end_in_family = 0
    n_lines = 0
    titles = []
    for sid in ids:
        song = load_song(conn, sid)
        titles.append({"id": sid, "title": song["title"]})
        for sec in song["sections"]:
            texts = [ln["text"] for ln in sec["lines"] if ln["text"].strip()]
            if not texts:
                continue
            res = analyze_lines(texts, resolver)
            for text, line in zip(texts, res["lines"], strict=True):
                n_lines += 1
                toks = tokenize(text)
                words_per_line.append(len(toks))
                if toks:
                    openers[toks[0].norm] += 1
                syl_mids.append((line["syllables"]["min"] + line["syllables"]["max"]) / 2)
                for t in toks:
                    if t.norm not in STOPWORDS and len(t.norm) > 2:
                        words[t.norm] += 1
                for w in line["words"]:
                    if w["is_end"]:
                        end_total += 1
                        if w["family"] is not None:
                            end_in_family += 1
            for fam in res["families"]:
                sounds.setdefault(fam["sound"], Counter())[sec["label"]] += fam["size"]
    all_words = sum(words.values())
    return {
        "empty": False,
        "songs": titles,
        "lines": n_lines,
        "avg_syllables_per_line": round(statistics.fmean(syl_mids), 1) if syl_mids else None,
        "avg_words_per_line": round(statistics.fmean(words_per_line), 1) if words_per_line else None,
        "end_rhyme_share": round(end_in_family / end_total, 2) if end_total else None,
        "vocabulary_variety": round(len(words) / all_words, 2) if all_words else None,
        "favourite_words": [{"word": w, "count": c} for w, c in words.most_common(40) if c >= MIN_WORD_COUNT][:20],
        "common_openers": [{"word": w, "count": c} for w, c in openers.most_common(8) if c >= MIN_WORD_COUNT],
        "rhyme_sounds": [{"sound": s, "uses": sum(c.values())} for s, c in sorted(sounds.items(), key=lambda kv: -sum(kv[1].values()))[:8]],  # fmt: skip
        "note": "Computed now from the songs you approved, with simple counting. It describes habits; it is not a judgement and is never sent to the AI.",
    }  # fmt: skip
