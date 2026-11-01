from tests.conftest import make_song, save


def filled(client):
    song = make_song(client, template="verse-chorus")

    def fill(p):
        for i, ln in enumerate(p["sections"][0]["lines"]):
            ln["text"] = f"line {i}"

    return save(client, song, fill).json()


def snap(client, song, desc="s"):
    r = client.post(f"/api/songs/{song['id']}/revisions", json={"description": desc})
    assert r.status_code == 201
    return r.json()[0]["id"]


def test_snapshot_and_restore(client):
    song = filled(client)
    rid = snap(client, song, "before")
    song = save(client, song, lambda p: p["sections"][0]["lines"][0].update(text="CHANGED")).json()
    song = save(client, song, lambda p: p["sections"].pop()).json()
    assert len(song["sections"]) == 3

    restored = client.post(f"/api/revisions/{rid}/restore")
    assert restored.status_code == 200, restored.text
    out = restored.json()
    assert out["sections"][0]["lines"][0]["text"] == "line 0"
    assert [s["label"] for s in out["sections"]] == ["Verse 1", "Chorus", "Verse 2", "Bridge"]
    kinds = [r["kind"] for r in client.get(f"/api/songs/{song['id']}/revisions").json()]
    assert "pre-restore" in kinds  # restore is itself undoable


def test_restore_restores_metadata(client):
    song = filled(client)
    rid = snap(client, song)
    client.patch(f"/api/songs/{song['id']}", json={"title": "Other", "genres": ["house"]})
    out = client.post(f"/api/revisions/{rid}/restore").json()
    assert out["title"] == "Rain on Glass" and out["genres"] == ["r&b"]


def test_restore_blocked_if_it_would_change_locked_line(client):
    song = filled(client)
    first = song["sections"][0]["lines"][0]
    rid = snap(client, song)
    # change the line, then lock the new text: the old snapshot now conflicts
    song = save(client, song, lambda p: p["sections"][0]["lines"][0].update(text="NEW")).json()
    client.post(f"/api/lines/{first['id']}/lock")
    r = client.post(f"/api/revisions/{rid}/restore")
    assert r.status_code == 423
    assert r.json()["detail"]["line_ids"] == [first["id"]]
    now = client.get(f"/api/songs/{song['id']}").json()
    assert now["sections"][0]["lines"][0]["text"] == "NEW"


def test_restore_keeps_locked_lines_when_unchanged(client):
    song = filled(client)
    locked = song["sections"][0]["lines"][1]
    client.post(f"/api/lines/{locked['id']}/lock")
    rid = snap(client, song)
    song = client.get(f"/api/songs/{song['id']}").json()
    save(client, song, lambda p: p["sections"][0]["lines"][0].update(text="edited"))
    out = client.post(f"/api/revisions/{rid}/restore").json()
    ln = out["sections"][0]["lines"][1]
    assert ln["id"] == locked["id"] and ln["is_locked"] and ln["text"] == "line 1"
    assert out["sections"][0]["lines"][0]["text"] == "line 0"


def test_auto_snapshot_created_when_none_recent(client):
    song = filled(client)  # first save creates an automatic snapshot
    revs = client.get(f"/api/songs/{song['id']}/revisions").json()
    assert [r["kind"] for r in revs] == ["auto"]
    save(client, client.get(f"/api/songs/{song['id']}").json())
    assert len(client.get(f"/api/songs/{song['id']}/revisions").json()) == 1  # throttled


def test_auto_snapshot_interval_zero(client, monkeypatch):
    monkeypatch.setenv("STUDIO_BARS_AUTO_SNAPSHOT_SECONDS", "0")
    song = filled(client)
    save(client, client.get(f"/api/songs/{song['id']}").json())
    assert len(client.get(f"/api/songs/{song['id']}/revisions").json()) == 2


def test_comments_crud_and_locked_lines(client):
    song = filled(client)
    line = song["sections"][0]["lines"][0]
    client.post(f"/api/lines/{line['id']}/lock")
    r = client.post(f"/api/lines/{line['id']}/comments", json={"body": "make it punchier"})
    assert r.status_code == 201
    c = r.json()["sections"][0]["lines"][0]["comments"][0]
    assert c["body"] == "make it punchier"
    edited = client.patch(f"/api/comments/{c['id']}", json={"body": "ok"}).json()
    assert edited["sections"][0]["lines"][0]["comments"][0]["body"] == "ok"
    assert client.post(f"/api/lines/{line['id']}/comments", json={"body": "  "}).status_code == 422
    gone = client.delete(f"/api/comments/{c['id']}").json()
    assert gone["sections"][0]["lines"][0]["comments"] == []
    assert gone["sections"][0]["lines"][0]["text"] == "line 0"  # lyric untouched


def test_comments_survive_reorder_and_autosave(client):
    song = filled(client)
    line = song["sections"][0]["lines"][2]
    client.post(f"/api/lines/{line['id']}/comments", json={"body": "note"})
    song = client.get(f"/api/songs/{song['id']}").json()

    def reorder(p):
        p["sections"].reverse()
        p["sections"][-1]["lines"].reverse()

    out = save(client, song, reorder).json()
    moved = [ln for s in out["sections"] for ln in s["lines"] if ln["id"] == line["id"]][0]
    assert [c["body"] for c in moved["comments"]] == ["note"]


def test_comments_survive_revision_restore(client):
    song = filled(client)
    line = song["sections"][0]["lines"][3]
    client.post(f"/api/lines/{line['id']}/comments", json={"body": "keep me"})
    song = client.get(f"/api/songs/{song['id']}").json()
    rid = snap(client, song)
    # delete the line (and its comment), then restore
    song = save(client, song, lambda p: p["sections"][0]["lines"].pop()).json()
    out = client.post(f"/api/revisions/{rid}/restore").json()
    back = out["sections"][0]["lines"][3]
    assert back["id"] == line["id"] and [c["body"] for c in back["comments"]] == ["keep me"]


def test_comment_on_missing_line_404(client):
    assert client.post("/api/lines/nope/comments", json={"body": "x"}).status_code == 404
