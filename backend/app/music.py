"""Music library, playlists, playback state and song links.

Audio files are copied into a private folder on the machine running the backend.
The API never exposes file paths; tracks are addressed by random ids only.
"""

import hashlib
import os
import shutil
import sqlite3
import uuid
from pathlib import Path

from fastapi import Request

from .db import tx
from .schemas import PlaybackStateIn, SongAudioLinkIn, TrackUpdate
from .service import ApiError, _song_row, new_id, now

# extension -> media type served back to the player
ALLOWED: dict[str, str] = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "flac": "audio/flac",
    "ogg": "audio/ogg",
    "opus": "audio/ogg",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
}
MAX_TRACKS = 2000
CHUNK = 1024 * 256


def media_dir() -> Path:
    p = Path(
        os.environ.get(
            "STUDIO_BARS_MEDIA_DIR", str(Path(__file__).resolve().parents[2] / "data" / "media")
        )
    )
    p.mkdir(parents=True, exist_ok=True)
    return p


def max_bytes() -> int:
    return int(float(os.environ.get("STUDIO_BARS_MAX_AUDIO_MB", "300")) * 1024 * 1024)


def sniff_ok(ext: str, head: bytes) -> bool:
    """Does the start of the file look like the format its extension claims?"""
    if ext == "mp3":
        return head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0)
    if ext == "wav":
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    if ext == "flac":
        return head[:4] == b"fLaC"
    if ext in ("ogg", "opus"):
        return head[:4] == b"OggS"
    if ext == "m4a":
        return head[4:8] == b"ftyp"
    if ext == "aac":
        return len(head) > 1 and head[0] == 0xFF and head[1] & 0xF0 == 0xF0
    return False


def split_filename(raw: str) -> tuple[str, str]:
    """(title, extension) from a user-supplied file name. Never used as a path."""
    name = raw.replace("\\", "/").split("/")[-1].strip().replace("\x00", "")
    stem, _, ext = name.rpartition(".")
    if not stem:
        stem, ext = name, ""
    title = " ".join(stem.split())[:200] or "Untitled track"
    return title, ext.lower()


def track_dict(row: sqlite3.Row) -> dict:
    path = media_dir() / row["storage_name"]
    return {
        "id": row["id"],
        "title": row["title"],
        "artist": row["artist"],
        "album": row["album"],
        "duration": row["duration"],
        "media_type": row["media_type"],
        "ext": row["ext"],
        "size_bytes": row["size_bytes"],
        "added_at": row["added_at"],
        "available": path.is_file(),
        "file_version": row["content_hash"][:12],
    }


def _track_row(conn, track_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM audio_tracks WHERE id = ?", (track_id,)).fetchone()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Track not found.")
    return row


# ---------------------------------------------------------------- upload


async def receive_file(request: Request, filename: str) -> tuple[Path, str, str, int, str]:
    """Stream the request body to a temp file inside the media folder, then validate it.

    Returns (temp_path, title, ext, size, sha256). Raises ApiError (and cleans up) if invalid.
    """
    title, ext = split_filename(filename)
    if ext not in ALLOWED:
        raise ApiError(
            415, "UNSUPPORTED_FORMAT",
            f"“{filename}” is not a supported audio type. Use " + ", ".join(sorted(ALLOWED)) + ".",
        )  # fmt: skip
    limit = max_bytes()
    declared = request.headers.get("content-length")
    if declared and declared.isdigit():
        if int(declared) > limit:
            raise ApiError(413, "TOO_LARGE", f"That file is larger than {limit // 1048576} MB.")
        free = shutil.disk_usage(media_dir()).free
        if int(declared) + 100 * 1048576 > free:
            raise ApiError(507, "NO_SPACE", "There is not enough free disk space for that file.")
    tmp = media_dir() / f".incoming-{uuid.uuid4().hex}"
    sha, size, head = hashlib.sha256(), 0, b""
    try:
        with open(tmp, "wb") as f:
            async for chunk in request.stream():
                if not chunk:
                    continue
                size += len(chunk)
                if size > limit:
                    raise ApiError(
                        413, "TOO_LARGE", f"That file is larger than {limit // 1048576} MB."
                    )
                if len(head) < 32:
                    head += chunk[: 32 - len(head)]
                sha.update(chunk)
                f.write(chunk)
        if size == 0:
            raise ApiError(422, "EMPTY_FILE", "That file is empty.")
        if not sniff_ok(ext, head):
            raise ApiError(
                415, "NOT_AUDIO",
                f"“{filename}” does not look like a real .{ext} file, so it was not imported.",
            )  # fmt: skip
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return tmp, title, ext, size, sha.hexdigest()


