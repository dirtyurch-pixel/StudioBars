"""Phase 5 craft tools: vault, concept board, alternative takes, song plan, flow grids.

None of this writes to songs, sections or lines. Text only reaches the lyrics when the writer chooses to
insert a copy through the editor's normal guarded path (so locks always hold).
"""

from __future__ import annotations

import json

from .db import tx
from .service import ApiError, load_song, new_id, now

VAULT_KINDS = ("hook", "punchline", "bar", "rhyme", "idea")
CONCEPT_KINDS = ("theme", "character", "scene", "title", "mood", "arc", "hook", "idea")
MAX_ITEMS = 3000
MAX_TAKES_PER_LINE = 30
PLAN_FIELDS = ("scene", "conflict", "turning_point", "emotional_arc", "notes")
SUBDIVISIONS = {"8th": 8, "16th": 16, "triplet": 12}  # slots in one 4/4 bar
MAX_BARS = 2


def _tags(raw) -> list[str]:
    out: list[str] = []
    for t in raw or []:
        t = " ".join(str(t).lower().split())[:30]
        if t and t not in out:
            out.append(t)
    return out[:10]


def _item(r) -> dict:
    return {"id": r["id"], "song_id": r["song_id"], "kind": r["kind"], "text": r["text"], "tags": json.loads(r["tags"]), "created_at": r["created_at"], "updated_at": r["updated_at"]}  # fmt: skip


def _check_song(conn, song_id: str) -> None:
    if (
        conn.execute("SELECT 1 FROM songs WHERE id=? AND deleted_at IS NULL", (song_id,)).fetchone()
        is None
    ):
        raise ApiError(404, "NOT_FOUND", "Song not found.")


# ---------------------------------------------------------------- vault and concept board


def list_items(
    conn, song_id: str | None, kind: str | None = None, q: str = "", tag: str = ""
) -> list[dict]:
    if song_id:
        _check_song(conn, song_id)
    sql, args = (
        "SELECT * FROM craft_items WHERE " + ("song_id=?" if song_id else "song_id IS NULL"),
        [song_id] if song_id else [],
    )
    if kind:
        sql += " AND kind=?"
        args.append(kind)
    rows = conn.execute(sql + " ORDER BY created_at DESC, rowid DESC", args).fetchall()
    out = [_item(r) for r in rows]
    if q.strip():
        needle = q.strip().lower()
        out = [i for i in out if needle in i["text"].lower() or any(needle in t for t in i["tags"])]
    if tag:
        out = [i for i in out if tag.lower() in i["tags"]]
    return out


def create_item(conn, song_id: str | None, kind: str, text: str, tags) -> dict:
    kinds = CONCEPT_KINDS if song_id else VAULT_KINDS
    if kind not in kinds:
        raise ApiError(422, "BAD_KIND", f"Kind must be one of: {', '.join(kinds)}.")
    text = "\n".join(" ".join(row.split()) for row in text.strip().splitlines())
    text = text.strip()
    if not text or len(text) > 1000:
        raise ApiError(422, "BAD_TEXT", "Write something (up to 1000 characters).")
    if song_id:
        _check_song(conn, song_id)
    with tx(conn):
        n = conn.execute("SELECT COUNT(*) FROM craft_items").fetchone()[0]
        if n >= MAX_ITEMS:
            raise ApiError(409, "FULL", "Too many saved items. Delete some first.")
        iid, ts = new_id(), now()
        conn.execute(
            "INSERT INTO craft_items VALUES (?,?,?,?,?,?,?)",
            (iid, song_id, kind, text, json.dumps(_tags(tags)), ts, ts),
        )
    return _item(conn.execute("SELECT * FROM craft_items WHERE id=?", (iid,)).fetchone())


def update_item(conn, item_id: str, text: str | None, tags) -> dict:
    r = conn.execute("SELECT * FROM craft_items WHERE id=?", (item_id,)).fetchone()
    if r is None:
        raise ApiError(404, "NOT_FOUND", "Item not found.")
    new_text = r["text"] if text is None else text.strip()
    if not new_text or len(new_text) > 1000:
        raise ApiError(422, "BAD_TEXT", "Write something (up to 1000 characters).")
    new_tags = json.loads(r["tags"]) if tags is None else _tags(tags)
    with tx(conn):
        conn.execute(
            "UPDATE craft_items SET text=?, tags=?, updated_at=? WHERE id=?",
            (new_text, json.dumps(new_tags), now(), item_id),
        )
    return _item(conn.execute("SELECT * FROM craft_items WHERE id=?", (item_id,)).fetchone())


def delete_item(conn, item_id: str) -> None:
    with tx(conn):
        if conn.execute("DELETE FROM craft_items WHERE id=?", (item_id,)).rowcount == 0:
            raise ApiError(404, "NOT_FOUND", "Item not found.")


# ---------------------------------------------------------------- alternative takes


def _take(r) -> dict:
    return {"id": r["id"], "line_id": r["line_id"], "text": r["text"], "favourite": bool(r["favourite"]), "note": r["note"], "created_at": r["created_at"]}  # fmt: skip


def list_takes(conn, song_id: str, line_id: str | None = None) -> list[dict]:
    _check_song(conn, song_id)
    if line_id:
        rows = conn.execute(
            "SELECT * FROM alt_takes WHERE song_id=? AND line_id=? ORDER BY created_at, rowid",
            (song_id, line_id),
        )
    else:
        rows = conn.execute(
            "SELECT * FROM alt_takes WHERE song_id=? ORDER BY created_at, rowid", (song_id,)
        )
    return [_take(r) for r in rows]


