"""All song logic. The lock rules live here (and in database triggers)."""

import json
import os
import re
import sqlite3
import uuid
from datetime import UTC, datetime

from . import textio
from .db import tx
from .schemas import (
    CommentIn,
    ContentIn,
    ImportIn,
    SongCreate,
    SongUpdate,
)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, **extra):
        self.status, self.code, self.message, self.extra = status, code, message, extra


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def new_id() -> str:
    return uuid.uuid4().hex


def auto_snapshot_seconds() -> float:
    return float(os.environ.get("STUDIO_BARS_AUTO_SNAPSHOT_SECONDS", "300"))


# ---------------------------------------------------------------- reading


def _song_row(conn, song_id: str, include_deleted: bool = False) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    if row is None or (row["deleted_at"] and not include_deleted):
        raise ApiError(404, "NOT_FOUND", "Song not found.")
    return row


def load_song(conn, song_id: str, include_deleted: bool = False) -> dict:
    row = _song_row(conn, song_id, include_deleted)
    song = {k: row[k] for k in row.keys()}  # noqa: SIM118 - sqlite3.Row
    song["genres"] = [
        r["genre"]
        for r in conn.execute(
            "SELECT genre FROM song_genres WHERE song_id = ? ORDER BY rowid", (song_id,)
        )
    ]
    comments: dict[str, list[dict]] = {}
    for c in conn.execute(
        """SELECT c.* FROM line_comments c JOIN lines l ON l.id = c.line_id
           JOIN sections s ON s.id = l.section_id WHERE s.song_id = ?
           ORDER BY c.created_at, c.rowid""",
        (song_id,),
    ):
        comments.setdefault(c["line_id"], []).append(
            {k: c[k] for k in ("id", "body", "created_at", "updated_at")}
        )
    sections = []
    for s in conn.execute(
        "SELECT * FROM sections WHERE song_id = ? ORDER BY position, rowid", (song_id,)
    ):
        lines = [
            {
                "id": ln["id"],
                "text": ln["text"],
                "is_locked": bool(ln["is_locked"]),
                "comments": comments.get(ln["id"], []),
            }
            for ln in conn.execute(
                "SELECT * FROM lines WHERE section_id = ? ORDER BY position, rowid", (s["id"],)
            )
        ]
        sections.append(
            {"id": s["id"], "label": s["label"], "section_type": s["section_type"], "lines": lines}
        )
    song["sections"] = sections
    return song


def list_songs(conn, trash: bool = False) -> list[dict]:
    cond = "IS NOT NULL" if trash else "IS NULL"
    out = []
    for r in conn.execute(f"SELECT * FROM songs WHERE deleted_at {cond} ORDER BY updated_at DESC"):
        counts = conn.execute(
            """SELECT COUNT(*) n, COALESCE(SUM(l.is_locked), 0) k, COALESCE(SUM(l.text <> ''), 0) w
               FROM lines l JOIN sections s ON s.id = l.section_id WHERE s.song_id = ?""",
            (r["id"],),
        ).fetchone()
        out.append(
            {
                "id": r["id"],
                "title": r["title"],
                "bpm": r["bpm"],
                "time_signature": r["time_signature"],
                "updated_at": r["updated_at"],
                "deleted_at": r["deleted_at"],
                "genres": [
                    g["genre"]
                    for g in conn.execute(
                        "SELECT genre FROM song_genres WHERE song_id = ? ORDER BY rowid",
                        (r["id"],),
                    )
                ],
                "line_count": counts["w"],
                "locked_count": counts["k"],
            }
        )
    return out


# ---------------------------------------------------------------- songs

TEMPLATES = {
    "blank": [("Verse 1", "verse")],
    "verse-chorus": [
        ("Verse 1", "verse"),
        ("Chorus", "chorus"),
        ("Verse 2", "verse"),
        ("Bridge", "bridge"),
    ],
}


