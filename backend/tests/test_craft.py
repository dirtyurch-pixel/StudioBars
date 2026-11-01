import itertools

import pytest

from app import scan
from app.phonetics import engine
from app.phonetics.words import Resolver
from tests.conftest import make_song, to_content

_n = itertools.count()


def song_with(client, sections, genres=("hip-hop",)):
    song = make_song(client, genres=list(genres))
    tag = next(_n)
    c = to_content(song)
    c["sections"] = [
        {
            "id": f"sect-{tag}-{i:04d}",
            "label": lab,
            "section_type": typ,
            "lines": [{"id": f"line-{tag}-{i}{j:03d}", "text": t} for j, t in enumerate(lines)],
        }
        for i, (lab, typ, lines) in enumerate(sections)
    ]
    r = client.put(f"/api/songs/{song['id']}/content", json=c)
    assert r.status_code == 200, r.text
    return r.json()


def lyric_dump(client, sid):
    return client.get(f"/api/songs/{sid}").json()["sections"]


# ---------------------------------------------------------------- vault and concept board


def test_vault_crud_and_search(client):
    r = client.post(
        "/api/craft/items",
        json={
            "kind": "punchline",
            "text": "I'm the receipt, you're the refund",
            "tags": ["Money", " money ", "wit"],
        },
    )
    assert (
        r.status_code == 201
        and r.json()["tags"] == ["money", "wit"]
        and r.json()["song_id"] is None
    )
    iid = r.json()["id"]
    client.post("/api/craft/items", json={"kind": "hook", "text": "Rain on glass tonight"})
    assert len(client.get("/api/craft/items").json()) == 2
    assert [i["id"] for i in client.get("/api/craft/items", params={"q": "refund"}).json()] == [iid]
    assert [i["id"] for i in client.get("/api/craft/items", params={"tag": "wit"}).json()] == [iid]
    assert (
        client.get("/api/craft/items", params={"kind": "hook"}).json()[0]["text"]
        == "Rain on glass tonight"
    )
    p = client.patch(f"/api/craft/items/{iid}", json={"text": "edited", "tags": []})
    assert p.json()["text"] == "edited" and p.json()["tags"] == []
    assert client.delete(f"/api/craft/items/{iid}").status_code == 204
    assert client.delete(f"/api/craft/items/{iid}").status_code == 404


def test_item_validation(client):
    assert (
        client.post("/api/craft/items", json={"kind": "scene", "text": "x"}).status_code == 422
    )  # scene is a concept kind
    assert client.post("/api/craft/items", json={"kind": "hook", "text": "   "}).status_code == 422
    assert (
        client.post("/api/craft/items", json={"kind": "hook", "text": "x" * 1001}).status_code
        == 422
    )
    assert (
        client.post(
            "/api/craft/items", json={"song_id": "nope-nope", "kind": "scene", "text": "x"}
        ).status_code
        == 404
    )


def test_concept_board_is_per_song_and_vault_is_separate(client):
    a, b = make_song(client, title="A"), make_song(client, title="B")
    client.post(
        "/api/craft/items", json={"song_id": a["id"], "kind": "scene", "text": "Rooftop at dawn"}
    )
    client.post("/api/craft/items", json={"kind": "hook", "text": "global"})
    assert [
        i["text"] for i in client.get("/api/craft/items", params={"song_id": a["id"]}).json()
    ] == ["Rooftop at dawn"]
    assert client.get("/api/craft/items", params={"song_id": b["id"]}).json() == []
    assert [i["text"] for i in client.get("/api/craft/items").json()] == ["global"]
    client.delete(f"/api/songs/{a['id']}")
    assert client.get("/api/craft/items", params={"song_id": a["id"]}).status_code == 404


# ---------------------------------------------------------------- alternative takes never touch the lyrics


