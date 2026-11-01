"""HTTP routes for the Phase 5 craft tools."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, StrictBool, StringConstraints

from . import craft, scan
from .phonetics import engine
from .phonetics.words import Resolver
from .phonetics_routes import load_custom
from .routes import get_conn
from .service import ApiError, load_song

router = APIRouter(prefix="/api/craft")
Id = Annotated[str, StringConstraints(min_length=1, max_length=64)]


def _resolver(conn) -> Resolver:
    return Resolver(engine.get_dictionary(), load_custom(conn))


class ItemIn(BaseModel):
    song_id: Id | None = None
    kind: str
    text: str = Field(max_length=1000)
    tags: list[str] = Field(default_factory=list, max_length=10)


class ItemPatch(BaseModel):
    text: str | None = Field(None, max_length=1000)
    tags: list[str] | None = Field(None, max_length=10)


class TakeIn(BaseModel):
    line_id: Id
    text: str = Field(max_length=500)
    note: str = Field("", max_length=200)


class FavIn(BaseModel):
    favourite: bool


class PlanIn(BaseModel):
    scene: str = Field("", max_length=1000)
    conflict: str = Field("", max_length=1000)
    turning_point: str = Field("", max_length=1000)
    emotional_arc: str = Field("", max_length=1000)
    notes: str = Field("", max_length=1000)


class GridIn(BaseModel):
    subdivision: str
    bars: int = 1
    assign: list[int | None] = Field(max_length=40)
    accents: list[StrictBool] = Field(default_factory=list, max_length=40)
    rests: list[int] = Field(default_factory=list, max_length=64)


class ChainsIn(BaseModel):
    lines: list[Annotated[str, StringConstraints(max_length=500)]] = Field(max_length=200)
    strictness: Literal["strict", "normal", "loose"] = "normal"


@router.get("/items")
def items(
    song_id: str | None = None,
    kind: str | None = None,
    q: str = Query("", max_length=100),
    tag: str = Query("", max_length=30),
    conn=Depends(get_conn),
):  # noqa: E501
    return craft.list_items(conn, song_id, kind, q, tag)


@router.post("/items", status_code=201)
def create_item(body: ItemIn, conn=Depends(get_conn)):
    return craft.create_item(conn, body.song_id, body.kind, body.text, body.tags)


@router.patch("/items/{item_id}")
def patch_item(item_id: str, body: ItemPatch, conn=Depends(get_conn)):
    return craft.update_item(conn, item_id, body.text, body.tags)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: str, conn=Depends(get_conn)):
    craft.delete_item(conn, item_id)


@router.get("/songs/{song_id}/takes")
def takes(song_id: str, line_id: str | None = None, conn=Depends(get_conn)):
    return craft.list_takes(conn, song_id, line_id)


@router.post("/songs/{song_id}/takes", status_code=201)
def add_take(song_id: str, body: TakeIn, conn=Depends(get_conn)):
    return craft.add_take(conn, song_id, body.line_id, body.text, body.note)


@router.put("/takes/{take_id}/favourite")
def favourite(take_id: str, body: FavIn, conn=Depends(get_conn)):
    return craft.set_favourite(conn, take_id, body.favourite)


@router.delete("/takes/{take_id}", status_code=204)
def delete_take(take_id: str, conn=Depends(get_conn)):
    craft.delete_take(conn, take_id)


@router.get("/songs/{song_id}/plan")
def get_plan(song_id: str, conn=Depends(get_conn)):
    return craft.get_plan(conn, song_id)


@router.put("/songs/{song_id}/plan")
def put_plan(song_id: str, body: PlanIn, conn=Depends(get_conn)):
    return craft.put_plan(conn, song_id, body.model_dump())


@router.get("/songs/{song_id}/grids")
def grids(song_id: str, conn=Depends(get_conn)):
    return craft.get_grids(conn, song_id)


@router.put("/songs/{song_id}/grids/{line_id}")
def put_grid(song_id: str, line_id: str, body: GridIn, conn=Depends(get_conn)):
    return craft.put_grid(conn, song_id, line_id, body.model_dump())


@router.delete("/songs/{song_id}/grids/{line_id}", status_code=204)
def delete_grid(song_id: str, line_id: str, conn=Depends(get_conn)):
    craft.delete_grid(conn, song_id, line_id)


@router.get("/syllables")
def syllables(text: str = Query(..., max_length=500), conn=Depends(get_conn)):
    return {
        "syllables": scan.line_syllables(text, _resolver(conn)),
        "note": "Stress comes from the dictionary; words it does not know are marked as guesses.",
    }  # noqa: E501


@router.get("/songs/{song_id}/scan")
def scan_song(song_id: str, conn=Depends(get_conn)):
    song = load_song(conn, song_id)
    return {**scan.scan_text(song), "structure": scan.scan_structure(song, _resolver(conn))}


@router.post("/chains")
def chains(body: ChainsIn, conn=Depends(get_conn)):
    if not any(t.strip() for t in body.lines):
        raise ApiError(422, "EMPTY", "Give some lines to look at.")
    return scan.rhyme_chains(body.lines, _resolver(conn), body.strictness)
