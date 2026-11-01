"""SQLite connection handling and versioned migrations."""

import os
import sqlite3
import threading
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "private" / "studio_bars.db"

# Each entry is one schema version. Never edit an applied entry; append a new one.
MIGRATIONS: list[str] = [
    """
    CREATE TABLE songs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        concept TEXT NOT NULL DEFAULT '',
        mood TEXT NOT NULL DEFAULT '',
        point_of_view TEXT NOT NULL DEFAULT '',
        bpm INTEGER,
        time_signature TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE TABLE song_genres (
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        genre TEXT NOT NULL CHECK (genre IN ('hip-hop','r&b','house','pop')),
        PRIMARY KEY (song_id, genre)
    );
    CREATE TABLE sections (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        section_type TEXT NOT NULL,
        position INTEGER NOT NULL
    );
    CREATE INDEX idx_sections_song ON sections(song_id, position);
    CREATE TABLE lines (
        id TEXT PRIMARY KEY,
        section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_lines_section ON lines(section_id, position);
    CREATE TABLE line_comments (
        id TEXT PRIMARY KEY,
        line_id TEXT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_comments_line ON line_comments(line_id);
    CREATE TABLE revisions (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('auto','manual','pre-restore')),
        description TEXT NOT NULL DEFAULT '',
        snapshot_json TEXT NOT NULL
    );
    CREATE INDEX idx_revisions_song ON revisions(song_id, created_at);

    -- Backstop for the lock rule: a locked line's text can never change and a
    -- locked line can never be deleted, whatever code path tries it.
    CREATE TRIGGER lines_locked_no_edit
    BEFORE UPDATE OF text ON lines
    WHEN OLD.is_locked = 1 AND NEW.text <> OLD.text
    BEGIN
        SELECT RAISE(ABORT, 'LOCKED_LINE_CANNOT_BE_EDITED');
    END;
    CREATE TRIGGER lines_locked_no_delete
    BEFORE DELETE ON lines
    WHEN OLD.is_locked = 1
    BEGIN
        SELECT RAISE(ABORT, 'LOCKED_LINE_CANNOT_BE_DELETED');
    END;
    """,
    # Version 2: music library, playlists, playback state, song <-> audio links.
    """
    CREATE TABLE audio_tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        album TEXT NOT NULL DEFAULT '',
        duration REAL,
        media_type TEXT NOT NULL,
        ext TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        storage_name TEXT NOT NULL,
        added_at TEXT NOT NULL
    );
    CREATE TABLE playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE playlist_tracks (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL REFERENCES audio_tracks(id) ON DELETE CASCADE,
        position INTEGER NOT NULL
    );
    CREATE INDEX idx_playlist_tracks ON playlist_tracks(playlist_id, position);
    CREATE TABLE playback_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        track_id TEXT REFERENCES audio_tracks(id) ON DELETE SET NULL,
        playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
        position_seconds REAL NOT NULL DEFAULT 0,
        repeat_mode TEXT NOT NULL DEFAULT 'off' CHECK (repeat_mode IN ('off','all','one')),
        shuffle_enabled INTEGER NOT NULL DEFAULT 0,
        volume REAL NOT NULL DEFAULT 1,
        speed REAL NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE song_audio_links (
        song_id TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
        track_id TEXT REFERENCES audio_tracks(id) ON DELETE SET NULL,
        playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
        loop_a REAL,
        loop_b REAL,
        position_seconds REAL NOT NULL DEFAULT 0,
        speed REAL NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
    );
    """,
]


def db_path() -> str:
    return os.environ.get("STUDIO_BARS_DB", str(DEFAULT_DB))


def migrate(conn: sqlite3.Connection) -> int:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for version, script in enumerate(MIGRATIONS, start=1):
        if version <= current:
            continue
        conn.executescript(f"BEGIN;\n{script}\nPRAGMA user_version = {version};\nCOMMIT;")
    return conn.execute("PRAGMA user_version").fetchone()[0]


_migrate_lock = threading.Lock()
_migrated: set[str] = set()


def connect(path: str | None = None) -> sqlite3.Connection:
    path = path or db_path()
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # Migrate once per database file, one thread at a time. Without this, two
    # requests arriving together on a brand-new database both try to create
    # the tables and one of them fails.
    if path == ":memory:" or path not in _migrated or not Path(path).exists():
        with _migrate_lock:
            if path != ":memory:":
                conn.execute("PRAGMA journal_mode = WAL")  # persistent; set once, under the lock
            migrate(conn)
            _migrated.add(path)
    return conn


class tx:  # noqa: N801 - used like a context manager keyword
    """BEGIN IMMEDIATE ... COMMIT, rolling back on any error."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def __enter__(self) -> sqlite3.Connection:
        self.conn.execute("BEGIN IMMEDIATE")
        return self.conn

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc_type is None:
            self.conn.execute("COMMIT")
        else:
            self.conn.execute("ROLLBACK")
        return False