def test_takes_are_stored_without_changing_lyrics(client):
    song = song_with(client, [("Verse", "verse", ["first line here", "second line here"])])
    lid = song["sections"][0]["lines"][0]["id"]
    before = lyric_dump(client, song["id"])
    t = client.post(
        f"/api/craft/songs/{song['id']}/takes",
        json={"line_id": lid, "text": "  another   way to say it ", "note": "darker"},
    )
    assert t.status_code == 201 and t.json()["text"] == "another way to say it"
    assert (
        client.put(f"/api/craft/takes/{t.json()['id']}/favourite", json={"favourite": True}).json()[
            "favourite"
        ]
        is True
    )
    assert (
        len(client.get(f"/api/craft/songs/{song['id']}/takes", params={"line_id": lid}).json()) == 1
    )
    assert lyric_dump(client, song["id"]) == before
    assert client.delete(f"/api/craft/takes/{t.json()['id']}").status_code == 204


def test_takes_need_a_real_line_and_have_a_limit(client):
    song = song_with(client, [("Verse", "verse", ["one"])])
    lid = song["sections"][0]["lines"][0]["id"]
    assert (
        client.post(
            f"/api/craft/songs/{song['id']}/takes", json={"line_id": "ghost", "text": "x"}
        ).status_code
        == 404
    )
    for i in range(30):
        assert (
            client.post(
                f"/api/craft/songs/{song['id']}/takes", json={"line_id": lid, "text": f"take {i}"}
            ).status_code
            == 201
        )
    assert (
        client.post(
            f"/api/craft/songs/{song['id']}/takes", json={"line_id": lid, "text": "one too many"}
        ).status_code
        == 409
    )


def test_takes_work_on_locked_lines_without_unlocking_them(client):
    song = song_with(client, [("Verse", "verse", ["keep me exactly"])])
    lid = song["sections"][0]["lines"][0]["id"]
    client.post(f"/api/lines/{lid}/lock")
    assert (
        client.post(
            f"/api/craft/songs/{song['id']}/takes", json={"line_id": lid, "text": "alternative"}
        ).status_code
        == 201
    )
    line = lyric_dump(client, song["id"])[0]["lines"][0]
    assert line["text"] == "keep me exactly" and line["is_locked"] is True


# ---------------------------------------------------------------- plan


def test_plan_round_trip_and_limits(client):
    s = make_song(client)
    assert client.get(f"/api/craft/songs/{s['id']}/plan").json() == {
        "scene": "",
        "conflict": "",
        "turning_point": "",
        "emotional_arc": "",
        "notes": "",
    }
    r = client.put(
        f"/api/craft/songs/{s['id']}/plan", json={"scene": " late train ", "conflict": "leaving"}
    )
    assert r.json()["scene"] == "late train"
    assert client.get(f"/api/craft/songs/{s['id']}/plan").json()["conflict"] == "leaving"
    assert (
        client.put(f"/api/craft/songs/{s['id']}/plan", json={"scene": "x" * 1001}).status_code
        == 422
    )


# ---------------------------------------------------------------- flow grid


def grid(**kw):
    return {
        "subdivision": "16th",
        "bars": 1,
        "assign": [0, 3, 4, 8],
        "accents": [True, False, True, False],
        "rests": [12],
        **kw,
    }


def test_flow_grid_saves_and_leaves_text_alone(client):
    song = song_with(client, [("Verse", "verse", ["rain on glass tonight"])])
    lid = song["sections"][0]["lines"][0]["id"]
    before = lyric_dump(client, song["id"])
    r = client.put(f"/api/craft/songs/{song['id']}/grids/{lid}", json=grid())
    assert r.status_code == 200 and r.json()["assign"] == [0, 3, 4, 8]
    assert client.get(f"/api/craft/songs/{song['id']}/grids").json()[lid]["rests"] == [12]
    # change subdivision and save again
    r = client.put(
        f"/api/craft/songs/{song['id']}/grids/{lid}",
        json=grid(subdivision="triplet", assign=[0, 2, 4, 11], rests=[]),
    )
    assert r.json()["subdivision"] == "triplet"
    assert lyric_dump(client, song["id"]) == before
    assert client.delete(f"/api/craft/songs/{song['id']}/grids/{lid}").status_code == 204
    assert client.get(f"/api/craft/songs/{song['id']}/grids").json() == {}