def clean_duration(raw: str | None) -> float | None:
    try:
        d = float(raw) if raw is not None else None
    except ValueError:
        return None
    return d if d is not None and 0 < d < 86400 else None


def create_track(conn, tmp: Path, title: str, ext: str, size: int, digest: str, duration) -> dict:
    ts = now()
    with tx(conn):
        if conn.execute("SELECT COUNT(*) FROM audio_tracks").fetchone()[0] >= MAX_TRACKS:
            tmp.unlink(missing_ok=True)
            raise ApiError(422, "LIBRARY_FULL", f"The library is limited to {MAX_TRACKS} tracks.")
        dup = conn.execute(
            "SELECT id FROM audio_tracks WHERE content_hash = ? LIMIT 1", (digest,)
        ).fetchone()
        tid = new_id()
        storage = f"{tid}.{ext}"
        os.replace(tmp, media_dir() / storage)
        conn.execute(
            "INSERT INTO audio_tracks (id, title, artist, album, duration, media_type, ext,"
            " size_bytes, content_hash, storage_name, added_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (tid, title, "", "", duration, ALLOWED[ext], ext, size, digest, storage, ts),
        )
    out = track_dict(_track_row(conn, tid))
    out["duplicate_of"] = dup["id"] if dup else None
    return out


def relink_track(
    conn, track_id: str, tmp: Path, ext: str, size: int, digest: str, duration
) -> dict:
    with tx(conn):
        old = _track_row(conn, track_id)
        storage = f"{track_id}-{digest[:8]}.{ext}"
        os.replace(tmp, media_dir() / storage)
        conn.execute(
            "UPDATE audio_tracks SET media_type=?, ext=?, size_bytes=?, content_hash=?,"
            " storage_name=?, duration=COALESCE(?, duration) WHERE id=?",
            (ALLOWED[ext], ext, size, digest, storage, duration, track_id),
        )
    if old["storage_name"] != storage:
        (media_dir() / old["storage_name"]).unlink(missing_ok=True)
    return track_dict(_track_row(conn, track_id))


def audio_path(conn, track_id: str) -> tuple[Path, str]:
    row = _track_row(conn, track_id)
    path = (media_dir() / row["storage_name"]).resolve()
    if path.parent != media_dir().resolve() or not path.is_file():
        raise ApiError(
            404, "FILE_MISSING",
            "The audio file is missing. Use “Relink file” to choose it again.",
        )  # fmt: skip
    return path, row["media_type"]


# ---------------------------------------------------------------- tracks


def list_tracks(conn) -> list[dict]:
    return [
        track_dict(r) for r in conn.execute("SELECT * FROM audio_tracks ORDER BY added_at, rowid")
    ]


def update_track(conn, track_id: str, data: TrackUpdate) -> dict:
    with tx(conn):
        _track_row(conn, track_id)
        sets, vals = [], []
        for col in ("title", "artist", "album"):
            if col in data.model_fields_set and getattr(data, col) is not None:
                sets.append(f"{col} = ?")
                vals.append(getattr(data, col))
        if sets:
            conn.execute(
                f"UPDATE audio_tracks SET {', '.join(sets)} WHERE id = ?", (*vals, track_id)
            )
    return track_dict(_track_row(conn, track_id))


