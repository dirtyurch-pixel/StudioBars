import io
import struct
import wave
from urllib.parse import quote

import pytest

from tests.conftest import make_song


def wav_bytes(seconds=1.0, rate=8000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(
            b"".join(struct.pack("<h", (i % 100) * 100) for i in range(int(seconds * rate)))
        )
    return buf.getvalue()


MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" * 64
FLAC = b"fLaC" + b"\x00" * 64
OGG = b"OggS" + b"\x00" * 64
M4A = b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 64


def upload(client, name, data, duration=None, path="/api/music/tracks"):
    headers = {"X-Filename": quote(name)}
    if duration is not None:
        headers["X-Duration"] = str(duration)
    return client.post(path, content=data, headers=headers)


def add(client, name="track.wav", data=None):
    r = upload(client, name, data or wav_bytes(), duration=1.0)
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------- import rules


def test_import_each_supported_format(client):
    for name, data in [("a.wav", wav_bytes()), ("b.mp3", MP3), ("c.flac", FLAC), ("d.ogg", OGG),
                       ("e.opus", OGG), ("f.m4a", M4A)]:  # fmt: skip
        r = upload(client, name, data)
        assert r.status_code == 201, (name, r.text)
    assert len(client.get("/api/music/tracks").json()) == 6


def test_track_metadata_and_no_paths_exposed(client):
    t = add(client, "My Song (demo).WAV")
    assert t["title"] == "My Song (demo)" and t["ext"] == "wav" and t["duration"] == 1.0
    assert t["available"] is True and t["media_type"] == "audio/wav"
    blob = str(client.get("/api/music/tracks").json())
    assert "storage" not in blob and "/" not in t["title"] and "data/media" not in blob


@pytest.mark.parametrize(
    "name,data,code",
    [
        ("notes.txt", b"hello", "UNSUPPORTED_FORMAT"),
        ("virus.exe", b"MZ", "UNSUPPORTED_FORMAT"),
        ("noext", b"abc", "UNSUPPORTED_FORMAT"),
        ("fake.mp3", b"this is not audio at all", "NOT_AUDIO"),
        ("fake.wav", b"RIFF1234NOPE", "NOT_AUDIO"),
        ("renamed.flac", wav_bytes(), "NOT_AUDIO"),
        ("empty.wav", b"", "EMPTY_FILE"),
    ],
)
def test_bad_files_are_refused_with_a_clear_reason(client, name, data, code):
    r = upload(client, name, data)
    assert r.status_code in (415, 422) and r.json()["detail"]["code"] == code
    assert client.get("/api/music/tracks").json() == []


def test_failed_import_leaves_no_files_behind(client, tmp_path):
    upload(client, "fake.mp3", b"nope nope nope")
    upload(client, "empty.wav", b"")
    media = tmp_path / "media"
    assert [p.name for p in media.iterdir()] == []


def test_oversize_refused(client, monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIO_BARS_MAX_AUDIO_MB", "0.001")  # ~1 KB
    r = upload(client, "big.wav", wav_bytes(1.0))
    assert r.status_code == 413 and r.json()["detail"]["code"] == "TOO_LARGE"
    media = tmp_path / "media"
    assert not media.exists() or list(media.iterdir()) == []


def test_filename_cannot_escape_the_media_folder(client, tmp_path):
    for evil in ["../../etc/passwd.wav", "..\\..\\evil.wav", "/abs/path.wav", "a\x00b.wav"]:
        r = upload(client, evil, wav_bytes())
        assert r.status_code == 201, (evil, r.text)
        assert "/" not in r.json()["title"] and "\\" not in r.json()["title"]
    names = {p.name for p in (tmp_path / "media").iterdir()}
    assert all(n.endswith(".wav") and len(n) == 36 for n in names), names
    assert not (tmp_path / "evil.wav").exists()


def test_duplicate_content_is_flagged_but_allowed(client):
    a = add(client, "one.wav")
    b = upload(client, "two.wav", wav_bytes()).json()
    assert b["duplicate_of"] == a["id"] and b["id"] != a["id"]
    assert upload(client, "one.wav", wav_bytes(0.5)).json()["duplicate_of"] is None


def test_bad_duration_header_is_ignored(client):
    r = upload(client, "x.wav", wav_bytes(), duration="banana")
    assert r.status_code == 201 and r.json()["duration"] is None


# ------------------------------------------------------------- streaming


def test_audio_streams_with_range_support(client):
    data = wav_bytes(1.0)
    t = add(client, "s.wav", data)
    full = client.get(f"/api/music/tracks/{t['id']}/audio")
    assert full.status_code == 200 and full.content == data
    assert full.headers["content-type"].startswith("audio/wav")
    assert full.headers["accept-ranges"] == "bytes"
    part = client.get(f"/api/music/tracks/{t['id']}/audio", headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and part.content == data[100:200]
    assert part.headers["content-range"] == f"bytes 100-199/{len(data)}"


def test_unknown_track_404(client):
    assert client.get("/api/music/tracks/nope/audio").status_code == 404


def test_missing_file_is_reported_and_can_be_relinked(client, tmp_path):
    t = add(client, "lost.wav")
    pl = client.post("/api/music/playlists", json={"name": "Mine"}).json()
    client.post(f"/api/music/playlists/{pl['id']}/tracks", json={"track_id": t["id"]})
    for f in (tmp_path / "media").iterdir():
        f.unlink()
    listing = client.get("/api/music/tracks").json()
    assert listing[0]["available"] is False and listing[0]["title"] == "lost"
    gone = client.get(f"/api/music/tracks/{t['id']}/audio")
    assert gone.status_code == 404 and gone.json()["detail"]["code"] == "FILE_MISSING"
    # relink with a fresh copy; playlist metadata is untouched
    r = upload(
        client,
        "lost-again.wav",
        wav_bytes(2.0),
        duration=2.0,
        path=f"/api/music/tracks/{t['id']}/relink",
    )
    assert r.status_code == 200 and r.json()["available"] is True and r.json()["title"] == "lost"
    assert client.get(f"/api/music/tracks/{t['id']}/audio").status_code == 200
    pl2 = client.get(f"/api/music/playlists/{pl['id']}").json()
    assert [e["track"]["id"] for e in pl2["entries"]] == [t["id"]]


def test_relink_rejects_bad_file_and_keeps_old(client):
    t = add(client)
    r = upload(client, "bad.wav", b"junk junk", path=f"/api/music/tracks/{t['id']}/relink")
    assert r.status_code == 415
    assert client.get(f"/api/music/tracks/{t['id']}/audio").status_code == 200
    assert (
        upload(client, "x.wav", wav_bytes(), path="/api/music/tracks/nope/relink").status_code
        == 404
    )


def test_edit_and_delete_track(client, tmp_path):
    t = add(client)
    r = client.patch(f"/api/music/tracks/{t['id']}", json={"title": " New name ", "artist": "Me"})
    assert r.json()["title"] == "New name" and r.json()["artist"] == "Me"
    assert client.patch(f"/api/music/tracks/{t['id']}", json={"title": "  "}).status_code == 422
    assert client.delete(f"/api/music/tracks/{t['id']}").status_code == 204
    assert client.get("/api/music/tracks").json() == []
    assert list((tmp_path / "media").iterdir()) == []


# ------------------------------------------------------------- playlists


def pl_ids(client, pid):
    return [e["track"]["id"] for e in client.get(f"/api/music/playlists/{pid}").json()["entries"]]


def test_playlist_crud_duplicates_and_reorder(client):
    a, b, c = (add(client, f"{n}.wav", wav_bytes(0.1 * (i + 1))) for i, n in enumerate("abc"))
    pl = client.post("/api/music/playlists", json={"name": "Writing night"}).json()
    pid = pl["id"]
    for t in (a, b, c, a):  # the same track twice is allowed on purpose
        assert (
            client.post(
                f"/api/music/playlists/{pid}/tracks", json={"track_id": t["id"]}
            ).status_code
            == 201
        )
    assert pl_ids(client, pid) == [a["id"], b["id"], c["id"], a["id"]]
    entries = client.get(f"/api/music/playlists/{pid}").json()["entries"]
    assert len({e["entry_id"] for e in entries}) == 4
    new = [
        entries[3]["entry_id"],
        entries[2]["entry_id"],
        entries[0]["entry_id"],
        entries[1]["entry_id"],
    ]
    out = client.put(f"/api/music/playlists/{pid}/order", json={"entry_ids": new}).json()
    assert [e["entry_id"] for e in out["entries"]] == new
    assert (
        client.put(f"/api/music/playlists/{pid}/order", json={"entry_ids": new[:3]}).status_code
        == 422
    )
    assert (
        client.put(
            f"/api/music/playlists/{pid}/order", json={"entry_ids": new[:3] + [new[0]]}
        ).status_code
        == 422
    )
    out = client.delete(f"/api/music/playlists/{pid}/tracks/{new[0]}").json()
    assert len(out["entries"]) == 3
    assert client.delete(f"/api/music/playlists/{pid}/tracks/{new[0]}").status_code == 404
    assert (
        client.patch(f"/api/music/playlists/{pid}", json={"name": "Renamed"}).json()["name"]
        == "Renamed"
    )
    summary = client.get("/api/music/playlists").json()[0]
    assert (
        summary["track_count"] == 3 and summary["total_duration"] == 3.0
    )  # three tracks of 1 s each


def test_deleting_playlist_keeps_audio(client, tmp_path):
    t = add(client)
    pid = client.post("/api/music/playlists", json={"name": "x"}).json()["id"]
    client.post(f"/api/music/playlists/{pid}/tracks", json={"track_id": t["id"]})
    assert client.delete(f"/api/music/playlists/{pid}").status_code == 204
    assert client.get("/api/music/playlists").json() == []
    assert len(client.get("/api/music/tracks").json()) == 1
    assert len(list((tmp_path / "media").iterdir())) == 1


def test_deleting_track_removes_it_from_playlists(client):
    t, u = add(client, "t.wav"), add(client, "u.wav", wav_bytes(0.2))
    pid = client.post("/api/music/playlists", json={"name": "x"}).json()["id"]
    for x in (t, u):
        client.post(f"/api/music/playlists/{pid}/tracks", json={"track_id": x["id"]})
    client.delete(f"/api/music/tracks/{t['id']}")
    assert pl_ids(client, pid) == [u["id"]]


def test_playlist_validation(client):
    assert client.post("/api/music/playlists", json={"name": "  "}).status_code == 422
    pid = client.post("/api/music/playlists", json={"name": "x"}).json()["id"]
    assert (
        client.post(f"/api/music/playlists/{pid}/tracks", json={"track_id": "nope"}).status_code
        == 404
    )
    assert (
        client.post("/api/music/playlists/nope/tracks", json={"track_id": "x"}).status_code == 404
    )
    assert client.get("/api/music/playlists/nope").status_code == 404


# ------------------------------------------------------------- state & song links


def test_playback_state_roundtrip_and_validation(client):
    assert client.get("/api/music/state").json()["repeat_mode"] == "off"
    t = add(client)
    body = {"track_id": t["id"], "playlist_id": None, "position_seconds": 12.5, "repeat_mode": "all",
            "shuffle_enabled": True, "volume": 0.4, "speed": 0.85}  # fmt: skip
    assert client.put("/api/music/state", json=body).status_code == 200
    assert client.get("/api/music/state").json() == body
    for bad in ({"repeat_mode": "forever"}, {"volume": 2}, {"speed": 5}, {"position_seconds": -1}):
        assert client.put("/api/music/state", json={**body, **bad}).status_code == 422
    assert client.put("/api/music/state", json={**body, "track_id": "ghost"}).status_code == 422
    client.delete(f"/api/music/tracks/{t['id']}")
    assert client.get("/api/music/state").json()["track_id"] is None  # cleared, not dangling


def test_song_link_roundtrip_and_rules(client):
    song = make_song(client)
    sid = song["id"]
    assert client.get(f"/api/songs/{sid}/audio-link").json() is None
    t = add(client)
    body = {
        "track_id": t["id"],
        "loop_a": 2.0,
        "loop_b": 5.5,
        "position_seconds": 3.0,
        "speed": 0.85,
    }
    r = client.put(f"/api/songs/{sid}/audio-link", json=body)
    assert r.status_code == 200
    assert client.get(f"/api/songs/{sid}/audio-link").json() == {**body, "playlist_id": None}
    # A must be before B
    assert (
        client.put(
            f"/api/songs/{sid}/audio-link", json={**body, "loop_a": 6, "loop_b": 5}
        ).status_code
        == 422
    )
    assert (
        client.put(
            f"/api/songs/{sid}/audio-link", json={**body, "loop_a": 5, "loop_b": 5}
        ).status_code
        == 422
    )
    # a track OR a playlist
    pid = client.post("/api/music/playlists", json={"name": "x"}).json()["id"]
    assert (
        client.put(f"/api/songs/{sid}/audio-link", json={**body, "playlist_id": pid}).status_code
        == 422
    )
    assert client.put(f"/api/songs/{sid}/audio-link", json={"track_id": "ghost"}).status_code == 422
    # unlink
    assert client.put(f"/api/songs/{sid}/audio-link", json={}).json() is None
    assert client.get(f"/api/songs/{sid}/audio-link").json() is None
    assert client.get("/api/songs/nope/audio-link").status_code == 404


def test_link_survives_song_content_saves_and_track_deletion_clears_link(client):
    from tests.conftest import save

    song = make_song(client)
    t = add(client)
    client.put(
        f"/api/songs/{song['id']}/audio-link", json={"track_id": t["id"], "loop_a": 1, "loop_b": 2}
    )
    save(client, song)
    assert client.get(f"/api/songs/{song['id']}/audio-link").json()["track_id"] == t["id"]
    client.delete(f"/api/music/tracks/{t['id']}")
    link = client.get(f"/api/songs/{song['id']}/audio-link").json()
    assert link["track_id"] is None  # file gone; link kept so the UI can offer to relink or clear


def test_song_export_does_not_leak_audio_paths(client):
    song = make_song(client)
    t = add(client)
    client.put(f"/api/songs/{song['id']}/audio-link", json={"track_id": t["id"]})
    text = client.get(f"/api/songs/{song['id']}/export?format=json").text
    assert "storage" not in text and "media" not in text and t["id"] not in text


def test_chunked_oversize_is_refused_mid_stream(client, monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIO_BARS_MAX_AUDIO_MB", "0.001")
    data = wav_bytes(1.0)

    def gen():
        for i in range(0, len(data), 1000):
            yield data[i : i + 1000]

    r = client.post("/api/music/tracks", content=gen(), headers={"X-Filename": "big.wav"})
    assert r.status_code == 413
    assert [p for p in (tmp_path / "media").iterdir()] == []


# ------------------------------------------------------------- beat markers


def test_beats_save_read_clear(client):
    t = add(client)
    url = f"/api/music/tracks/{t['id']}/beats"
    assert client.get(url).json() == {"beats": None}
    r = client.put(url, json={"bpm": 92.456, "offset": 0.31234})
    assert r.status_code == 200 and r.json()["beats"] == {"bpm": 92.46, "offset": 0.312}
    assert client.get(url).json()["beats"] == {"bpm": 92.46, "offset": 0.312}
    client.put(url, json={"bpm": 120})
    assert client.get(url).json()["beats"] == {"bpm": 120.0, "offset": 0.0}
    assert client.delete(url).status_code == 204
    assert client.get(url).json() == {"beats": None}


def test_beats_rules(client):
    t = add(client)
    url = f"/api/music/tracks/{t['id']}/beats"
    for bad in [{"bpm": 20}, {"bpm": 300}, {"bpm": 90, "offset": -1}, {}]:
        assert client.put(url, json=bad).status_code == 422, bad
    assert client.get("/api/music/tracks/nope/beats").status_code == 404
    assert client.put("/api/music/tracks/nope/beats", json={"bpm": 90}).status_code == 404


def test_beats_go_when_track_is_deleted(client):
    t = add(client)
    client.put(f"/api/music/tracks/{t['id']}/beats", json={"bpm": 100})
    assert client.delete(f"/api/music/tracks/{t['id']}").status_code == 204
    t2 = add(client)
    assert client.get(f"/api/music/tracks/{t2['id']}/beats").json() == {"beats": None}