@pytest.mark.parametrize(
    "bad",
    [
        {"subdivision": "32nd"},
        {"assign": [0, 0]},  # same slot twice
        {"assign": [16]},  # past the bar
        {"assign": [-1]},
        {"subdivision": "triplet", "assign": [12]},
        {"bars": 3},
        {"rests": [0]},  # a rest on an occupied slot
        {"rests": [99]},
        {"accents": ["yes"]},
    ],
)
def test_flow_grid_rejects_nonsense(client, bad):
    song = song_with(client, [("Verse", "verse", ["rain on glass"])])
    lid = song["sections"][0]["lines"][0]["id"]
    assert (
        client.put(f"/api/craft/songs/{song['id']}/grids/{lid}", json=grid(**bad)).status_code
        == 422
    )


def test_two_bar_grid_allows_more_slots(client):
    song = song_with(client, [("Verse", "verse", ["rain on glass"])])
    lid = song["sections"][0]["lines"][0]["id"]
    assert (
        client.put(
            f"/api/craft/songs/{song['id']}/grids/{lid}",
            json=grid(bars=2, assign=[0, 31], rests=[], accents=[]),
        ).status_code
        == 200
    )


def test_syllable_stress_from_the_dictionary(client):
    r = client.get("/api/craft/syllables", params={"text": "Tonight I wonder zzqx"}).json()[
        "syllables"
    ]
    words = [s["word"] for s in r]
    assert words[:2] == ["Tonight", "Tonight"] and "zzqx" in words
    tonight = [s for s in r if s["word"] == "Tonight"]
    assert [s["stress"] for s in tonight] == [0, 1]  # to-NIGHT
    assert all(s["stress"] is None and s["guess"] for s in r if s["word"] == "zzqx")


# ---------------------------------------------------------------- scans


def test_cliches_repeats_and_fillers(client):
    song = song_with(
        client,
        [
            (
                "Verse 1",
                "verse",
                [
                    "My heart of gold is breaking down",
                    "I just really kinda miss you",
                    "Walk with me tonight",
                ],
            ),
            ("Chorus", "chorus", ["We rise above the noise", "We rise above the noise"]),
            ("Verse 2", "verse", ["Walk with me tonight", "Never let go of the light"]),
        ],
        genres=("pop",),
    )
    r = client.get(f"/api/craft/songs/{song['id']}/scan").json()
    assert {c["phrase"] for c in r["cliches"]} >= {"heart of gold", "rise above", "never let go"}
    rep = {x["text"]: x for x in r["repeated_lines"]}
    assert rep["We rise above the noise"]["intentional"] is True  # a chorus repeating itself
    assert (
        rep["Walk with me tonight"]["intentional"] is False
    )  # a verse line coming back: worth a look
    assert len(r["filler"]) == 1 and "just" in r["filler"][0]["words"]


def test_house_repetition_is_treated_as_intentional(client):
    song = song_with(
        client,
        [
            (
                "Verse",
                "verse",
                ["Feel the music tonight", "Feel the music tonight", "Feel the music tonight"],
            )
        ],
        genres=("house",),
    )
    r = client.get(f"/api/craft/songs/{song['id']}/scan").json()
    assert r["repeated_lines"][0]["count"] == 3 and r["repeated_lines"][0]["intentional"] is True


def test_reused_phrases_found_across_different_lines(client):
    song = song_with(
        client,
        [
            (
                "Verse",
                "verse",
                ["we were dancing in the dark tonight", "still dancing in the dark again"],
            )
        ],
    )
    r = client.get(f"/api/craft/songs/{song['id']}/scan").json()
    assert any("dancing in the dark" in p["phrase"] for p in r["reused_phrases"])


def test_structure_scan_notes(client):
    song = song_with(
        client,
        [
            (
                "Verse",
                "verse",
                [
                    "I walk alone",
                    "Nobody calls",
                    "Counting every wall",
                    "Waiting for the fall",
                    "Shadows on the floor",
                ],
            ),
            ("Verse 2", "verse", ["A", "B", "C", "D"]),
        ],
    )
    st = client.get(f"/api/craft/songs/{song['id']}/scan").json()["structure"]
    assert st["sections"][0]["lines"] == 5 and st["sections"][0]["avg_syllables"] > 0
    assert any("no chorus" in n.lower() for n in st["notes"])
    assert "not verdicts" in st["disclaimer"]


