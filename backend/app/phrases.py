"""Personal phrase and slang bank: your own words, meanings, how they sound, and tags."""

from __future__ import annotations

import re
import sqlite3

from .db import tx
from .phonetics import engine
from .phonetics.engine import readable_ipa
from .phonetics.words import Resolver, tokenize
from .schemas import PhraseIn, PhraseUpdate
from .service import ApiError, new_id, now

MAX_PHRASES = 5000


def phrase_key(p: str) -> str:
    return re.sub(r"\s+", " ", p.strip().lower().replace("’", "'"))


def pronunciation(text: str, resolver: Resolver) -> dict:
    """How a phrase sounds, built from its words (or from its 'sounds like' words)."""
    toks = tokenize(text)
    infos = [resolver.lookup(t.norm) for t in toks]
    if not infos:
        return {
            "known": False,
            "syllables_min": 0,
            "syllables_max": 0,
            "ipa": "",
            "unknown_words": [],
        }
    unknown = [i.norm for i in infos if not i.has_phones]
    syl_min, syl_max = sum(i.syl_min for i in infos), sum(i.syl_max for i in infos)
    ipa = " ".join(readable_ipa(i.prons[0].phones) for i in infos if i.has_phones)
    return {
        "known": not unknown,
        "syllables_min": syl_min,
        "syllables_max": syl_max,
        "ipa": ipa,
        "unknown_words": unknown,
        "guessed": any(i.status == "guess" for i in infos),
    }


def phrase_phones(text: str, resolver: Resolver) -> tuple[engine.Phones, list[str]]:
    """First pronunciation of each word joined together, plus any words with no known sound."""
    phones: list[str] = []
    unknown = []
    for t in tokenize(text):
        info = resolver.lookup(t.norm)
        if info.has_phones:
            phones.extend(info.prons[0].phones)
        else:
            unknown.append(info.norm)
    return tuple(phones), unknown


def _row(conn, r: sqlite3.Row, resolver: Resolver) -> dict:
    tags = [
        t["tag"]
        for t in conn.execute(
            "SELECT tag FROM phrase_tags WHERE phrase_id=? ORDER BY tag", (r["id"],)
        )
    ]
    return {
        "id": r["id"],
        "phrase": r["phrase"],
        "meaning": r["meaning"],
        "sounds_like": r["sounds_like"],
        "tags": tags,
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
        "pronunciation": pronunciation(r["sounds_like"] or r["phrase"], resolver),
    }


def _get(conn, pid: str) -> sqlite3.Row:
    r = conn.execute("SELECT * FROM phrases WHERE id=?", (pid,)).fetchone()
    if r is None:
        raise ApiError(404, "NOT_FOUND", "Phrase not found.")
    return r


def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def list_phrases(
    conn, resolver: Resolver, q: str = "", tag: str = "", limit: int = 100, offset: int = 0
) -> dict:
    where, args = [], []
    for term in q.lower().split()[:6]:
        like = _like(term)
        where.append(
            "(lower(p.phrase) LIKE ? ESCAPE '\\' OR lower(p.meaning) LIKE ? ESCAPE '\\' OR lower(p.sounds_like) LIKE ? ESCAPE '\\' "
            "OR EXISTS (SELECT 1 FROM phrase_tags t WHERE t.phrase_id=p.id AND t.tag LIKE ? ESCAPE '\\'))"
        )
        args += [like, like, like, like]
    if tag:
        where.append("EXISTS (SELECT 1 FROM phrase_tags t WHERE t.phrase_id=p.id AND t.tag=?)")
        args.append(tag.lower())
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(f"SELECT COUNT(*) FROM phrases p{clause}", args).fetchone()[0]
    rows = conn.execute(
        f"SELECT p.* FROM phrases p{clause} ORDER BY lower(p.phrase) LIMIT ? OFFSET ?",
        (*args, limit, offset),
    ).fetchall()
    return {"total": total, "items": [_row(conn, r, resolver) for r in rows]}


def tag_counts(conn) -> list[dict]:
    return [
        {"tag": r["tag"], "count": r["n"]}
        for r in conn.execute(
            "SELECT tag, COUNT(*) n FROM phrase_tags GROUP BY tag ORDER BY n DESC, tag"
        )
    ]


def create(conn, data: PhraseIn, resolver: Resolver) -> dict:
    key, ts, pid = phrase_key(data.phrase), now(), new_id()
    with tx(conn):
        if conn.execute("SELECT COUNT(*) FROM phrases").fetchone()[0] >= MAX_PHRASES:
            raise ApiError(422, "TOO_MANY", f"The phrase bank holds up to {MAX_PHRASES} entries.")
        if conn.execute("SELECT 1 FROM phrases WHERE phrase_key=?", (key,)).fetchone():
            raise ApiError(409, "DUPLICATE", f"“{data.phrase}” is already in your phrase bank.")
        conn.execute(
            "INSERT INTO phrases VALUES (?,?,?,?,?,?,?)",
            (pid, data.phrase, key, data.meaning, data.sounds_like, ts, ts),
        )
        for t in data.tags:
            conn.execute("INSERT INTO phrase_tags VALUES (?,?)", (pid, t))
    return _row(conn, _get(conn, pid), resolver)


def update(conn, pid: str, data: PhraseUpdate, resolver: Resolver) -> dict:
    with tx(conn):
        cur = _get(conn, pid)
        fields = data.model_fields_set
        phrase = data.phrase if "phrase" in fields and data.phrase else cur["phrase"]
        key = phrase_key(phrase)
        clash = conn.execute(
            "SELECT id FROM phrases WHERE phrase_key=? AND id<>?", (key, pid)
        ).fetchone()
        if clash:
            raise ApiError(409, "DUPLICATE", f"“{phrase}” is already in your phrase bank.")
        meaning = (
            data.meaning if "meaning" in fields and data.meaning is not None else cur["meaning"]
        )
        sounds = (
            data.sounds_like
            if "sounds_like" in fields and data.sounds_like is not None
            else cur["sounds_like"]
        )
        if "\n" in sounds or "\n" in phrase:
            raise ApiError(422, "INVALID", "Phrases must be a single line.")
        conn.execute(
            "UPDATE phrases SET phrase=?, phrase_key=?, meaning=?, sounds_like=?, updated_at=? WHERE id=?",
            (phrase, key, meaning, sounds, now(), pid),
        )
        if "tags" in fields and data.tags is not None:
            conn.execute("DELETE FROM phrase_tags WHERE phrase_id=?", (pid,))
            for t in dict.fromkeys(data.tags):
                conn.execute("INSERT INTO phrase_tags VALUES (?,?)", (pid, t))
    return _row(conn, _get(conn, pid), resolver)


def delete(conn, pid: str) -> None:
    with tx(conn):
        _get(conn, pid)
        conn.execute("DELETE FROM phrases WHERE id=?", (pid,))


def export_all(conn, resolver: Resolver) -> dict:
    items = list_phrases(conn, resolver, limit=MAX_PHRASES)["items"]
    return {
        "format": "studio-bars-phrases",
        "schema_version": 1,
        "exported_at": now(),
        "phrases": [{k: i[k] for k in ("phrase", "meaning", "sounds_like", "tags")} for i in items],
    }