def _insert_section(conn, song_id: str, position: int, label: str, stype: str, texts, ts):
    sid = new_id()
    conn.execute(
        "INSERT INTO sections (id, song_id, label, section_type, position) VALUES (?,?,?,?,?)",
        (sid, song_id, label, stype, position),
    )
    for i, t in enumerate(texts):
        text, locked = (t, False) if isinstance(t, str) else t
        lid = new_id()
        conn.execute(
            "INSERT INTO lines (id, section_id, position, text, is_locked, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (lid, sid, i, text, 0, ts, ts),
        )
        yield lid, locked


def create_song(conn, data: SongCreate) -> dict:
    ts, song_id = now(), new_id()
    with tx(conn):
        conn.execute(
            """INSERT INTO songs (id, title, concept, mood, point_of_view, bpm, time_signature,
               created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)""",
            (song_id, data.title, data.concept, data.mood, data.point_of_view, data.bpm,
             data.time_signature, ts, ts),
        )  # fmt: skip
        for g in data.genres:
            conn.execute("INSERT INTO song_genres VALUES (?,?)", (song_id, g))
        for pos, (label, stype) in enumerate(TEMPLATES[data.template]):
            list(_insert_section(conn, song_id, pos, label, stype, [""] * 4, ts))
    return load_song(conn, song_id)


def update_song(conn, song_id: str, data: SongUpdate) -> dict:
    fields = data.model_fields_set
    with tx(conn):
        _song_row(conn, song_id)
        sets, vals = [], []
        for col in ("title", "concept", "mood", "point_of_view", "bpm", "time_signature"):
            if col in fields:
                v = getattr(data, col)
                if col == "time_signature" and v == "":
                    v = None
                if col == "title" and v is None:
                    raise ApiError(422, "INVALID", "Title cannot be empty.")
                sets.append(f"{col} = ?")
                vals.append(v)
        if "genres" in fields and data.genres is not None:
            conn.execute("DELETE FROM song_genres WHERE song_id = ?", (song_id,))
            for g in dict.fromkeys(data.genres):
                conn.execute("INSERT INTO song_genres VALUES (?,?)", (song_id, g))
        sets.append("updated_at = ?")
        vals.append(now())
        conn.execute(f"UPDATE songs SET {', '.join(sets)} WHERE id = ?", (*vals, song_id))
    return load_song(conn, song_id)


def delete_song(conn, song_id: str) -> None:
    """Soft delete: the song moves to the trash and nothing in it is altered."""
    with tx(conn):
        _song_row(conn, song_id)
        conn.execute("UPDATE songs SET deleted_at = ? WHERE id = ?", (now(), song_id))


def undelete_song(conn, song_id: str) -> dict:
    with tx(conn):
        _song_row(conn, song_id, include_deleted=True)
        conn.execute("UPDATE songs SET deleted_at = NULL, updated_at = ? WHERE id = ?",
                     (now(), song_id))  # fmt: skip
    return load_song(conn, song_id)


# ---------------------------------------------------------------- content


def _locked_lines(conn, song_id: str) -> dict[str, str]:
    return {
        r["id"]: r["text"]
        for r in conn.execute(
            """SELECT l.id, l.text FROM lines l JOIN sections s ON s.id = l.section_id
               WHERE s.song_id = ? AND l.is_locked = 1""",
            (song_id,),
        )
    }


def _lock_violations(locked: dict[str, str], new_texts: dict[str, str]) -> list[str]:
    return sorted(i for i, t in locked.items() if i not in new_texts or new_texts[i] != t)