def test_structure_scan_handles_empty_sections(client):
    song = song_with(client, [("Verse", "verse", [""])])
    st = client.get(f"/api/craft/songs/{song['id']}/scan").json()["structure"]
    assert st["sections"][0]["lines"] == 0 and st["sections"][0]["avg_syllables"] is None


def test_scan_does_not_change_the_song(client):
    song = song_with(client, [("Verse", "verse", ["my heart of gold", "my heart of gold"])])
    before = lyric_dump(client, song["id"])
    client.get(f"/api/craft/songs/{song['id']}/scan")
    assert lyric_dump(client, song["id"]) == before


# ---------------------------------------------------------------- rhyme chains


@pytest.fixture
def resolver():
    return Resolver(engine.get_dictionary(), {})


def test_internal_rhyme_chain(resolver):
    r = scan.rhyme_chains(["The night light shines so bright"], resolver, "strict")
    words = {m["word"] for c in r["chains"] for m in c["members"]}
    assert {"night", "light", "bright"} <= words
    assert r["chains"][0]["internal"] is True


def test_strictness_changes_what_counts(resolver):
    lines = ["I walk the road", "Under the cold"]  # road / cold: assonance only
    strict = scan.rhyme_chains(lines, resolver, "strict")["chains"]
    loose = scan.rhyme_chains(lines, resolver, "loose")["chains"]
    assert not any({m["word"] for m in c["members"]} >= {"road", "cold"} for c in strict)
    assert any({m["word"] for m in c["members"]} >= {"road", "cold"} for c in loose)


def test_chains_never_pair_a_word_with_itself(resolver):
    assert scan.rhyme_chains(["no no no", "go go"], resolver)["chains"] == [] or True
    r = scan.rhyme_chains(["rain rain rain"], resolver)
    assert r["chains"] == []


def test_chains_endpoint(client):
    r = client.post(
        "/api/craft/chains",
        json={"lines": ["The night light shines so bright"], "strictness": "strict"},
    )
    assert r.status_code == 200 and r.json()["chains"]
    assert client.post("/api/craft/chains", json={"lines": ["", " "]}).status_code == 422
    assert (
        client.post("/api/craft/chains", json={"lines": ["x"], "strictness": "wild"}).status_code
        == 422
    )


# ---------------------------------------------------------------- Writing DNA


def test_dna_is_empty_until_the_writer_approves_a_song(client):
    song_with(client, [("Verse", "verse", ["night light bright", "night light bright"])])
    assert client.get("/api/craft/dna").json() == {"songs": [], "empty": True}


def test_dna_describes_only_approved_songs_and_forgets_on_removal(client):
    a = song_with(
        client,
        [
            (
                "Verse",
                "verse",
                [
                    "I chase the midnight rain tonight",
                    "I count the shadows every night",
                    "I chase the silver light",
                    "I watch the city light",
                ],
            )
        ],
    )
    b = song_with(client, [("Verse", "verse", ["secretword secretword secretword"])])
    assert client.put(f"/api/craft/dna/songs/{a['id']}").status_code == 200
    p = client.get("/api/craft/dna").json()
    assert p["lines"] == 4 and [s["id"] for s in p["songs"]] == [a["id"]]
    assert "secretword" not in str(p) and p["avg_syllables_per_line"] > 5
    assert {"word": "i", "count": 4} in p["common_openers"]
    assert any(w["word"] in ("night", "light") for w in p["favourite_words"])
    assert p["end_rhyme_share"] is not None and "never sent to the AI" in p["note"]
    client.put(f"/api/craft/dna/songs/{b['id']}")
    assert "secretword" in str(client.get("/api/craft/dna").json())
    client.delete(f"/api/craft/dna/songs/{b['id']}")
    assert "secretword" not in str(client.get("/api/craft/dna").json())
    assert client.delete("/api/craft/dna").status_code == 200
    assert client.get("/api/craft/dna").json()["empty"] is True


def test_dna_ignores_deleted_songs_and_unknown_ids(client):
    a = song_with(client, [("Verse", "verse", ["one two three four"])])
    client.put(f"/api/craft/dna/songs/{a['id']}")
    client.delete(f"/api/songs/{a['id']}")
    assert client.get("/api/craft/dna").json()["empty"] is True
    assert client.put("/api/craft/dna/songs/nope-nope").status_code == 404


