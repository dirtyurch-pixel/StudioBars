import pytest


def add(client, phrase, **kw):
    r = client.post("/api/phrases", json={"phrase": phrase, **kw})
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------------ the phrase bank


def test_add_and_read_back(client):
    p = add(
        client,
        "Finna",
        meaning="about to; fixing to",
        sounds_like="finer",
        tags=["Slang", "south", "slang"],
    )
    assert (
        p["phrase"] == "Finna"
        and p["meaning"] == "about to; fixing to"
        and p["sounds_like"] == "finer"
    )
    assert p["tags"] == ["slang", "south"]  # tidied: lower case, no repeats
    assert p["pronunciation"]["known"] and p["pronunciation"]["syllables_min"] == 2
    got = client.get("/api/phrases").json()
    assert got["total"] == 1 and got["items"][0]["id"] == p["id"]


def test_a_phrase_is_stored_for_good(client, db_file):
    add(client, "on the come up", meaning="rising fast")
    from fastapi.testclient import TestClient

    from app.main import app

    assert TestClient(app).get("/api/phrases").json()["items"][0]["phrase"] == "on the come up"


def test_pronunciation_comes_from_the_words_or_from_sounds_like(client):
    a = add(client, "on the come up")["pronunciation"]
    assert a["known"] and a["syllables_min"] == 4 and a["ipa"]
    b = add(client, "zorblax", sounds_like="lax")["pronunciation"]
    assert b["known"] and b["syllables_min"] == 1
    c = add(client, "blorf nation")["pronunciation"]
    assert not c["known"] and c["unknown_words"] == ["blorf"] and c["guessed"]


def test_duplicates_are_refused_whatever_the_case_or_spacing(client):
    add(client, "Come Up")
    r = client.post("/api/phrases", json={"phrase": "  come   up "})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "DUPLICATE"


@pytest.mark.parametrize(
    "body",
    [
        {"phrase": ""},
        {"phrase": "   "},
        {"phrase": "x" * 121},
        {"phrase": "two\nlines"},
        {"phrase": "ok", "meaning": "m" * 501},
        {"phrase": "ok", "tags": [str(i) for i in range(11)]},
        {"phrase": "ok", "tags": ["t" * 31]},
        {"phrase": "ok", "sounds_like": "a\nb"},
    ],
)
def test_bad_phrases_are_refused(client, body):
    assert client.post("/api/phrases", json=body).status_code == 422


def test_edit_and_delete(client):
    p = add(client, "finna", tags=["slang"])
    r = client.patch(
        f"/api/phrases/{p['id']}", json={"meaning": "about to", "tags": ["south", "future"]}
    )
    assert (
        r.status_code == 200
        and r.json()["meaning"] == "about to"
        and r.json()["tags"] == ["future", "south"]
    )
    assert r.json()["phrase"] == "finna"  # untouched fields stay
    other = add(client, "gonna")
    clash = client.patch(f"/api/phrases/{other['id']}", json={"phrase": "FINNA"})
    assert clash.status_code == 409
    assert (
        client.patch(f"/api/phrases/{p['id']}", json={"phrase": "finna", "tags": []}).json()["tags"]
        == []
    )
    assert client.delete(f"/api/phrases/{p['id']}").status_code == 204
    assert client.delete(f"/api/phrases/{p['id']}").status_code == 404
    assert client.patch("/api/phrases/nope", json={"meaning": "x"}).status_code == 404
    assert client.get("/api/phrases").json()["total"] == 1