def save_content(conn, song_id: str, data: ContentIn) -> dict:
    sec_ids = [s.id for s in data.sections]
    line_ids = [ln.id for s in data.sections for ln in s.lines]
    if len(set(sec_ids)) != len(sec_ids) or len(set(line_ids)) != len(line_ids):
        raise ApiError(422, "DUPLICATE_ID", "Duplicate section or line ids.")
    if len(line_ids) > 2000:
        raise ApiError(422, "TOO_MANY_LINES", "Too many lines (limit 2000).")
    ts = now()
    with tx(conn):
        song = _song_row(conn, song_id)
        if song["version"] != data.base_version:
            raise ApiError(
                409, "VERSION_CONFLICT",
                "This song was changed somewhere else.",
                current_version=song["version"],
            )  # fmt: skip
        # Refuse ids that belong to a different song.
        for table, ids in (("sections", sec_ids), ("lines", line_ids)):
            if not ids:
                continue
            q = ",".join("?" * len(ids))
            owner_sql = (
                f"SELECT t.id FROM sections t WHERE t.id IN ({q}) AND t.song_id <> ?"
                if table == "sections"
                else f"""SELECT t.id FROM lines t JOIN sections s ON s.id = t.section_id
                         WHERE t.id IN ({q}) AND s.song_id <> ?"""
            )
            if conn.execute(owner_sql, (*ids, song_id)).fetchone():
                raise ApiError(422, "FOREIGN_ID", "An id belongs to another song.")
        locked = _locked_lines(conn, song_id)
        bad = _lock_violations(locked, {ln.id: ln.text for s in data.sections for ln in s.lines})
        if bad:
            raise ApiError(423, "LOCKED_LINES", "Locked lines cannot be changed or removed.",
                           line_ids=bad)  # fmt: skip

        existing_secs = {
            r["id"] for r in conn.execute("SELECT id FROM sections WHERE song_id = ?", (song_id,))
        }
        existing_lines = {
            r["id"]: r["text"]
            for r in conn.execute(
                """SELECT l.id, l.text FROM lines l JOIN sections s ON s.id = l.section_id
                   WHERE s.song_id = ?""",
                (song_id,),
            )
        }
        for pos, s in enumerate(data.sections):
            if s.id in existing_secs:
                conn.execute(
                    "UPDATE sections SET label=?, section_type=?, position=? WHERE id=?",
                    (s.label, s.section_type, pos, s.id),
                )
            else:
                conn.execute(
                    "INSERT INTO sections (id, song_id, label, section_type, position)"
                    " VALUES (?,?,?,?,?)",
                    (s.id, song_id, s.label, s.section_type, pos),
                )
            for i, ln in enumerate(s.lines):
                if ln.id not in existing_lines:
                    conn.execute(
                        "INSERT INTO lines (id, section_id, position, text, is_locked,"
                        " created_at, updated_at) VALUES (?,?,?,?,0,?,?)",
                        (ln.id, s.id, i, ln.text, ts, ts),
                    )
                elif ln.id in locked:  # text is identical (checked above); only move it
                    conn.execute(
                        "UPDATE lines SET section_id=?, position=? WHERE id=?", (s.id, i, ln.id)
                    )
                elif existing_lines[ln.id] != ln.text:
                    conn.execute(
                        "UPDATE lines SET section_id=?, position=?, text=?, updated_at=? WHERE id=?",
                        (s.id, i, ln.text, ts, ln.id),
                    )
                else:
                    conn.execute(
                        "UPDATE lines SET section_id=?, position=? WHERE id=?", (s.id, i, ln.id)
                    )
        keep_lines = set(line_ids)
        for lid in existing_lines:
            if lid not in keep_lines:  # all are unlocked (verified above)
                conn.execute("DELETE FROM lines WHERE id = ?", (lid,))
        for sid in existing_secs - set(sec_ids):
            conn.execute("DELETE FROM sections WHERE id = ?", (sid,))
        conn.execute(
            "UPDATE songs SET version = version + 1, updated_at = ? WHERE id = ?", (ts, song_id)
        )
        _maybe_auto_snapshot(conn, song_id)
    return load_song(conn, song_id)


# ---------------------------------------------------------------- locks & comments


