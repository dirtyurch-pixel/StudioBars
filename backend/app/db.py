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
    # Version 3: the owner's own word pronunciations (one per word; replaces the dictionary).
    """
    CREATE TABLE custom_pronunciations (
        word TEXT PRIMARY KEY,
        phones TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """,
    # Version 4: app settings, cache for the optional online helper, personal phrase bank.
    """
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE online_cache (
        key TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        fetched_at TEXT NOT NULL
    );
    CREATE TABLE phrases (
        id TEXT PRIMARY KEY,
        phrase TEXT NOT NULL,
        phrase_key TEXT NOT NULL UNIQUE,
        meaning TEXT NOT NULL DEFAULT '',
        sounds_like TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE phrase_tags (
        phrase_id TEXT NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (phrase_id, tag)
    );
    CREATE INDEX idx_phrase_tags_tag ON phrase_tags(tag);
    """,
    # Version 5: AI co-writer. Usage log (for the monthly spending limit) and the suggestions the AI made.
    """
    CREATE TABLE ai_usage (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        month TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        task TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        ok INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX idx_ai_usage_month ON ai_usage(month);
    CREATE TABLE ai_suggestions (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        section_id TEXT,
        target_line_id TEXT,
        task TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        context_hash TEXT NOT NULL,
        text TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        accepted_at TEXT
    );
    CREATE INDEX idx_ai_suggestions_song ON ai_suggestions(song_id, created_at);
    """,
    # Version 6: Phase 5 craft tools. Vault (song_id NULL) and concept board (per song), alternative takes,
    # a per-song plan, and flow grids. None of these touch the lyric tables.
    """
    CREATE TABLE craft_items (
        id TEXT PRIMARY KEY,
        song_id TEXT REFERENCES songs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_craft_items_song ON craft_items(song_id, kind);
    CREATE TABLE alt_takes (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        line_id TEXT NOT NULL,
        text TEXT NOT NULL,
        favourite INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );
    CREATE INDEX idx_alt_takes_line ON alt_takes(song_id, line_id);
    CREATE TABLE song_plan (
        song_id TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
        plan_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
    );
    CREATE TABLE flow_grids (
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        line_id TEXT NOT NULL,
        grid_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (song_id, line_id)
    );
    """,
    # Version 7: songs the writer approved for their private "Writing DNA" profile (the profile itself is never stored).
    """
    CREATE TABLE dna_songs (
        song_id TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
        approved_at TEXT NOT NULL
    );
    """,
    # Version 8: scratch vocal takes (audio files live in the media folder; this table holds their details).
    """
    CREATE TABLE vocal_takes (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        storage_name TEXT NOT NULL,
        ext TEXT NOT NULL,
        media_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        offset_ms INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );
    CREATE INDEX idx_vocal_takes_song ON vocal_takes(song_id, created_at);
    """,
    # Version 9: melody sketch (notes on a 16th-note grid) and chord marks per bar. Never touches the lyric tables.
    """
    CREATE TABLE melody_notes (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        start16 INTEGER NOT NULL,
        len16 INTEGER NOT NULL,
        midi INTEGER NOT NULL
    );
    CREATE INDEX idx_melody_notes_song ON melody_notes(song_id, start16);
    CREATE TABLE chord_marks (
        song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        bar INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        PRIMARY KEY (song_id, bar)
    );
    """,
    # Version 10: tempo and beat-1 position per music track, for the beat markers on the waveform.
    """
    CREATE TABLE track_beats (
        track_id TEXT PRIMARY KEY REFERENCES audio_tracks(id) ON DELETE CASCADE,
        bpm REAL NOT NULL,
        offset REAL NOT NULL DEFAULT 0,
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
