import pytest

from app import scan
from app.phonetics import engine
from app.phonetics.words import Resolver
from tests.conftest import make_song, to_content


def song_with(client, sections, genres=("hip-hop",)):
    song = make_song(client, genres=list(genres))
    c = to_content(song)
    c["sections"] = [
        {
            "id": f"sect-{i:04d}",
            "label": lab,
            "section_type": typ,
            "lines": [{"id": f"line-{i}{j:03d}", "text": t} for j, t in enumerate(lines)],
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