def set_lock(conn, line_id: str, locked: bool) -> dict:
    with tx(conn):
        row = conn.execute(
            """SELECT s.song_id FROM lines l JOIN sections s ON s.id = l.section_id
               JOIN songs g ON g.id = s.song_id WHERE l.id = ? AND g.deleted_at IS NULL""",
            (line_id,),
        ).fetchone()
        if row is None:
            raise ApiError(404, "NOT_FOUND", "Line not found.")
        conn.execute("UPDATE lines SET is_locked = ? WHERE id = ?", (1 if locked else 0, line_id))
    return load_song(conn, row["song_id"])


def _comment_song(conn, comment_id: str) -> str:
    row = conn.execute(
        """SELECT s.song_id FROM line_comments c JOIN lines l ON l.id = c.line_id
           JOIN sections s ON s.id = l.section_id WHERE c.id = ?""",
        (comment_id,),
    ).fetchone()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Comment not found.")
    return row["song_id"]


def add_comment(conn, line_id: str, data: CommentIn) -> dict:
    ts = now()
    with tx(conn):
        row = conn.execute(
            "SELECT s.song_id FROM lines l JOIN sections s ON s.id = l.section_id WHERE l.id = ?",
            (line_id,),
        ).fetchone()
        if row is None:
            raise ApiError(404, "NOT_FOUND", "Line not found.")
        conn.execute(
            "INSERT INTO line_comments VALUES (?,?,?,?,?)",
            (new_id(), line_id, data.body, ts, ts),
        )
    return load_song(conn, row["song_id"])


def edit_comment(conn, comment_id: str, data: CommentIn) -> dict:
    with tx(conn):
        song_id = _comment_song(conn, comment_id)
        conn.execute(
            "UPDATE line_comments SET body = ?, updated_at = ? WHERE id = ?",
            (data.body, now(), comment_id),
        )
    return load_song(conn, song_id)


def delete_comment(conn, comment_id: str) -> dict:
    with tx(conn):
        song_id = _comment_song(conn, comment_id)
        conn.execute("DELETE FROM line_comments WHERE id = ?", (comment_id,))
    return load_song(conn, song_id)


# ---------------------------------------------------------------- revisions


def _snapshot(song: dict) -> dict:
    return {
        "song": {
            k: song[k]
            for k in (
                "title",
                "concept",
                "mood",
                "point_of_view",
                "bpm",
                "time_signature",
                "genres",
            )
        },
        "sections": [
            {
                "id": s["id"],
                "label": s["label"],
                "section_type": s["section_type"],
                "lines": [
                    {
                        "id": ln["id"],
                        "text": ln["text"],
                        "is_locked": ln["is_locked"],
                        "comments": ln["comments"],
                    }
                    for ln in s["lines"]
                ],
            }
            for s in song["sections"]
        ],
    }


def _write_revision(conn, song_id: str, kind: str, description: str) -> str:
    rid = new_id()
    conn.execute(
        "INSERT INTO revisions VALUES (?,?,?,?,?,?)",
        (rid, song_id, now(), kind, description, json.dumps(_snapshot(load_song(conn, song_id)))),
    )
    return rid


def _maybe_auto_snapshot(conn, song_id: str) -> None:
    last = conn.execute(
        "SELECT created_at FROM revisions WHERE song_id = ? ORDER BY created_at DESC LIMIT 1",
        (song_id,),
    ).fetchone()
    if last is not None:
        age = (datetime.now(UTC) - datetime.fromisoformat(last["created_at"])).total_seconds()
        if age < auto_snapshot_seconds():
            return
    _write_revision(conn, song_id, "auto", "Automatic snapshot")


