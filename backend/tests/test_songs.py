import pytest

from app import db
from tests.conftest import make_song, save


def test_migrations_apply_once(db_file):
    conn = db.connect(db_file)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == len(db.MIGRATIONS)
    assert db.migrate(conn) == len(db.MIGRATIONS)  # idempotent
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"songs", "sections", "lines", "line_comments", "revisions", "song_genres"} <= names


def test_create_list_get(client):
    song = make_song(client, bpm=82, time_signature="4/4", template="verse-chorus")
    assert [s["label"] for s in song["sections"]] == ["Verse 1", "Chorus", "Verse 2", "Bridge"]
    assert all(len(s["lines"]) == 4 for s in song["sections"])
    assert song["genres"] == ["r&b"] and song["bpm"] == 82
    listing = client.get("/api/songs").json()
    assert [s["title"] for s in listing] == ["Rain on Glass"]
    assert client.get(f"/api/songs/{song['id']}").json()["id"] == song["id"]


@pytest.mark.parametrize(
    "body",
    [
        {"title": ""},
        {"title": "x", "genres": ["country"]},
        {"title": "x", "bpm": 5},
        {"title": "x", "time_signature": "four-four"},
        {"title": "x" * 201},
    ],
)
def test_create_validation(client, body):
    assert client.post("/api/songs", json=body).status_code == 422


def test_patch_metadata_and_genres(client):
    song = make_song(client)
    r = client.patch(
        f"/api/songs/{song['id']}",
        json={"title": "New", "genres": ["hip-hop", "r&b", "hip-hop"], "bpm": 90},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "New" and body["genres"] == ["hip-hop", "r&b"] and body["bpm"] == 90
    assert client.patch(f"/api/songs/{song['id']}", json={"title": "  "}).status_code == 422
    assert client.patch(f"/api/songs/{song['id']}", json={"genres": ["opera"]}).status_code == 422


def test_soft_delete_and_undelete(client):
    song = make_song(client)
    assert client.delete(f"/api/songs/{song['id']}").status_code == 204
    assert client.get("/api/songs").json() == []
    assert client.get(f"/api/songs/{song['id']}").status_code == 404
    assert [s["id"] for s in client.get("/api/songs?trash=true").json()] == [song["id"]]
    assert client.post(f"/api/songs/{song['id']}/undelete").status_code == 200
    assert len(client.get("/api/songs").json()) == 1


def test_missing_song_is_404(client):
    assert client.get("/api/songs/nope").status_code == 404


def test_content_roundtrip_keeps_ids_and_order(client):
    song = make_song(client, template="verse-chorus")

    def edit(p):
        p["sections"][0]["lines"][0]["text"] = "first line"
        p["sections"][0]["lines"].append({"id": "newline0001", "text": "added"})
        p["sections"].reverse()

    r = save(client, song, edit)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["version"] == song["version"] + 1
    assert [s["label"] for s in out["sections"]] == ["Bridge", "Verse 2", "Chorus", "Verse 1"]
    verse1 = out["sections"][-1]
    assert verse1["lines"][0]["id"] == song["sections"][0]["lines"][0]["id"]
    assert verse1["lines"][0]["text"] == "first line"
    assert verse1["lines"][-1] == {
        "id": "newline0001", "text": "added", "is_locked": False, "comments": []
    }  # fmt: skip


def test_removed_lines_and_sections_are_deleted(client):
    song = make_song(client, template="verse-chorus")

    def edit(p):
        del p["sections"][1:]
        del p["sections"][0]["lines"][1:]

    out = save(client, song, edit).json()
    assert len(out["sections"]) == 1 and len(out["sections"][0]["lines"]) == 1


def test_version_conflict(client):
    song = make_song(client)
    assert save(client, song).status_code == 200
    stale = save(client, song)  # same base_version again
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "VERSION_CONFLICT"


def test_content_validation(client):
    song = make_song(client)

    def newline(p):
        p["sections"][0]["lines"][0]["text"] = "a\nb"

    def dup(p):
        p["sections"][0]["lines"].append(dict(p["sections"][0]["lines"][0]))

    def toolong(p):
        p["sections"][0]["lines"][0]["text"] = "x" * 501

    def badid(p):
        p["sections"][0]["lines"][0]["id"] = "../etc"

    for fn in (newline, dup, toolong, badid):
        assert save(client, song, fn).status_code == 422


def test_cannot_use_another_songs_ids(client):
    a, b = make_song(client), make_song(client, title="B")

    def steal(p):
        p["sections"][0]["lines"].append({"id": a["sections"][0]["lines"][0]["id"], "text": "x"})

    assert save(client, b, steal).status_code == 422


def test_first_requests_on_a_new_database_do_not_race(db_file):
    """Regression: two requests at once on a fresh database used to crash (HTTP 500)."""
    from concurrent.futures import ThreadPoolExecutor

    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)

    def hit(i):
        return client.get("/api/songs" + ("?trash=true" if i % 2 else "")).status_code

    with ThreadPoolExecutor(8) as pool:
        assert list(pool.map(hit, range(16))) == [200] * 16


def test_concurrent_connect_migrates_once(tmp_path):
    from concurrent.futures import ThreadPoolExecutor

    path = str(tmp_path / "race.db")

    def version(_):
        return db.connect(path).execute("PRAGMA user_version").fetchone()[0]

    with ThreadPoolExecutor(8) as pool:
        assert set(pool.map(version, range(16))) == {len(db.MIGRATIONS)}
