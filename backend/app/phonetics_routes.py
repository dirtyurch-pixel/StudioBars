"""HTTP routes for pronunciation, syllables and rhyme tools. All local; nothing goes online."""

import re
import sqlite3

from fastapi import APIRouter, Depends, Query

from . import phrases as phrase_bank
from .db import tx
from .lexicon.wordnet import POS_FROM_NAME, get_wordnet
from .phonetics import engine
from .phonetics.engine import Phones, readable_ipa
from .phonetics.words import Resolver, analyze_lines, custom_phones, norm_word, tokenize
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
        "pos_available": True,
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
    pos: str | None = Query(None, pattern="^(noun|verb|adjective|adverb)$"),
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
    if pos:
        wn, want_pos, kept, skipped = get_wordnet(), POS_FROM_NAME[pos], [], 0
        for c in cands:
            usual = wn.usual_pos(c.word)
            if usual is None:
                skipped += 1
            elif usual == want_pos:
                kept.append(c)
        cands = kept
        notes.append(
            f"Showing words that are usually used as a {pos} (per WordNet)."
            + (f" {skipped} words WordNet does not know were left out." if skipped else "")
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


# ---------------------------------------------------------------- phrase rhymes (EXPERIMENTAL)
TAIL_QUALITIES = ("perfect", "near", "assonance")


@router.get("/phrase-rhymes")
def phrase_rhymes(
    phrase: str = Query(..., min_length=1, max_length=120),
    syllables: int = Query(2, ge=1, le=4),
    qualities: str = "perfect,near",
    familiarity: str = Query("familiar", pattern="^(any|familiar|common)$"),
    limit: int = Query(60, ge=1, le=300),
    conn=Depends(get_conn),
):
    """Words and phrase-bank entries that sound like the END of a phrase. Experimental: not yet validated."""
    d = engine.get_dictionary()
    custom = load_custom(conn)
    resolver = Resolver(d, custom)
    if "\n" in phrase:
        raise ApiError(422, "BAD_PHRASE", "Give one line of text.")
    want = {q for q in qualities.split(",") if q}
    if want - set(TAIL_QUALITIES) or not want:
        raise ApiError(422, "BAD_QUALITY", "Rhyme types here are perfect, near and assonance.")
    phones, unknown = phrase_bank.phrase_phones(phrase, resolver)
    if unknown:
        raise ApiError(
            422, "UNKNOWN_WORDS",
            "I don’t know how these sound yet: " + ", ".join(unknown) + ". Teach them in the Rhymes tab first.",
            words=unknown,
        )  # fmt: skip
    have = engine.syllable_count(phones)
    if have < syllables:
        raise ApiError(
            422, "TOO_SHORT", f"That phrase has only {have} syllable(s); choose {have} or fewer."
        )
    t = engine.tail(phones, syllables)
    assert t is not None
    min_zipf = {"any": None, "familiar": 3.0, "common": 4.0}[familiarity]
    notes = [
        "Experimental: this compares the last sounds of your phrase with single words and your phrase bank. It can miss good rhymes and include loose ones.",
        "Where a word has several ways to say it, only the first dictionary pronunciation of each word in YOUR phrase is used.",
    ]
    if min_zipf is not None and not d.has_frequency:
        notes.append(
            "Word-familiarity data is not installed, so results are not filtered by how common a word is."
        )
        min_zipf = None
    in_phrase = {tok.norm for tok in tokenize(phrase)}
    vowel_seq = tuple(p for p in t if p in engine.VOWELS)
    results: dict[str, dict] = {}
    for w, ph in d.vowel_index(syllables).get(vowel_seq, ()):
        if w in in_phrase or w in custom:
            continue
        q = engine.classify_tail(t, engine.tail(ph, syllables) or ())
        if q is None or q not in want:
            continue
        z = d.zipf(w)
        if min_zipf is not None and d.has_frequency and (z is None or z < min_zipf):
            continue
        old = results.get(w)
        if old is None or engine.RANK.get(q, 9) < engine.RANK.get(old["quality"], 9):
            results[w] = {
                "text": w,
                "kind": "word",
                "quality": q,
                "ipa": readable_ipa(ph),
                "syllables": engine.syllable_count(ph),
                "zipf": z,
            }
    # your own words and phrases first: they are your vocabulary
    own = [(cw, cp) for cw, cp in custom.items() if cw not in in_phrase]
    for item in phrase_bank.list_phrases(conn, resolver, limit=500)["items"]:
        ph2, unk = phrase_bank.phrase_phones(item["sounds_like"] or item["phrase"], resolver)
        if not unk and ph2:
            own.append((item["phrase"], ph2))
    mine: dict[str, dict] = {}
    for text, ph in own:
        tt = engine.tail(ph, syllables)
        q = engine.classify_tail(t, tt) if tt else None
        if q and q in want and text.lower() not in in_phrase:
            mine[text] = {
                "text": text,
                "kind": "mine",
                "quality": q,
                "ipa": readable_ipa(ph),
                "syllables": engine.syllable_count(ph),
                "zipf": None,
            }
    order = lambda r: (  # noqa: E731
        {"perfect": 0, "near": 1, "assonance": 2}[r["quality"]],
        0 if r["kind"] == "mine" else 1,
        -(r["zipf"] or 0),
        r["text"],
    )
    ranked = sorted([*mine.values(), *results.values()], key=order)
    return {
        "phrase": phrase,
        "syllables": syllables,
        "tail_ipa": readable_ipa(tuple(t)),
        "experimental": True,
        "notes": notes,
        "total": len(ranked),
        "results": [{k: v for k, v in r.items() if k != "zipf"} for r in ranked[:limit]],
    }