def delete_track(conn, track_id: str) -> None:
    with tx(conn):
        row = _track_row(conn, track_id)
        conn.execute("DELETE FROM audio_tracks WHERE id = ?", (track_id,))
    (media_dir() / row["storage_name"]).unlink(missing_ok=True)


# ---------------------------------------------------------------- playlists


def _playlist_row(conn, pid: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM playlists WHERE id = ?", (pid,)).fetchone()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Playlist not found.")
    return row


def list_playlists(conn) -> list[dict]:
    out = []
    for r in conn.execute("SELECT * FROM playlists ORDER BY created_at, rowid"):
        agg = conn.execute(
            """SELECT COUNT(*) n, COALESCE(SUM(t.duration), 0) d FROM playlist_tracks e
               JOIN audio_tracks t ON t.id = e.track_id WHERE e.playlist_id = ?""",
            (r["id"],),
        ).fetchone()
        out.append(
            {
                "id": r["id"],
                "name": r["name"],
                "track_count": agg["n"],
                "total_duration": agg["d"],
                "updated_at": r["updated_at"],
            }  # fmt: skip
        )
    return out


def _entries_with_ids(conn, pid: str) -> list[dict]:
    rows = conn.execute(
        """SELECT e.id AS entry_id, t.* FROM playlist_tracks e
           JOIN audio_tracks t ON t.id = e.track_id WHERE e.playlist_id = ?
           ORDER BY e.position, e.rowid""",
        (pid,),
    ).fetchall()
    return [{"entry_id": r["entry_id"], "track": track_dict(r)} for r in rows]


def playlist_detail(conn, pid: str) -> dict:
    p = _playlist_row(conn, pid)
    return {"id": p["id"], "name": p["name"], "entries": _entries_with_ids(conn, pid)}


def create_playlist(conn, name: str) -> dict:
    ts, pid = now(), new_id()
    with tx(conn):
        conn.execute("INSERT INTO playlists VALUES (?,?,?,?)", (pid, name, ts, ts))
    return playlist_detail(conn, pid)


def rename_playlist(conn, pid: str, name: str) -> dict:
    with tx(conn):
        _playlist_row(conn, pid)
        conn.execute("UPDATE playlists SET name=?, updated_at=? WHERE id=?", (name, now(), pid))
    return playlist_detail(conn, pid)


def delete_playlist(conn, pid: str) -> None:
    """Removes the playlist only. The audio files stay in the library."""
    with tx(conn):
        _playlist_row(conn, pid)
        conn.execute("DELETE FROM playlists WHERE id = ?", (pid,))


def add_to_playlist(conn, pid: str, track_id: str) -> dict:
    with tx(conn):
        _playlist_row(conn, pid)
        _track_row(conn, track_id)
        pos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?",
            (pid,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO playlist_tracks VALUES (?,?,?,?)", (new_id(), pid, track_id, pos)
        )  # duplicates are allowed on purpose
        conn.execute("UPDATE playlists SET updated_at=? WHERE id=?", (now(), pid))
    return playlist_detail(conn, pid)


def remove_entry(conn, pid: str, entry_id: str) -> dict:
    with tx(conn):
        _playlist_row(conn, pid)
        cur = conn.execute(
            "DELETE FROM playlist_tracks WHERE id=? AND playlist_id=?", (entry_id, pid)
        )
        if cur.rowcount == 0:
            raise ApiError(404, "NOT_FOUND", "That entry is not in this playlist.")
        for i, r in enumerate(
            conn.execute(
                "SELECT id FROM playlist_tracks WHERE playlist_id=? ORDER BY position, rowid",
                (pid,),
            ).fetchall()
        ):
            conn.execute("UPDATE playlist_tracks SET position=? WHERE id=?", (i, r["id"]))
    return playlist_detail(conn, pid)


