"""Scratch vocal takes: audio recorded in the browser, stored in the media folder, played back beside the song.

Timing is honest: `offset_ms` is where the backing track was (in milliseconds) when recording STARTED, as reported
by the browser. Microphone and device delay are not measured, so the writer can nudge it by hand. Nothing here
claims exact alignment.
"""

from __future__ import annotations

import hashlib
import shutil
import uuid
from pathlib import Path

from fastapi import Request

from .db import tx
from .music import media_dir
from .service import ApiError, new_id, now

TYPES = {
    "webm": "audio/webm",
    "ogg": "audio/ogg",
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "wav": "audio/wav",
}
MAX_TAKE_BYTES = 150 * 1024 * 1024
MAX_TAKES_PER_SONG = 100
MAX_OFFSET_MS = 6 * 3600 * 1000


def sniff(ext: str, head: bytes) -> bool:
    if ext == "webm":
        return head[:4] == b"\x1a\x45\xdf\xa3"
    if ext == "ogg":
        return head[:4] == b"OggS"
    if ext in ("m4a", "mp4"):
        return head[4:8] == b"ftyp"
    if ext == "wav":
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    return False


def ext_from_mime(mime: str) -> str:
    m = mime.split(";")[0].strip().lower()
    return {"audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "video/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav"}.get(m, "")  # fmt: skip


def _int(raw: str | None, hi: int, name: str, lo: int = 0) -> int:
    try:
        v = int(float(raw)) if raw not in (None, "") else 0
    except ValueError:
        raise ApiError(422, "BAD_NUMBER", f"{name} must be a number.") from None
    if not lo <= v <= hi:
        raise ApiError(422, "BAD_NUMBER", f"{name} is out of range.")
    return v


def _dict(r) -> dict:
    path = media_dir() / r["storage_name"]
    return {"id": r["id"], "song_id": r["song_id"], "duration_ms": r["duration_ms"], "offset_ms": r["offset_ms"], "note": r["note"], "size_bytes": r["size_bytes"], "media_type": r["media_type"], "created_at": r["created_at"], "available": path.is_file()}  # fmt: skip


def _song_ok(conn, song_id: str) -> None:
    if (
        conn.execute("SELECT 1 FROM songs WHERE id=? AND deleted_at IS NULL", (song_id,)).fetchone()
        is None
    ):
        raise ApiError(404, "NOT_FOUND", "Song not found.")


def list_takes(conn, song_id: str) -> list[dict]:
    _song_ok(conn, song_id)
    return [
        _dict(r)
        for r in conn.execute(
            "SELECT * FROM vocal_takes WHERE song_id=? ORDER BY created_at, rowid", (song_id,)
        )
    ]


async def receive(
    conn, request: Request, song_id: str, mime: str, duration_ms: str | None, offset_ms: str | None
) -> dict:
    _song_ok(conn, song_id)
    ext = ext_from_mime(mime)
    if ext not in TYPES:
        raise ApiError(415, "UNSUPPORTED_FORMAT", "That recording format is not supported.")
    dur = _int(duration_ms, 6 * 3600 * 1000, "Duration")
    off = _int(offset_ms, MAX_OFFSET_MS, "Offset", -MAX_OFFSET_MS)
    if (
        conn.execute("SELECT COUNT(*) FROM vocal_takes WHERE song_id=?", (song_id,)).fetchone()[0]
        >= MAX_TAKES_PER_SONG
    ):
        raise ApiError(
            409, "FULL", "This song already has the most takes allowed. Delete some first."
        )
    declared = request.headers.get("content-length")
    if declared and declared.isdigit():
        if int(declared) > MAX_TAKE_BYTES:
            raise ApiError(413, "TOO_LARGE", "That recording is too large.")
        if int(declared) + 100 * 1048576 > shutil.disk_usage(media_dir()).free:
            raise ApiError(507, "NO_SPACE", "There is not enough free disk space.")
    tmp = media_dir() / f".incoming-{uuid.uuid4().hex}"
    size, head, sha = 0, b"", hashlib.sha256()
    try:
        with open(tmp, "wb") as f:
            async for chunk in request.stream():
                if not chunk:
                    continue
                size += len(chunk)
                if size > MAX_TAKE_BYTES:
                    raise ApiError(413, "TOO_LARGE", "That recording is too large.")
                if len(head) < 16:
                    head += chunk[: 16 - len(head)]
                sha.update(chunk)
                f.write(chunk)
        if size == 0 or not sniff(ext, head):
            raise ApiError(422, "BAD_AUDIO", "That does not look like a valid recording.")
        tid = new_id()
        storage = f"vocal-{tid}.{ext}"
        Path(tmp).replace(media_dir() / storage)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    try:
        with tx(conn):
            conn.execute(
                "INSERT INTO vocal_takes VALUES (?,?,?,?,?,?,?,?,'',?)",
                (tid, song_id, storage, ext, TYPES[ext], size, dur, off, now()),
            )
    except BaseException:
        (media_dir() / storage).unlink(missing_ok=True)
        raise
    return _dict(conn.execute("SELECT * FROM vocal_takes WHERE id=?", (tid,)).fetchone())


def update(conn, take_id: str, note: str | None, offset_ms: int | None) -> dict:
    r = conn.execute("SELECT * FROM vocal_takes WHERE id=?", (take_id,)).fetchone()
    if r is None:
        raise ApiError(404, "NOT_FOUND", "Take not found.")
    if offset_ms is not None and abs(offset_ms) > MAX_OFFSET_MS:
        raise ApiError(422, "BAD_NUMBER", "Offset is out of range.")
    with tx(conn):
        conn.execute("UPDATE vocal_takes SET note=?, offset_ms=? WHERE id=?", ((r["note"] if note is None else note.strip()[:200]), (r["offset_ms"] if offset_ms is None else offset_ms), take_id))  # fmt: skip
    return _dict(conn.execute("SELECT * FROM vocal_takes WHERE id=?", (take_id,)).fetchone())


def delete(conn, take_id: str) -> None:
    r = conn.execute("SELECT storage_name FROM vocal_takes WHERE id=?", (take_id,)).fetchone()
    if r is None:
        raise ApiError(404, "NOT_FOUND", "Take not found.")
    with tx(conn):
        conn.execute("DELETE FROM vocal_takes WHERE id=?", (take_id,))
    (media_dir() / r["storage_name"]).unlink(missing_ok=True)


def file_for(conn, take_id: str) -> tuple[Path, str]:
    r = conn.execute(
        "SELECT storage_name, media_type FROM vocal_takes WHERE id=?", (take_id,)
    ).fetchone()
    if r is None:
        raise ApiError(404, "NOT_FOUND", "Take not found.")
    path = media_dir() / r["storage_name"]
    if not path.is_file():
        raise ApiError(404, "FILE_MISSING", "The recording file is missing from the media folder.")
    return path, r["media_type"]
