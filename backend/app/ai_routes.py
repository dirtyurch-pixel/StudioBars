"""HTTP routes for the AI co-writer. The key can be saved or deleted here but is never returned."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, StringConstraints

from .ai import keystore
from .ai import service as ai
from .routes import get_conn
from .service import ApiError

router = APIRouter(prefix="/api/ai")

Id = Annotated[str, StringConstraints(min_length=1, max_length=64)]
Task = Literal[
    "next_line",
    "rewrite",
    "shorter",
    "conversational",
    "imagery",
    "punchline",
    "emotion",
    "rhyme",
    "metaphor",
    "wordplay",
    "hook",
    "structure",
    "improve",
    "critique",
]


class SettingsIn(BaseModel):
    enabled: bool | None = None
    provider: str | None = None
    model: Annotated[str, StringConstraints(max_length=100)] | None = None
    base_url: Annotated[str, StringConstraints(max_length=300)] | None = None
    cap_usd: float | None = None
    price_in: float | None = None
    price_out: float | None = None


class KeyIn(BaseModel):
    provider: str
    key: Annotated[str, StringConstraints(max_length=500)]


class AiRequest(BaseModel):
    song_id: Id
    section_id: Id
    task: Task
    target_line_id: Id | None = None
    rhyme_with_line_id: Id | None = None
    count: int = Field(3, ge=1, le=5)
    instruction: Annotated[str, StringConstraints(max_length=200)] = ""
    target_syllables: int | None = Field(None, ge=1, le=40)
    include_other_sections: bool = False
    persona: Literal["co_writer", "editor", "rhyme", "vocal_coach", "critic"] = "co_writer"


class SuggestIn(AiRequest):
    ack_hash: Annotated[str, StringConstraints(min_length=64, max_length=64)]


@router.get("/status")
def get_status(conn=Depends(get_conn)):
    return ai.status(conn)


@router.put("/settings")
def put_settings(body: SettingsIn, conn=Depends(get_conn)):
    return ai.update_settings(conn, body.model_dump(exclude_none=True))


@router.put("/key")
def put_key(body: KeyIn, conn=Depends(get_conn)):
    try:
        keystore.set_key(body.provider, body.key)
    except keystore.KeyError_ as e:
        raise ApiError(422, "BAD_KEY", str(e)) from None
    return ai.status(conn)


@router.delete("/key")
def delete_key(provider: str, conn=Depends(get_conn)):
    if provider not in keystore.PROVIDERS:
        raise ApiError(422, "BAD_SETTING", "Unknown AI provider.")
    keystore.delete_key(provider)
    return ai.status(conn)


@router.post("/prepare")
def prepare(body: AiRequest, conn=Depends(get_conn)):
    return ai.prepare(conn, body.model_dump())


@router.post("/suggest")
def suggest(body: SuggestIn, conn=Depends(get_conn)):
    d = body.model_dump()
    return ai.suggest(conn, d, d.pop("ack_hash"))


@router.post("/suggestions/{suggestion_id}/accept")
def accept(suggestion_id: str, conn=Depends(get_conn)):
    return ai.accept(conn, suggestion_id)


@router.post("/test")
def test(conn=Depends(get_conn)):
    return ai.test_connection(conn)