def reorder_playlist(conn, pid: str, entry_ids: list[str]) -> dict:
    with tx(conn):
        _playlist_row(conn, pid)
        have = [
            r["id"]
            for r in conn.execute("SELECT id FROM playlist_tracks WHERE playlist_id=?", (pid,))
        ]
        if sorted(have) != sorted(entry_ids):
            raise ApiError(
                422,
                "BAD_ORDER",
                "The new order must list every entry of the playlist exactly once.",
            )
        for i, eid in enumerate(entry_ids):
            conn.execute("UPDATE playlist_tracks SET position=? WHERE id=?", (i, eid))
        conn.execute("UPDATE playlists SET updated_at=? WHERE id=?", (now(), pid))
    return playlist_detail(conn, pid)


# ---------------------------------------------------------------- playback state & song links


def _exists(conn, table: str, id_: str | None) -> bool:
    return (
        id_ is None
        or conn.execute(f"SELECT 1 FROM {table} WHERE id=?", (id_,)).fetchone() is not None
    )


def get_state(conn) -> dict:
    r = conn.execute("SELECT * FROM playback_state WHERE id = 1").fetchone()
    if r is None:
        return {"track_id": None, "playlist_id": None, "position_seconds": 0, "repeat_mode": "off",
                "shuffle_enabled": False, "volume": 1.0, "speed": 1.0}  # fmt: skip
    d = {k: r[k] for k in r.keys() if k not in ("id", "updated_at")}  # noqa: SIM118
    d["shuffle_enabled"] = bool(d["shuffle_enabled"])
    return d


def put_state(conn, s: PlaybackStateIn) -> dict:
    with tx(conn):
        if not _exists(conn, "audio_tracks", s.track_id) or not _exists(
            conn, "playlists", s.playlist_id
        ):
            raise ApiError(422, "NOT_FOUND", "That track or playlist no longer exists.")
        conn.execute(
            """INSERT INTO playback_state VALUES (1,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET track_id=excluded.track_id,
               playlist_id=excluded.playlist_id, position_seconds=excluded.position_seconds,
               repeat_mode=excluded.repeat_mode, shuffle_enabled=excluded.shuffle_enabled,
               volume=excluded.volume, speed=excluded.speed, updated_at=excluded.updated_at""",
            (s.track_id, s.playlist_id, s.position_seconds, s.repeat_mode,
             1 if s.shuffle_enabled else 0, s.volume, s.speed, now()),
        )  # fmt: skip
    return get_state(conn)


def get_link(conn, song_id: str) -> dict | None:
    _song_row(conn, song_id)
    r = conn.execute("SELECT * FROM song_audio_links WHERE song_id = ?", (song_id,)).fetchone()
    if r is None:
        return None
    return {
        k: r[k]
        for k in ("track_id", "playlist_id", "loop_a", "loop_b", "position_seconds", "speed")
    }


def put_link(conn, song_id: str, data: SongAudioLinkIn) -> dict | None:
    if data.track_id and data.playlist_id:
        raise ApiError(422, "INVALID", "Link a track or a playlist, not both.")
    if data.loop_a is not None and data.loop_b is not None and data.loop_a >= data.loop_b:
        raise ApiError(422, "BAD_LOOP", "Loop start (A) must be before loop end (B).")
    with tx(conn):
        _song_row(conn, song_id)
        if not _exists(conn, "audio_tracks", data.track_id) or not _exists(
            conn, "playlists", data.playlist_id
        ):
            raise ApiError(422, "NOT_FOUND", "That track or playlist no longer exists.")
        if data.track_id is None and data.playlist_id is None:
            conn.execute("DELETE FROM song_audio_links WHERE song_id = ?", (song_id,))
        else:
            conn.execute(
                """INSERT INTO song_audio_links VALUES (?,?,?,?,?,?,?,?)
                   ON CONFLICT(song_id) DO UPDATE SET track_id=excluded.track_id,
                   playlist_id=excluded.playlist_id, loop_a=excluded.loop_a, loop_b=excluded.loop_b,
                   position_seconds=excluded.position_seconds, speed=excluded.speed,
                   updated_at=excluded.updated_at""",
                (song_id, data.track_id, data.playlist_id, data.loop_a, data.loop_b,
                 data.position_seconds, data.speed, now()),
            )  # fmt: skip
    return get_link(conn, song_id)
