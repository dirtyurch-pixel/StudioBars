"""Melody sketchpad and chord marks. A SKETCH: notes on a 16th-note grid (4/4), plus a chord symbol per bar.

Nothing here claims to be a transcription of a performance or a finished arrangement. It never touches lyrics.
"""

from __future__ import annotations

import re

from .db import tx
from .service import ApiError, new_id

MAX_NOTES = 600
MAX_BARS = 64
MIDI_LOW, MIDI_HIGH = 36, 96  # C2 .. C7
CHORD = re.compile(
    r"^[A-G][#b]?(?:maj|min|m|dim|aug|sus[24]?|add\d{1,2}|\d{1,2}|\+|°|ø|-)*(?:/[A-G][#b]?)?$"
)


def _song_ok(conn, song_id: str) -> None:
    if (
        conn.execute("SELECT 1 FROM songs WHERE id=? AND deleted_at IS NULL", (song_id,)).fetchone()
        is None
    ):
        raise ApiError(404, "NOT_FOUND", "Song not found.")


def get(conn, song_id: str) -> dict:
    _song_ok(conn, song_id)
    notes = [{"id": r["id"], "start16": r["start16"], "len16": r["len16"], "midi": r["midi"]} for r in conn.execute("SELECT * FROM melody_notes WHERE song_id=? ORDER BY start16, midi", (song_id,))]  # fmt: skip
    chords = {
        str(r["bar"]): r["symbol"]
        for r in conn.execute(
            "SELECT bar, symbol FROM chord_marks WHERE song_id=? ORDER BY bar", (song_id,)
        )
    }
    return {"notes": notes, "chords": chords}


def put(conn, song_id: str, notes: list[dict], chords: dict[str, str]) -> dict:
    _song_ok(conn, song_id)
    if len(notes) > MAX_NOTES:
        raise ApiError(422, "TOO_MANY", f"A sketch can have at most {MAX_NOTES} notes.")
    clean_notes = []
    occupied: dict[
        int, int
    ] = {}  # 16th slot -> midi, to refuse overlapping notes of the same pitch
    for n in notes:
        s16, ln, midi = n["start16"], n["len16"], n["midi"]
        if not 0 <= s16 < MAX_BARS * 16 or not 1 <= ln <= 64 or s16 + ln > MAX_BARS * 16:
            raise ApiError(
                422,
                "BAD_NOTE",
                "A note must sit inside the first 64 bars and last 1 to 64 sixteenths.",
            )
        if not MIDI_LOW <= midi <= MIDI_HIGH:
            raise ApiError(422, "BAD_NOTE", "Pitch must be between C2 and C7.")
        for t in range(s16, s16 + ln):
            if occupied.get((t << 8) | midi) is not None:
                raise ApiError(422, "BAD_NOTE", "Two notes of the same pitch overlap.")
            occupied[(t << 8) | midi] = 1
        clean_notes.append((new_id(), song_id, s16, ln, midi))
    clean_chords = []
    for bar_s, sym in chords.items():
        try:
            bar = int(bar_s)
        except ValueError:
            raise ApiError(422, "BAD_CHORD", "Bar numbers must be whole numbers.") from None
        sym = sym.strip()
        if not 0 <= bar < MAX_BARS:
            raise ApiError(422, "BAD_CHORD", f"Bars run from 1 to {MAX_BARS}.")
        if sym == "":
            continue
        if len(sym) > 12 or not CHORD.match(sym):
            raise ApiError(
                422,
                "BAD_CHORD",
                f"“{sym}” is not a chord symbol I understand (try C, Am, G7, Fmaj7, D/F#).",
            )
        clean_chords.append((song_id, bar, sym))
    with tx(conn):
        conn.execute("DELETE FROM melody_notes WHERE song_id=?", (song_id,))
        conn.execute("DELETE FROM chord_marks WHERE song_id=?", (song_id,))
        conn.executemany("INSERT INTO melody_notes VALUES (?,?,?,?,?)", clean_notes)
        conn.executemany("INSERT INTO chord_marks VALUES (?,?,?)", clean_chords)
    return get(conn, song_id)