def add_take(conn, song_id: str, line_id: str, text: str, note: str = "") -> dict:
    song = load_song(conn, song_id)
    if not any(ln["id"] == line_id for s in song["sections"] for ln in s["lines"]):
        raise ApiError(404, "NOT_FOUND", "That line is not in this song.")
    text = " ".join(text.split())
    if not text or len(text) > 500:
        raise ApiError(422, "BAD_TEXT", "A take is one line of up to 500 characters.")
    with tx(conn):
        if (
            conn.execute(
                "SELECT COUNT(*) FROM alt_takes WHERE song_id=? AND line_id=?", (song_id, line_id)
            ).fetchone()[0]
            >= MAX_TAKES_PER_LINE
        ):
            raise ApiError(
                409, "FULL", "That line already has the most takes allowed. Delete some first."
            )
        tid = new_id()
        conn.execute(
            "INSERT INTO alt_takes VALUES (?,?,?,?,0,?,?)",
            (tid, song_id, line_id, text, note.strip()[:200], now()),
        )
    return _take(conn.execute("SELECT * FROM alt_takes WHERE id=?", (tid,)).fetchone())


def set_favourite(conn, take_id: str, fav: bool) -> dict:
    with tx(conn):
        if (
            conn.execute(
                "UPDATE alt_takes SET favourite=? WHERE id=?", (1 if fav else 0, take_id)
            ).rowcount
            == 0
        ):
            raise ApiError(404, "NOT_FOUND", "Take not found.")
    return _take(conn.execute("SELECT * FROM alt_takes WHERE id=?", (take_id,)).fetchone())


def delete_take(conn, take_id: str) -> None:
    with tx(conn):
        if conn.execute("DELETE FROM alt_takes WHERE id=?", (take_id,)).rowcount == 0:
            raise ApiError(404, "NOT_FOUND", "Take not found.")


# ---------------------------------------------------------------- song plan (narrative)


def get_plan(conn, song_id: str) -> dict:
    _check_song(conn, song_id)
    r = conn.execute("SELECT plan_json FROM song_plan WHERE song_id=?", (song_id,)).fetchone()
    data = json.loads(r["plan_json"]) if r else {}
    return {k: data.get(k, "") for k in PLAN_FIELDS}


def put_plan(conn, song_id: str, plan: dict) -> dict:
    _check_song(conn, song_id)
    clean = {k: str(plan.get(k, "")).strip()[:1000] for k in PLAN_FIELDS}
    with tx(conn):
        conn.execute(
            "INSERT INTO song_plan VALUES (?,?,?) ON CONFLICT(song_id) DO UPDATE SET plan_json=excluded.plan_json, updated_at=excluded.updated_at",
            (song_id, json.dumps(clean), now()),
        )
    return clean


# ---------------------------------------------------------------- flow grids


def validate_grid(g: dict) -> dict:
    sub = g.get("subdivision")
    if sub not in SUBDIVISIONS:
        raise ApiError(422, "BAD_GRID", "Subdivision must be 8th, 16th or triplet.")
    bars = g.get("bars", 1)
    if not isinstance(bars, int) or isinstance(bars, bool) or not 1 <= bars <= MAX_BARS:
        raise ApiError(422, "BAD_GRID", f"A line can cover 1 to {MAX_BARS} bars.")
    slots = SUBDIVISIONS[sub] * bars
    assign = g.get("assign")
    if not isinstance(assign, list) or len(assign) > 40:
        raise ApiError(422, "BAD_GRID", "Give a slot (or empty) for each syllable.")
    seen: set[int] = set()
    clean: list[int | None] = []
    for a in assign:
        if a is None:
            clean.append(None)
            continue
        if not isinstance(a, int) or isinstance(a, bool) or not 0 <= a < slots:
            raise ApiError(422, "BAD_GRID", f"Slots run from 0 to {slots - 1}.")
        if a in seen:
            raise ApiError(422, "BAD_GRID", "Two syllables cannot sit on the same slot.")
        seen.add(a)
        clean.append(a)
    accents = g.get("accents", [])
    if (
        not isinstance(accents, list)
        or len(accents) > 40
        or any(not isinstance(x, bool) for x in accents)
    ):
        raise ApiError(422, "BAD_GRID", "Accents must be true/false per syllable.")
    rests = g.get("rests", [])
    if not isinstance(rests, list) or any(
        not isinstance(x, int) or isinstance(x, bool) or not 0 <= x < slots or x in seen
        for x in rests
    ):
        raise ApiError(422, "BAD_GRID", "A rest must be an empty slot inside the line.")
    return {
        "subdivision": sub,
        "bars": bars,
        "assign": clean,
        "accents": accents[: len(clean)],
        "rests": sorted(set(rests)),
    }


def get_grids(conn, song_id: str) -> dict[str, dict]:
    _check_song(conn, song_id)
    return {
        r["line_id"]: json.loads(r["grid_json"])
        for r in conn.execute(
            "SELECT line_id, grid_json FROM flow_grids WHERE song_id=?", (song_id,)
        )
    }


def put_grid(conn, song_id: str, line_id: str, grid: dict) -> dict:
    song = load_song(conn, song_id)
    if not any(ln["id"] == line_id for s in song["sections"] for ln in s["lines"]):
        raise ApiError(404, "NOT_FOUND", "That line is not in this song.")
    clean = validate_grid(grid)
    with tx(conn):
        conn.execute(
            "INSERT INTO flow_grids VALUES (?,?,?,?) ON CONFLICT(song_id,line_id) DO UPDATE SET grid_json=excluded.grid_json, updated_at=excluded.updated_at",
            (song_id, line_id, json.dumps(clean), now()),
        )
    return clean


def delete_grid(conn, song_id: str, line_id: str) -> None:
    with tx(conn):
        conn.execute("DELETE FROM flow_grids WHERE song_id=? AND line_id=?", (song_id, line_id))