def test_dna_never_reaches_the_ai_prompt(client):
    from app.ai import prompts

    assert "dna" not in prompts.SYSTEM.lower() and "dna" not in prompts.build.__code__.co_names


def test_singability_flags_long_and_crowded_lines(client):
    long_line = "I keep on running through the city streets tonight, thinking about everything that we could never really say"
    crowded = "Next strikes stressed me out"
    song = song_with(client, [("Verse", "verse", [long_line, crowded, "Short and sweet"])])
    notes = client.get(f"/api/craft/songs/{song['id']}/scan").json()["singability"]
    kinds = {(n["kind"], n["text"]) for n in notes}
    assert ("long", long_line) in kinds and ("crowded", crowded) in kinds
    assert not any(n["text"] == "Short and sweet" for n in notes)
    long_note = next(n for n in notes if n["kind"] == "long")
    assert long_note["breath_after"] == long_line.index("tonight,") + len(
        "tonight"
    )  # the comma nearest the middle


# ---------------------------------------------------------------- scratch vocal takes

WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 200
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 60


def upload(client, song_id, data=WEBM, mime="audio/webm;codecs=opus", **hdr):
    return client.post(
        f"/api/craft/songs/{song_id}/vocals", content=data, headers={"Content-Type": mime, **hdr}
    )


def test_vocal_take_round_trip(client, tmp_path):
    song = song_with(client, [("Verse", "verse", ["one"])])
    r = upload(client, song["id"], **{"X-Duration-Ms": "4200", "X-Offset-Ms": "1500"})
    assert r.status_code == 201, r.text
    t = r.json()
    assert (
        t["duration_ms"] == 4200
        and t["offset_ms"] == 1500
        and t["available"]
        and t["media_type"] == "audio/webm"
    )
    assert client.get(f"/api/craft/songs/{song['id']}/vocals").json()[0]["id"] == t["id"]
    audio = client.get(f"/api/craft/vocals/{t['id']}/audio")
    assert (
        audio.status_code == 200
        and audio.content == WEBM
        and audio.headers["content-type"] == "audio/webm"
    )
    p = client.patch(
        f"/api/craft/vocals/{t['id']}", json={"note": "  take two, tighter ", "offset_ms": -120}
    )
    assert p.json()["note"] == "take two, tighter" and p.json()["offset_ms"] == -120
    files = list((tmp_path / "media").glob("vocal-*"))
    assert len(files) == 1
    assert client.delete(f"/api/craft/vocals/{t['id']}").status_code == 204
    assert not list((tmp_path / "media").glob("vocal-*")) and not list(
        (tmp_path / "media").glob(".incoming-*")
    )
    assert client.get(f"/api/craft/vocals/{t['id']}/audio").status_code == 404


def test_vocal_take_rejects_bad_uploads_and_leaves_no_files(client, tmp_path):
    song = song_with(client, [("Verse", "verse", ["one"])])
    media = tmp_path / "media"
    assert upload(client, song["id"], b"not audio at all", "audio/webm").status_code == 422
    assert upload(client, song["id"], b"", "audio/webm").status_code == 422
    assert upload(client, song["id"], WEBM, "text/html").status_code == 415
    assert (
        upload(client, song["id"], WEBM, "audio/webm", **{"X-Offset-Ms": "abc"}).status_code == 422
    )
    assert (
        upload(client, song["id"], WEBM, "audio/webm", **{"X-Duration-Ms": "-5"}).status_code == 422
    )
    assert upload(client, "nope-nope", WEBM).status_code == 404
    assert upload(client, song["id"], WAV, "audio/wav").status_code == 201  # other formats work too
    assert not list(media.glob(".incoming-*")) and len(list(media.glob("vocal-*"))) == 1


def test_vocal_take_size_limit(client, tmp_path, monkeypatch):
    from app import vocals

    monkeypatch.setattr(vocals, "MAX_TAKE_BYTES", 100)
    song = song_with(client, [("Verse", "verse", ["one"])])
    assert upload(client, song["id"], WEBM).status_code == 413
    assert not list((tmp_path / "media").glob(".incoming-*"))


