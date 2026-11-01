from app import textio
from tests.conftest import make_song, save


def comparable(song):
    return {
        "title": song["title"],
        "genres": song["genres"],
        "bpm": song["bpm"],
        "time_signature": song["time_signature"],
        "sections": [
            (
                s["label"],
                s["section_type"],
                [
                    (ln["text"], ln["is_locked"], [c["body"] for c in ln["comments"]])
                    for ln in s["lines"]
                ],
            )
            for s in song["sections"]
        ],
    }


def build(client):
    song = make_song(
        client, bpm=82, time_signature="4/4", template="verse-chorus", genres=["r&b", "pop"]
    )
    texts = {"line a", "line b", "", "line d"}

    def fill(p):
        for sec in p["sections"]:
            for ln, t in zip(sec["lines"], ["line a", "line b", "", "line d"], strict=True):
                ln["text"] = f"{sec['label']}: {t}" if t else ""

    song = save(client, song, fill).json()
    assert texts
    lock_id = song["sections"][1]["lines"][0]["id"]
    client.post(f"/api/lines/{lock_id}/lock")
    client.post(
        f"/api/lines/{song['sections'][0]['lines'][1]['id']}/comments", json={"body": "hmm"}
    )
    return client.get(f"/api/songs/{song['id']}").json()


def test_json_roundtrip_is_lossless(client):
    song = build(client)
    exported = client.get(f"/api/songs/{song['id']}/export?format=json")
    assert exported.status_code == 200 and "attachment" in exported.headers["content-disposition"]
    r = client.post("/api/import", json={"format": "json", "content": exported.text})
    assert r.status_code == 201, r.text
    imported = r.json()
    assert imported["id"] != song["id"]
    assert comparable(imported) == comparable(song)
    # the original is untouched
    assert comparable(client.get(f"/api/songs/{song['id']}").json()) == comparable(song)


def test_txt_roundtrip_keeps_text_and_labels(client):
    song = build(client)
    txt = client.get(f"/api/songs/{song['id']}/export?format=txt").text
    assert txt.startswith("[Verse 1]\n")
    imported = client.post(
        "/api/import", json={"format": "txt", "content": txt, "title": "T"}
    ).json()
    want = [(s["label"], [ln["text"] for ln in s["lines"] if ln["text"]]) for s in song["sections"]]
    got = [
        (s["label"], [ln["text"] for ln in s["lines"] if ln["text"]]) for s in imported["sections"]
    ]
    assert got == want


def test_md_roundtrip_keeps_title_and_text(client):
    song = build(client)
    md = client.get(f"/api/songs/{song['id']}/export?format=md").text
    assert md.startswith("# Rain on Glass")
    imported = client.post("/api/import", json={"format": "md", "content": md}).json()
    assert imported["title"] == "Rain on Glass"
    want = [[ln["text"] for ln in s["lines"] if ln["text"]] for s in song["sections"]]
    got = [[ln["text"] for ln in s["lines"] if ln["text"]] for s in imported["sections"]]
    assert got == want


def test_preview_writes_nothing(client):
    body = {"format": "txt", "content": "[Verse]\nhello\nworld\n\n[Chorus]\nla la"}
    p = client.post("/api/import/preview", json=body).json()
    assert p["line_count"] == 3 and [s["label"] for s in p["sections"]] == ["Verse", "Chorus"]
    assert p["sections"][0]["section_type"] == "verse"
    assert client.get("/api/songs").json() == []


def test_import_never_overwrites_existing_song(client):
    song = build(client)
    client.post("/api/import", json={"format": "txt", "content": "[Verse]\nnew"})
    assert comparable(client.get(f"/api/songs/{song['id']}").json()) == comparable(song)
    assert len(client.get("/api/songs").json()) == 2


def test_import_locked_lines_stay_locked(client):
    song = build(client)
    js = client.get(f"/api/songs/{song['id']}/export?format=json").text
    imp = client.post("/api/import", json={"format": "json", "content": js}).json()
    locked = [ln for s in imp["sections"] for ln in s["lines"] if ln["is_locked"]]
    assert len(locked) == 1
    r = save(client, imp, lambda p: p["sections"][1]["lines"][0].update(text="x"))
    assert r.status_code == 423


def test_parse_header_styles():
    s = textio.parse_text("Verse 1:\na\nb\n\nPre-Chorus:\nc\n\n[Bridge]\nd", "txt")
    assert [(x.label, x.section_type) for x in s.sections] == [
        ("Verse 1", "verse"), ("Pre-Chorus", "pre-chorus"), ("Bridge", "bridge")
    ]  # fmt: skip


def test_parse_without_headers_splits_on_blank_lines():
    s = textio.parse_text("a\nb\n\nc\nd\n\n\ne", "txt")
    assert [[ln.text for ln in x.lines] for x in s.sections] == [["a", "b"], ["c", "d"], ["e"]]
    assert s.warnings


def test_parse_handles_crlf_and_bom():
    s = textio.parse_text("﻿[Verse]\r\nhello\r\nworld\r\n", "txt")
    assert [ln.text for ln in s.sections[0].lines] == ["hello", "world"]


def test_unicode_and_emoji_survive(client):
    content = "[Verse]\nCafé niño 🎤\nナイト"
    imp = client.post("/api/import", json={"format": "txt", "content": content}).json()
    assert [ln["text"] for ln in imp["sections"][0]["lines"]] == ["Café niño 🎤", "ナイト"]


def test_import_errors_are_clear(client):
    for body in (
        {"format": "json", "content": "not json"},
        {"format": "json", "content": '{"hello": 1}'},
        {"format": "txt", "content": "   \n\n  "},
        {"format": "txt", "content": "[V]\n" + "x" * 501},
    ):
        r = client.post("/api/import/preview", json=body)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "IMPORT_FAILED", body
    assert client.get("/api/songs").json() == []


def test_import_too_large_rejected(client):
    r = client.post("/api/import", json={"format": "txt", "content": "a" * 1_000_001})
    assert r.status_code == 422


def test_unknown_export_format(client):
    song = make_song(client)
    assert client.get(f"/api/songs/{song['id']}/export?format=pdf").status_code == 422