def test_search_finds_phrases_by_any_part(client):
    add(client, "on the come up", meaning="rising fast in the game", tags=["hustle"])
    add(client, "finna", meaning="about to", sounds_like="finer", tags=["slang", "south"])
    add(client, "100%", meaning="completely sure", tags=["slang"])
    s = lambda **p: [i["phrase"] for i in client.get("/api/phrases", params=p).json()["items"]]  # noqa: E731
    assert s(q="come") == ["on the come up"]
    assert s(q="GAME") == ["on the come up"]  # meaning, any case
    assert s(q="finer") == ["finna"]  # how it sounds
    assert s(q="hustle") == ["on the come up"]  # tag
    assert s(q="about fast") == []  # every word must match
    assert s(q="rising game") == ["on the come up"]
    assert s(tag="slang") == ["100%", "finna"]
    assert s(tag="slang", q="sure") == ["100%"]
    assert s(q="nothing like this") == []
    assert s(q="%") == ["100%"]  # a typed % is a plain character, not a wildcard
    assert s(q="_") == []
    assert s() == ["100%", "finna", "on the come up"]  # alphabetical


def test_search_cannot_be_used_to_run_sql(client):
    add(client, "safe")
    for q in ["'; DROP TABLE phrases; --", '" OR 1=1 --', "a%' OR '1'='1"]:
        assert client.get("/api/phrases", params={"q": q}).status_code == 200
    assert client.get("/api/phrases").json()["total"] == 1


def test_paging_and_limits(client):
    for i in range(7):
        add(client, f"phrase {i}")
    page = client.get("/api/phrases", params={"limit": 3, "offset": 3}).json()
    assert page["total"] == 7 and [i["phrase"] for i in page["items"]] == [
        "phrase 3",
        "phrase 4",
        "phrase 5",
    ]
    assert client.get("/api/phrases", params={"limit": 0}).status_code == 422
    assert client.get("/api/phrases", params={"limit": 501}).status_code == 422


def test_tag_counts_and_export(client):
    add(client, "a1", tags=["slang", "south"])
    add(client, "a2", tags=["slang"])
    assert client.get("/api/phrases/tags").json() == [
        {"tag": "slang", "count": 2},
        {"tag": "south", "count": 1},
    ]
    ex = client.get("/api/phrases/export")
    assert "attachment" in ex.headers["content-disposition"]
    body = ex.json()
    assert body["format"] == "studio-bars-phrases" and [p["phrase"] for p in body["phrases"]] == [
        "a1",
        "a2",
    ]
    assert set(body["phrases"][0]) == {
        "phrase",
        "meaning",
        "sounds_like",
        "tags",
    }  # nothing private or internal


def test_bank_size_limit(client, monkeypatch):
    from app import phrases

    monkeypatch.setattr(phrases, "MAX_PHRASES", 2)
    add(client, "one")
    add(client, "two")
    assert client.post("/api/phrases", json={"phrase": "three"}).status_code == 422


# ------------------------------------------------------------------ phrase rhymes (experimental)


def prhymes(client, phrase, **p):
    return client.get("/api/phonetics/phrase-rhymes", params={"phrase": phrase, **p})


def test_phrase_rhymes_match_the_last_syllables(client):
    r = prhymes(client, "pay attention", syllables=2).json()
    words = {x["text"]: x["quality"] for x in r["results"]}
    assert r["experimental"] is True and any("Experimental" in n for n in r["notes"])
    assert (
        words["tension"] == "perfect"
        and words["mention"] == "perfect"
        and words["convention"] == "perfect"
    )
    assert "attention" not in words  # words already in your phrase are not offered back
    assert r["syllables"] == 2 and r["tail_ipa"]


def test_depth_changes_the_match(client):
    two = {
        x["text"]
        for x in prhymes(client, "pay attention", syllables=2, familiarity="any").json()["results"]
    }
    three = {
        x["text"]
        for x in prhymes(client, "pay attention", syllables=3, familiarity="any").json()["results"]
    }
    assert (
        "tension" in two and "tension" not in three
    )  # one syllable is not enough for a 3-syllable match
    assert three < two or three != two


def test_near_and_assonance_are_opt_in_and_labelled(client):
    base = {x["quality"] for x in prhymes(client, "made the grade", syllables=1).json()["results"]}
    assert base <= {"perfect", "near"}
    loose = prhymes(
        client,
        "made the grade",
        syllables=1,
        qualities="perfect,near,assonance",
        familiarity="common",
        limit=300,
    ).json()
    assert {x["quality"] for x in loose["results"]} == {"perfect", "near", "assonance"}
    order = [x["quality"] for x in loose["results"]]
    assert order == sorted(order, key=["perfect", "near", "assonance"].index)  # best first


