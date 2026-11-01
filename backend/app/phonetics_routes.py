"""HTTP routes for pronunciation, syllables and rhyme tools. All local; nothing goes online."""

import re
import sqlite3

from fastapi import APIRouter, Depends, Query

from .db import tx
from .phonetics import engine
from .phonetics.engine import Phones, readable_ipa
from .phonetics.words import Resolver, analyze_lines, custom_phones, norm_word
from .routes import get_conn
from .schemas import AnalyzeIn, CustomPronIn
from .service import ApiError, now

router = APIRouter(prefix="/api/phonetics")

WORD_OK = re.compile(r"^[^\W_]+(?:[-'][^\W_]+)*$")
MAX_CUSTOM = 2000
QUALITY_HELP = {
    "homophone": "Sounds exactly the same (like write / right).",
    "rich": "Same ending and the same starting sound (like suppose / oppose).",
    "perfect": "Same sound from the last stressed vowel to the end, different start (fade / made).",
    "near": "Almost: same vowel, and ending consonants that sound alike (fade / late, home / stone).",
    "assonance": "Same vowel sounds, different consonants (fade / brave).",
    "consonance": "Same ending consonants, different vowel (bad / bed).",
}


def load_custom(conn: sqlite3.Connection) -> dict[str, Phones]:
    return {
        r["word"]: tuple(r["phones"].split())
        for r in conn.execute("SELECT word, phones FROM custom_pronunciations")
    }


def clean_word(raw: str) -> str:
    w = norm_word(raw.strip())
    if not w or len(w) > 40 or not WORD_OK.match(w):
        raise ApiError(422, "BAD_WORD", "Enter a single word (letters, numbers, - and ' only).")
    return w


@router.get("/status")
def status(conn=Depends(get_conn)):
    d = engine.get_dictionary()
    return {
        "dictionary_words": len(d.prons),
        "frequency_available": d.has_frequency,
        "pos_available": False,
        "custom_count": conn.execute("SELECT COUNT(*) FROM custom_pronunciations").fetchone()[0],
        "quality_help": QUALITY_HELP,
        "attribution": "Pronunciations: CMU Pronouncing Dictionary (Carnegie Mellon University).",
    }


@router.get("/word")
def word_info(word: str = Query(..., max_length=60), conn=Depends(get_conn)):
    r = Resolver(engine.get_dictionary(), load_custom(conn))
    return r.lookup(clean_word(word)).to_json()


@router.post("/analyze")
def analyze(body: AnalyzeIn, conn=Depends(get_conn)):
    r = Resolver(engine.get_dictionary(), load_custom(conn))
    return analyze_lines(body.lines, r)


@router.get("/rhymes")
def rhymes(
    word: str = Query(..., max_length=60),
    qualities: str = "perfect,near",
    include_identical: bool = False,
    min_syllables: int | None = Query(None, ge=1, le=12),
    max_syllables: int | None = Query(None, ge=1, le=12),
    endings: str = "",
    familiarity: str = Query("familiar", pattern="^(any|familiar|common)$"),
    limit: int = Query(60, ge=1, le=300),
    offset: int = Query(0, ge=0, le=5000),
    conn=Depends(get_conn),
):
    d = engine.get_dictionary()
    custom = load_custom(conn)
    resolver = Resolver(d, custom)
    w = clean_word(word)
    info = resolver.lookup(w)
    want = {q for q in qualities.split(",") if q}
    bad = want - set(engine.QUALITY_ORDER)
    if bad:
        raise ApiError(422, "BAD_QUALITY", f"Unknown rhyme type: {', '.join(sorted(bad))}.")
    if include_identical:
        want |= {"homophone", "rich"}
    end_set = {e for e in endings.split(",") if e}
    if end_set - {"masculine", "feminine", "dactylic"}:
        raise ApiError(422, "BAD_ENDING", "Ending must be masculine, feminine or dactylic.")
    notes: list[str] = []
    min_zipf = {"any": None, "familiar": 3.0, "common": 4.0}[familiarity]
    if min_zipf is not None and not d.has_frequency:
        notes.append(
            "Word-familiarity data is not installed, so results are not filtered or sorted by how common a word is."
        )
        min_zipf = None
    notes.append(
        "Part-of-speech filtering is not available yet: it needs the word-meaning data planned for Phase 3."
    )
    out = {"word": info.to_json(), "results": [], "total": 0, "notes": notes}
    if not info.has_phones:
        notes.insert(
            0,
            f"I don’t know how “{info.norm}” sounds, so I can’t look for rhymes. Add how you say it below.",
        )
        return out
    extra = [(cw, cp) for cw, cp in custom.items() if cw != w]
    cands = d.search(
        [p.phones for p in info.prons],
        w,
        want,
        min_syllables,
        max_syllables,
        end_set or None,
        min_zipf,
        extra=[(cw, cp) for cw, cp in extra if not re.fullmatch(r"\d+", cw)],
        overridden=set(custom),
        prefer=set(custom),
    )
    out["total"] = len(cands)
    out["results"] = [
        {
            "word": c.word,
            "ipa": readable_ipa(c.phones),
            "syllables": c.syllables,
            "stress": engine.stress_pattern(c.phones),
            "ending": c.ending,
            "quality": c.quality,
            "zipf": c.zipf,
            "custom": c.word in custom,
        }
        for c in cands[offset : offset + limit]
    ]
    if info.ambiguous:
        notes.append(
            f"“{info.norm}” can be said in {info.syl_min} or {info.syl_max} syllables, so rhymes for each way are included."
        )
    return out


