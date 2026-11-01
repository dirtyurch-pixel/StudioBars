"""HTTP routes: meanings (WordNet), the optional online helper, and the phrase bank."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from . import phrases
from .lexicon import online
from .lexicon.service import describe
from .lexicon.wordnet import POS_FROM_NAME, get_wordnet
from .phonetics import engine
from .phonetics.words import Resolver
from .phonetics_routes import clean_word, load_custom
from .routes import get_conn
from .schemas import OnlineSettingsIn, PhraseIn, PhraseUpdate
from .service import ApiError

router = APIRouter(prefix="/api")


def _resolver(conn) -> Resolver:
    return Resolver(engine.get_dictionary(), load_custom(conn))


@router.get("/lexicon/status")
def lexicon_status(conn=Depends(get_conn)):
    wn = get_wordnet()
    return {
        "wordnet": {
            "name": "WordNet 3.0",
            "owner": "Princeton University",
            "words": {p: len(wn.index[p]) for p in "nvar"},
        },
        "online": online.status(conn),
        "credit": "Meanings and word relations: WordNet 3.0, Princeton University.",
    }


@router.get("/lexicon/word")
def lexicon_word(
    word: str = Query(..., max_length=60),
    context: str = Query("", max_length=600),
    around: str = Query("", max_length=600),
    pos: str | None = Query(None, pattern="^(noun|verb|adjective|adverb)$"),
):
    w = clean_word(word)
    return describe(w, context, POS_FROM_NAME[pos] if pos else None, around=around)


@router.get("/lexicon/online/status")
def online_status(conn=Depends(get_conn)):
    return online.status(conn)


@router.put("/lexicon/online/settings")
def online_settings(body: OnlineSettingsIn, conn=Depends(get_conn)):
    online.set_enabled(conn, body.enabled)
    return online.status(conn)


@router.get("/lexicon/online/words")
def online_words(
    word: str = Query(..., max_length=60),
    kind: str = "related",
    limit: int = Query(30, ge=1, le=60),
    conn=Depends(get_conn),
):
    return online.words(conn, clean_word(word), kind, limit)


# ---------------------------------------------------------------- phrase bank


@router.get("/phrases")
def list_phrases(
    q: str = Query("", max_length=100),
    tag: str = Query("", max_length=30),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0, le=10000),
    conn=Depends(get_conn),
):
    return phrases.list_phrases(conn, _resolver(conn), q, tag, limit, offset)


@router.get("/phrases/tags")
def phrase_tags(conn=Depends(get_conn)):
    return phrases.tag_counts(conn)


@router.get("/phrases/export")
def export_phrases(conn=Depends(get_conn)):
    return JSONResponse(
        phrases.export_all(conn, _resolver(conn)),
        headers={"Content-Disposition": 'attachment; filename="studio-bars-phrases.json"'},
    )


@router.post("/phrases", status_code=201)
def create_phrase(body: PhraseIn, conn=Depends(get_conn)):
    return phrases.create(conn, body, _resolver(conn))


@router.patch("/phrases/{pid}")
def update_phrase(pid: str, body: PhraseUpdate, conn=Depends(get_conn)):
    return phrases.update(conn, pid, body, _resolver(conn))


@router.delete("/phrases/{pid}", status_code=204)
def delete_phrase(pid: str, conn=Depends(get_conn)):
    phrases.delete(conn, pid)


__all__ = ["router", "ApiError"]