def test_your_own_phrases_are_offered_first(client):
    add(client, "no attention", sounds_like="no attention")
    r = prhymes(client, "pay attention", syllables=2).json()
    first = r["results"][0]
    assert first["kind"] == "mine" and first["text"] == "no attention"
    assert all(x["kind"] == "word" for x in r["results"][1:])


def test_a_word_you_taught_the_app_is_included(client):
    client.put("/api/phonetics/custom/mentchen", json={"sounds_like": "mention"})
    texts = [x["text"] for x in prhymes(client, "pay attention", syllables=2).json()["results"]]
    assert "mentchen" in texts


def test_phrase_rhyme_errors_are_plain(client):
    unknown = prhymes(client, "zorblax fade")
    assert unknown.status_code == 422 and unknown.json()["detail"]["code"] == "UNKNOWN_WORDS"
    assert (
        unknown.json()["detail"]["words"] == ["zorblax"]
        and "Teach them" in unknown.json()["detail"]["message"]
    )
    short = prhymes(client, "fade", syllables=3)
    assert short.status_code == 422 and "only 1 syllable" in short.json()["detail"]["message"]
    assert prhymes(client, "fade", qualities="consonance").status_code == 422
    assert prhymes(client, "fade", syllables=5).status_code == 422
    assert prhymes(client, "").status_code == 422
    assert prhymes(client, "a\nb").status_code == 422


def test_phrase_rhyme_tail_logic():
    from app.phonetics import engine as e

    d = e.get_dictionary()
    assert e.tail(d.prons["nation"][0], 1) == ("AH", "N") and e.tail(d.prons["nation"][0], 2) == (
        "EY",
        "SH",
        "AH",
        "N",
    )
    assert e.tail(d.prons["fade"][0], 2) is None  # only one syllable
    assert e.classify_tail(("EY", "D"), ("EY", "D")) == "perfect"
    assert e.classify_tail(("EY", "D"), ("EY", "T")) == "near"
    assert e.classify_tail(("EY", "D"), ("EY", "V")) == "assonance"
    assert e.classify_tail(("EY", "D"), ("IY", "D")) is None


# ------------------------------------------------------------------ part of speech filter (WordNet)


def pos_words(client, pos, **p):
    r = client.get(
        "/api/phonetics/rhymes",
        params={"word": "fade", "pos": pos, "limit": 300, "familiarity": "any", **p},
    ).json()
    return {x["word"] for x in r["results"]}, r


def test_part_of_speech_filter_uses_wordnet(client):
    nouns, rn = pos_words(client, "noun")
    verbs, rv = pos_words(client, "verb")
    assert {"grade", "blade", "shade"} <= nouns and "made" not in nouns
    assert {"made", "played", "paid"} <= verbs and "grade" not in verbs
    assert nouns.isdisjoint(verbs)
    assert any("usually used as a noun" in n for n in rn["notes"])
    assert any("WordNet does not know" in n for n in rn["notes"])  # honest about what was left out


def test_part_of_speech_off_by_default_and_validated(client):
    plain = client.get(
        "/api/phonetics/rhymes", params={"word": "fade", "limit": 300, "familiarity": "any"}
    ).json()
    assert {"made", "grade"} <= {x["word"] for x in plain["results"]}
    assert (
        client.get("/api/phonetics/rhymes", params={"word": "fade", "pos": "pronoun"}).status_code
        == 422
    )
    assert client.get("/api/phonetics/status").json()["pos_available"] is True


def test_adjectives_and_adverbs(client):
    adj, _ = pos_words(
        client,
        "adjective",
    )
    assert "afraid" in adj
    r = client.get(
        "/api/phonetics/rhymes",
        params={"word": "tight", "pos": "adverb", "limit": 50, "familiarity": "any"},
    ).json()
    assert r["total"] >= 0 and all(x["word"] for x in r["results"])
