import sqlite3

import pytest

from app import db
from tests.conftest import make_song, save


def write_and_lock(client, texts=("alpha", "beta", "gamma", "delta")):
    song = make_song(client, template="verse-chorus")

    def fill(p):
        for ln, t in zip(p["sections"][0]["lines"], texts, strict=True):
            ln["text"] = t

    song = save(client, song, fill).json()
    return song, song["sections"][0]["lines"]


def lock(client, line_id):
    r = client.post(f"/api/lines/{line_id}/lock")
    assert r.status_code == 200
    return r.json()


def test_locked_line_text_cannot_change(client):
    song, lines = write_and_lock(client)
    song = lock(client, lines[1]["id"])
    r = save(client, song, lambda p: p["sections"][0]["lines"][1].update(text="HACKED"))
    assert r.status_code == 423
    assert r.json()["detail"]["line_ids"] == [lines[1]["id"]]
    got = client.get(f"/api/songs/{song['id']}").json()
    assert got["sections"][0]["lines"][1]["text"] == "beta"
    assert got["version"] == song["version"]  # nothing was written


def test_locked_line_cannot_be_removed_or_section_deleted(client):
    song, lines = write_and_lock(client)
    song = lock(client, lines[0]["id"])
    assert save(client, song, lambda p: p["sections"][0]["lines"].pop(0)).status_code == 423
    assert save(client, song, lambda p: p["sections"].pop(0)).status_code == 423


def test_other_lines_can_still_change_and_locked_line_can_move(client):
    song, lines = write_and_lock(client)
    song = lock(client, lines[0]["id"])

    def edit(p):
        sec = p["sections"][0]["lines"]
        sec[1]["text"] = "changed"
        sec.append(sec.pop(0))  # move the locked line to the end

    out = save(client, song, edit)
    assert out.status_code == 200, out.text
    texts = [ln["text"] for ln in out.json()["sections"][0]["lines"]]
    assert texts == ["changed", "gamma", "delta", "alpha"]
    assert out.json()["sections"][0]["lines"][-1]["is_locked"] is True


def test_unlock_then_edit(client):
    song, lines = write_and_lock(client)
    song = lock(client, lines[0]["id"])
    song = client.post(f"/api/lines/{lines[0]['id']}/unlock").json()
    out = save(client, song, lambda p: p["sections"][0]["lines"][0].update(text="free"))
    assert out.status_code == 200
    assert out.json()["sections"][0]["lines"][0]["text"] == "free"


def test_content_save_cannot_change_lock_state(client):
    song, lines = write_and_lock(client)
    song = lock(client, lines[0]["id"])
    out = save(client, song).json()  # a normal save keeps the lock
    assert out["sections"][0]["lines"][0]["is_locked"] is True


def test_database_triggers_block_raw_sql(db_file, client):
    song, lines = write_and_lock(client)
    lock(client, lines[0]["id"])
    conn = db.connect(db_file)
    with pytest.raises(sqlite3.IntegrityError, match="LOCKED_LINE_CANNOT_BE_EDITED"):
        conn.execute("UPDATE lines SET text = 'x' WHERE id = ?", (lines[0]["id"],))
    with pytest.raises(sqlite3.IntegrityError, match="LOCKED_LINE_CANNOT_BE_DELETED"):
        conn.execute("DELETE FROM lines WHERE id = ?", (lines[0]["id"],))
    # Cascading deletes are blocked too (section, then song).
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("DELETE FROM sections WHERE id = ?", (song["sections"][0]["id"],))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("DELETE FROM songs WHERE id = ?", (song["id"],))
    # Unlocked lines remain editable.
    conn.execute("UPDATE lines SET text = 'ok' WHERE id = ?", (lines[1]["id"],))


def test_soft_deleted_song_keeps_locked_lines(client):
    song, lines = write_and_lock(client)
    lock(client, lines[0]["id"])
    client.delete(f"/api/songs/{song['id']}")
    back = client.post(f"/api/songs/{song['id']}/undelete").json()
    assert back["sections"][0]["lines"][0]["text"] == "alpha"
    assert back["sections"][0]["lines"][0]["is_locked"] is True


def test_lock_unknown_line_404(client):
    assert client.post("/api/lines/doesnotexist/lock").status_code == 404