def list_revisions(conn, song_id: str) -> list[dict]:
    _song_row(conn, song_id)
    out = []
    for r in conn.execute(
        "SELECT id, created_at, kind, description, snapshot_json FROM revisions"
        " WHERE song_id = ? ORDER BY created_at DESC, rowid DESC",
        (song_id,),
    ):
        snap = json.loads(r["snapshot_json"])
        out.append(
            {
                "id": r["id"],
                "created_at": r["created_at"],
                "kind": r["kind"],
                "description": r["description"],
                "line_count": sum(1 for s in snap["sections"] for ln in s["lines"] if ln["text"]),
                "section_count": len(snap["sections"]),
            }
        )
    return out


def create_revision(conn, song_id: str, description: str) -> list[dict]:
    with tx(conn):
        _song_row(conn, song_id)
        _write_revision(conn, song_id, "manual", description.strip() or "Manual snapshot")
    return list_revisions(conn, song_id)


def restore_revision(conn, revision_id: str) -> dict:
    row = conn.execute("SELECT * FROM revisions WHERE id = ?", (revision_id,)).fetchone()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Revision not found.")
    song_id, snap, ts = row["song_id"], json.loads(row["snapshot_json"]), now()
    with tx(conn):
        _song_row(conn, song_id)
        snap_texts = {ln["id"]: ln["text"] for s in snap["sections"] for ln in s["lines"]}
        bad = _lock_violations(_locked_lines(conn, song_id), snap_texts)
        if bad:
            raise ApiError(
                423, "LOCKED_LINES",
                "Restoring this version would change or remove locked lines. Unlock them first.",
                line_ids=bad,
            )  # fmt: skip
        _write_revision(conn, song_id, "pre-restore", "Before restoring an earlier version")
        keep = set(snap_texts)
        existing = {
            r["id"]: r["is_locked"]
            for r in conn.execute(
                """SELECT l.id, l.is_locked FROM lines l JOIN sections s ON s.id = l.section_id
                   WHERE s.song_id = ?""",
                (song_id,),
            )
        }
        for lid in existing:
            if lid not in keep:  # unlocked by the check above
                conn.execute("DELETE FROM lines WHERE id = ?", (lid,))
        snap_secs = {s["id"] for s in snap["sections"]}
        for r in conn.execute("SELECT id FROM sections WHERE song_id = ?", (song_id,)).fetchall():
            if r["id"] not in snap_secs:
                conn.execute("DELETE FROM sections WHERE id = ?", (r["id"],))
        have_secs = {
            r["id"] for r in conn.execute("SELECT id FROM sections WHERE song_id = ?", (song_id,))
        }
        for pos, s in enumerate(snap["sections"]):
            if s["id"] in have_secs:
                conn.execute(
                    "UPDATE sections SET label=?, section_type=?, position=? WHERE id=?",
                    (s["label"], s["section_type"], pos, s["id"]),
                )
            else:
                conn.execute(
                    "INSERT INTO sections (id, song_id, label, section_type, position)"
                    " VALUES (?,?,?,?,?)",
                    (s["id"], song_id, s["label"], s["section_type"], pos),
                )
            for i, ln in enumerate(s["lines"]):
                if ln["id"] in existing:
                    if existing[ln["id"]]:  # locked: only position / section may change
                        conn.execute(
                            "UPDATE lines SET section_id=?, position=? WHERE id=?",
                            (s["id"], i, ln["id"]),
                        )
                    else:
                        conn.execute(
                            "UPDATE lines SET section_id=?, position=?, text=?, updated_at=?"
                            " WHERE id=?",
                            (s["id"], i, ln["text"], ts, ln["id"]),
                        )
                else:
                    conn.execute(
                        "INSERT INTO lines (id, section_id, position, text, is_locked,"
                        " created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                        (ln["id"], s["id"], i, ln["text"], 1 if ln["is_locked"] else 0, ts, ts),
                    )
                    for c in ln["comments"]:
                        conn.execute(
                            "INSERT OR IGNORE INTO line_comments VALUES (?,?,?,?,?)",
                            (c["id"], ln["id"], c["body"], c["created_at"], c["updated_at"]),
                        )
        meta = snap["song"]
        conn.execute(
            """UPDATE songs SET title=?, concept=?, mood=?, point_of_view=?, bpm=?,
               time_signature=?, version = version + 1, updated_at=? WHERE id=?""",
            (meta["title"], meta["concept"], meta["mood"], meta["point_of_view"], meta["bpm"],
             meta["time_signature"], ts, song_id),
        )  # fmt: skip
        conn.execute("DELETE FROM song_genres WHERE song_id = ?", (song_id,))
        for g in meta["genres"]:
            conn.execute("INSERT INTO song_genres VALUES (?,?)", (song_id, g))
    return load_song(conn, song_id)