# ---------------------------------------------------------------- your own pronunciations


def _custom_json(row: sqlite3.Row) -> dict:
    ph = tuple(row["phones"].split())
    return {
        "word": row["word"],
        "phones": row["phones"],
        "ipa": readable_ipa(ph),
        "syllables": engine.syllable_count(ph),
        "note": row["note"],
    }


@router.get("/custom")
def list_custom(conn=Depends(get_conn)):
    return [
        _custom_json(r) for r in conn.execute("SELECT * FROM custom_pronunciations ORDER BY word")
    ]


@router.put("/custom/{word}")
def put_custom(word: str, body: CustomPronIn, conn=Depends(get_conn)):
    w = clean_word(word)
    if bool(body.sounds_like) == bool(body.phones):
        raise ApiError(
            422,
            "BAD_INPUT",
            "Give either “sounds like” (a word) or the sounds themselves, not both.",
        )
    if body.sounds_like:
        other = Resolver(
            engine.get_dictionary(), {k: v for k, v in load_custom(conn).items() if k != w}
        )
        src = other.lookup(clean_word(body.sounds_like))
        if not src.has_phones:
            raise ApiError(
                422,
                "UNKNOWN_WORD",
                f"I don’t know how “{src.norm}” sounds either. Try a different word.",
            )
        phones = src.prons[0].phones
        note = body.note or f"Sounds like “{src.norm}”."
    else:
        try:
            phones = custom_phones(body.phones or "")
        except ValueError as e:
            raise ApiError(422, "BAD_SOUNDS", str(e)) from e
        note = body.note
    ts = now()
    with tx(conn):
        count = conn.execute("SELECT COUNT(*) FROM custom_pronunciations").fetchone()[0]
        exists = conn.execute("SELECT 1 FROM custom_pronunciations WHERE word=?", (w,)).fetchone()
        if not exists and count >= MAX_CUSTOM:
            raise ApiError(
                422, "TOO_MANY", f"You can store up to {MAX_CUSTOM} custom pronunciations."
            )
        conn.execute(
            """INSERT INTO custom_pronunciations (word, phones, note, created_at, updated_at)
               VALUES (?,?,?,?,?) ON CONFLICT(word) DO UPDATE SET phones=excluded.phones,
               note=excluded.note, updated_at=excluded.updated_at""",
            (w, " ".join(phones), note, ts, ts),
        )
    return _custom_json(
        conn.execute("SELECT * FROM custom_pronunciations WHERE word=?", (w,)).fetchone()
    )


@router.delete("/custom/{word}", status_code=204)
def delete_custom(word: str, conn=Depends(get_conn)):
    w = clean_word(word)
    with tx(conn):
        cur = conn.execute("DELETE FROM custom_pronunciations WHERE word=?", (w,))
        if cur.rowcount == 0:
            raise ApiError(404, "NOT_FOUND", "No custom pronunciation for that word.")