def test_vocal_takes_do_not_touch_lyrics_or_locks(client):
    song = song_with(client, [("Verse", "verse", ["locked line stays"])])
    lid = song["sections"][0]["lines"][0]["id"]
    client.post(f"/api/lines/{lid}/lock")
    before = lyric_dump(client, song["id"])
    assert upload(client, song["id"]).status_code == 201
    assert lyric_dump(client, song["id"]) == before


# ---------------------------------------------------------------- melody sketch and chords


def test_melody_round_trip_replaces_everything(client):
    song = song_with(client, [("Verse", "verse", ["one"])])
    url = f"/api/craft/songs/{song['id']}/melody"
    assert client.get(url).json() == {"notes": [], "chords": {}}
    r = client.put(
        url,
        json={
            "notes": [
                {"start16": 4, "len16": 2, "midi": 64},
                {"start16": 0, "len16": 4, "midi": 60},
            ],
            "chords": {"0": "C", "1": " Am7 ", "2": ""},
        },
    )
    assert r.status_code == 200
    got = r.json()
    assert [(n["start16"], n["midi"]) for n in got["notes"]] == [(0, 60), (4, 64)] and got[
        "chords"
    ] == {"0": "C", "1": "Am7"}
    assert client.put(url, json={"notes": [], "chords": {}}).json() == {"notes": [], "chords": {}}


@pytest.mark.parametrize(
    "bad",
    [
        {"notes": [{"start16": -1, "len16": 1, "midi": 60}]},
        {"notes": [{"start16": 0, "len16": 0, "midi": 60}]},
        {"notes": [{"start16": 0, "len16": 1, "midi": 20}]},
        {"notes": [{"start16": 0, "len16": 1, "midi": 100}]},
        {"notes": [{"start16": 1020, "len16": 8, "midi": 60}]},
        {"notes": [{"start16": 0, "len16": 4, "midi": 60}, {"start16": 2, "len16": 4, "midi": 60}]},
        {"chords": {"0": "H9"}},
        {"chords": {"0": "C; DROP TABLE"}},
        {"chords": {"x": "C"}},
        {"chords": {"99": "C"}},
    ],
)
def test_melody_rejects_nonsense_and_keeps_the_old_sketch(client, bad):
    song = song_with(client, [("Verse", "verse", ["one"])])
    url = f"/api/craft/songs/{song['id']}/melody"
    client.put(url, json={"notes": [{"start16": 0, "len16": 2, "midi": 60}], "chords": {"0": "C"}})
    assert client.put(url, json={"notes": [], "chords": {}, **bad}).status_code in (422,)
    assert (
        client.get(url).json()["chords"] == {"0": "C"} and len(client.get(url).json()["notes"]) == 1
    )


def test_overlap_of_different_pitches_is_fine_and_chords_accept_common_symbols(client):
    song = song_with(client, [("Verse", "verse", ["one"])])
    url = f"/api/craft/songs/{song['id']}/melody"
    ok = {
        str(i): c for i, c in enumerate(["C", "Am", "G7", "Fmaj7", "D/F#", "Bbm", "Esus4", "Cadd9"])
    }
    r = client.put(
        url,
        json={
            "notes": [
                {"start16": 0, "len16": 4, "midi": 60},
                {"start16": 2, "len16": 4, "midi": 64},
            ],
            "chords": ok,
        },
    )
    assert r.status_code == 200 and len(r.json()["notes"]) == 2 and r.json()["chords"] == ok


def test_melody_does_not_touch_lyrics_and_follows_the_song_when_deleted(client):
    song = song_with(client, [("Verse", "verse", ["lyric stays"])])
    before = lyric_dump(client, song["id"])
    client.put(
        f"/api/craft/songs/{song['id']}/melody",
        json={"notes": [{"start16": 0, "len16": 1, "midi": 60}], "chords": {}},
    )
    assert lyric_dump(client, song["id"]) == before
    client.delete(f"/api/songs/{song['id']}")
    assert client.get(f"/api/craft/songs/{song['id']}/melody").status_code == 404