# ---------------------------------------------------------------- import / export


def preview_import(data: ImportIn) -> dict:
    try:
        parsed = textio.parse_any(data.content, data.format)
    except textio.ParseError as e:
        raise ApiError(422, "IMPORT_FAILED", str(e)) from e
    return {
        "title": data.title or parsed.title or "Imported song",
        "warnings": parsed.warnings,
        "line_count": parsed.line_count,
        "locked_count": sum(ln.is_locked for s in parsed.sections for ln in s.lines),
        "sections": [
            {"label": s.label, "section_type": s.section_type, "lines": [ln.text for ln in s.lines]}
            for s in parsed.sections
        ],
    }


def commit_import(conn, data: ImportIn) -> dict:
    """Always creates a NEW song; an import never overwrites existing lyrics."""
    try:
        parsed = textio.parse_any(data.content, data.format)
    except textio.ParseError as e:
        raise ApiError(422, "IMPORT_FAILED", str(e)) from e
    title = (data.title or parsed.title or "Imported song").strip()[:200] or "Imported song"
    genres = data.genres or parsed.genres
    bpm = parsed.bpm if isinstance(parsed.bpm, int) and 30 <= parsed.bpm <= 300 else None
    ts_sig = parsed.time_signature if re.match(r"^\d{1,2}/\d{1,2}$", parsed.time_signature or "") \
        else None  # fmt: skip
    ts, song_id = now(), new_id()
    with tx(conn):
        conn.execute(
            """INSERT INTO songs (id, title, concept, mood, point_of_view, bpm, time_signature,
               created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)""",
            (song_id, title, parsed.concept, parsed.mood, parsed.point_of_view, bpm, ts_sig, ts, ts),
        )  # fmt: skip
        for g in dict.fromkeys(genres):
            conn.execute("INSERT INTO song_genres VALUES (?,?)", (song_id, g))
        for pos, sec in enumerate(parsed.sections):
            stype = sec.section_type if sec.section_type in (
                "intro", "verse", "pre-chorus", "chorus", "hook", "bridge", "outro"
            ) else "custom"  # fmt: skip
            ids = list(
                _insert_section(
                    conn, song_id, pos, sec.label, stype, [ln.text for ln in sec.lines], ts
                )
            )
            for (lid, _), pl in zip(ids, sec.lines, strict=True):
                for body in pl.comments:
                    conn.execute(
                        "INSERT INTO line_comments VALUES (?,?,?,?,?)",
                        (new_id(), lid, body, ts, ts),
                    )
                if pl.is_locked:  # lock last, after the text is in place
                    conn.execute("UPDATE lines SET is_locked = 1 WHERE id = ?", (lid,))
    return load_song(conn, song_id)


def export_song(conn, song_id: str, fmt: str) -> tuple[str, str, str]:
    """Returns (body, media_type, filename)."""
    song = load_song(conn, song_id)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", song["title"]).strip("_")[:60] or "song"
    if fmt == "txt":
        return textio.export_txt(song), "text/plain; charset=utf-8", f"{safe}.txt"
    if fmt == "md":
        return textio.export_md(song), "text/markdown; charset=utf-8", f"{safe}.md"
    if fmt == "json":
        return textio.export_json(song, now()), "application/json", f"{safe}.json"
    raise ApiError(422, "INVALID", "Unknown export format.")
