import hashlib
import time

import pytest

from app import db
from app.phonetics import engine as e
from app.phonetics.words import (
    Resolver,
    analyze_lines,
    custom_phones,
    guess_syllables,
    norm_word,
    number_words,
    tokenize,
)


@pytest.fixture(scope="module")
def d():
    return e.get_dictionary()


@pytest.fixture(scope="module")
def r(d):
    return Resolver(d)


def rhymes(d, r, word, qualities=("perfect",), **kw):
    info = r.lookup(word)
    kw.setdefault("min_zipf", 3.0)
    return [c.word for c in d.search([p.phones for p in info.prons], word, set(qualities), **kw)]


# ------------------------------------------------------------------ data & licensing


def test_bundled_dictionary_is_the_unmodified_upstream_file():
    data = (e.DATA_DIR / "cmudict.dict").read_bytes()
    assert (
        hashlib.sha256(data).hexdigest()
        == "81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22"
    )


def test_licence_notices_ship_with_the_data():
    root = e.DATA_DIR.parents[2].parent  # repo root
    assert "Carnegie Mellon University" in (root / "licenses" / "cmudict-LICENSE.txt").read_text()
    assert (
        "CC BY-SA" in (root / "licenses" / "wordfreq-NOTICE.txt").read_text()
        or "Share" in (root / "licenses" / "wordfreq-NOTICE.txt").read_text()
    )
    assert (
        "GPL" in (e.DATA_DIR / "README.md").read_text()
    )  # documents why the GPL wrapper is not used


def test_no_gpl_wrapper_is_a_dependency():
    reqs = (e.DATA_DIR.parents[2] / "requirements.txt").read_text().lower()
    assert "cmudict" not in reqs and "wordfreq" not in reqs


def test_dictionary_loads_with_variants(d):
    assert len(d.prons) > 120_000
    assert len(d.prons["every"]) == 2 and len(d.prons["read"]) == 2


# ------------------------------------------------------------------ syllables


@pytest.mark.parametrize(
    "word,n",
    [
        ("fade", 1),
        ("nation", 2),
        ("beautiful", 3),
        ("rhythm", 2),
        ("the", 1),
        ("a", 1),
        ("strengths", 1),
    ],
)
def test_syllable_counts(r, word, n):
    i = r.lookup(word)
    assert (i.syl_min, i.syl_max) == (n, n) and not i.ambiguous


@pytest.mark.parametrize(
    "word,lo,hi", [("every", 2, 3), ("fire", 1, 2), ("family", 2, 3), ("hour", 1, 2)]
)
def test_ambiguous_words_report_a_range_not_one_number(r, word, lo, hi):
    i = r.lookup(word)
    assert (i.syl_min, i.syl_max) == (lo, hi) and i.ambiguous


def test_line_syllables_add_up_and_carry_the_range(r):
    a = analyze_lines(["Every little thing"], r)["lines"][0]["syllables"]
    assert (a["min"], a["max"], a["exact"], a["guessed"]) == (5, 6, False, False)
    b = analyze_lines(["I wrote your name"], r)["lines"][0]["syllables"]
    assert (b["min"], b["max"], b["exact"]) == (4, 4, True)


def test_empty_and_punctuation_only_lines(r):
    out = analyze_lines(["", "   ", "...!!!", "🎤🎤"], r)["lines"]
    assert all(ln["syllables"]["min"] == 0 and ln["words"] == [] for ln in out)


# ------------------------------------------------------------------ rhymes are about sound, not spelling


def test_perfect_rhymes_for_fade(d, r):
    got = rhymes(d, r, "fade")
    for w in ("made", "shade", "grade", "afraid", "parade"):
        assert w in got, w
    for w in ("fate", "fame", "fad", "fade"):
        assert w not in got, w


def test_same_ending_letters_but_different_sound_do_not_rhyme(d, r):
    assert "cough" not in rhymes(d, r, "tough", min_zipf=None)
    assert {"rough", "enough", "stuff"} <= set(rhymes(d, r, "tough"))
    assert {"so", "know", "show", "go"} <= set(rhymes(d, r, "though"))
    assert "tough" not in rhymes(d, r, "though", min_zipf=None)


def test_different_spelling_same_sound_do_rhyme(d, r):
    assert {"know", "toe", "sew", "though"} <= set(rhymes(d, r, "flow", min_zipf=2.5))


def test_same_spelling_two_pronunciations_gives_both_families(d, r):
    got = set(rhymes(d, r, "read"))
    assert {"bed", "said", "head"} <= got  # read (past)
    assert {"need", "speed", "feed"} <= got  # read (present)
    assert set(rhymes(d, r, "lead")) >= {"bed", "need"}


def test_multisyllable_rhymes_follow_the_stress(d, r):
    assert {"station", "education", "creation"} <= set(rhymes(d, r, "nation", min_zipf=3.5))
    assert {"letter", "sweater"} <= set(rhymes(d, r, "better"))
    assert "butter" not in rhymes(d, r, "nation", min_zipf=None)


def test_quality_levels(d, r):
    assert "late" in rhymes(d, r, "fade", ("near",))  # D/T sound alike
    assert "stone" in rhymes(d, r, "home", ("near",))  # M/N are both nasals
    assert "brave" in rhymes(d, r, "fade", ("assonance",))
    assert "bed" in rhymes(d, r, "bad", ("consonance",))
    assert "late" not in rhymes(d, r, "fade", ("perfect",))


def test_homophones_and_rich_rhymes_are_separate_labels(d, r):
    c = {
        x.word: x.quality
        for x in d.search(
            [d.prons["write"][0]], "write", {"homophone", "rich", "perfect"}, min_zipf=3.0
        )
    }
    assert c["right"] == "homophone" and c["night"] == "perfect"
    s = {
        x.word: x.quality
        for x in d.search(
            [d.prons["suppose"][0]], "suppose", {"homophone", "rich", "perfect"}, min_zipf=3.0
        )
    }
    assert s["oppose"] == "rich" and s["those"] == "perfect"
    assert "right" not in rhymes(d, r, "write")  # not offered by default


def test_filters(d, r):
    one = rhymes(d, r, "fade", max_syllables=1)
    two = rhymes(d, r, "fade", min_syllables=2, max_syllables=2)
    assert "made" in one and "made" not in two and "decade" in two
    fem = rhymes(d, r, "better", endings={"feminine"})
    assert "letter" in fem
    assert all(
        e.ending_type(e.rhyme_parts(d.prons[w][0])[2]) == "feminine" for w in fem if w in d.prons
    )
    very_common = rhymes(d, r, "fade", min_zipf=5.0)
    assert "made" in very_common and "afraid" not in very_common  # afraid is 4.7, made is 5.9
    assert "afraid" in rhymes(d, r, "fade", min_zipf=4.0)


def test_results_are_ordered_by_familiarity(d, r):
    res = d.search([d.prons["fade"][0]], "fade", {"perfect"}, min_zipf=3.0)
    z = [c.zipf for c in res]
    assert z == sorted(z, reverse=True)
    assert res[0].word in {"made", "played", "paid"}


def test_missing_frequency_data_is_handled(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIO_BARS_FREQ_FILE", str(tmp_path / "nope.tsv"))
    e.reset_dictionary()
    try:
        dd = e.get_dictionary()
        assert not dd.has_frequency
        res = dd.search([dd.prons["fade"][0]], "fade", {"perfect"}, min_zipf=4.0)
        assert "made" in [c.word for c in res]  # filter ignored, not a crash
    finally:
        monkeypatch.undo()
        e.reset_dictionary()


# ------------------------------------------------------------------ words in real lyrics


@pytest.mark.parametrize(
    "text",
    [
        "I'm gonna make it, y'all",
        "Café’s don’t 808 well-known 🎤 niño!",
        "",
        "  \t\n",
        "a-b-c--d",
        "x" * 5000,
        "rock'n'roll 'cause 'til",
        "12,345 and 3.5",
    ],
)
def test_tokens_point_exactly_at_the_original_text(text):
    for t in tokenize(text):
        assert text[t.start : t.end] == t.text


def test_tokenizer_cases():
    assert [t.text for t in tokenize("Café’s don’t 808 well-known 🎤 niño!")] == [
        "Café’s",
        "don’t",
        "808",
        "well-known",
        "niño",
    ]
    assert [t.norm for t in tokenize("Don’t STOP")] == ["don't", "stop"]


def test_dropped_g_endings_and_contractions(r):
    for w in ("runnin'", "nothin'", "gonna", "ain't", "don’t"):
        assert r.lookup(w).has_phones, w
    novel = r.lookup("flyin'")
    assert novel.status in {"known", "derived"} and novel.syl_min == 2
    assert novel.prons[0].phones[-1] == "N"  # said "-in", not "-ing"


def test_possessives_are_built_from_the_base_word(r):
    i = r.lookup("hova's")
    assert i.status in {"known", "derived", "guess"}
    j = r.lookup("jay-z's")
    assert j.status in {"derived", "guess"}


def test_hyphenated_compounds(r):
    i = r.lookup("well-known")
    assert i.has_phones and i.syl_min == 2
    k = r.lookup("heart-to-heart")
    assert k.has_phones and k.syl_min == 3


def test_numbers_are_flagged_as_guesses(r):
    i = r.lookup("21")
    assert i.status == "guess" and i.syl_min == 3 and i.has_phones
    assert number_words(1999) == ["one", "thousand", "nine", "hundred", "ninety", "nine"]
    assert r.lookup("9999999").status == "guess"


def test_unknown_words_get_a_flagged_guess(r):
    i = r.lookup("zorblax")
    assert i.status == "guess" and not i.has_phones and i.syl_min == i.syl_max == 2
    assert (
        guess_syllables("blorp") == 1
        and guess_syllables("banana") == 3
        and guess_syllables("") == 1
    )


def test_accents_and_case(r):
    assert r.lookup("CAFÉ").has_phones and r.lookup("niño").status in {"known", "guess"}
    assert norm_word("DON’T") == "don't"


# ------------------------------------------------------------------ your own pronunciations


def test_custom_pronunciation_overrides_the_dictionary(d):
    plain = Resolver(d).lookup("read")
    mine = Resolver(d, {"read": ("R", "IY1", "D")}).lookup("read")
    assert plain.ambiguous or len(plain.prons) == 2
    assert mine.status == "custom" and len(mine.prons) == 1 and mine.prons[0].source == "custom"


@pytest.mark.parametrize(
    "raw,msg",
    [
        ("", "between 1 and 24"),
        ("B R OW", "needs a stress number"),
        ("B R OW1 Q", "not a sound I know"),
        ("B1 R OW1", "should not have a number"),
        ("B R", "at least one vowel"),
        (" ".join(["B"] * 30), "between 1 and 24"),
    ],
)
def test_bad_custom_sounds_get_plain_english_errors(raw, msg):
    with pytest.raises(ValueError, match=msg):
        custom_phones(raw)


def test_valid_custom_sounds():
    assert custom_phones("b r ow1") == ("B", "R", "OW1")


# ------------------------------------------------------------------ rhyme families in a verse


def families(r, lines):
    out = analyze_lines(lines, r)
    return out, {
        (li, w["text"]): w["family"] for li, ln in enumerate(out["lines"]) for w in ln["words"]
    }


def test_end_and_internal_rhymes_are_grouped(r):
    out, fam = families(r, ["I made the grade", "Walking in the shade", "Nothing left to say"])
    assert fam[(0, "made")] == fam[(0, "grade")] == fam[(1, "shade")] is not None
    assert fam[(2, "say")] is None  # alone
    f = out["families"][0]
    assert (
        f["size"] == 3 and f["end_count"] == 2
    )  # grade and shade end their lines; made is internal
    end_flags = {
        (li, w["text"]): w["is_end"] for li, ln in enumerate(out["lines"]) for w in ln["words"]
    }
    assert end_flags[(0, "grade")] and not end_flags[(0, "made")]


def test_function_words_and_repeats_do_not_form_families(r):
    _, fam = families(r, ["to the to the", "go go go"])
    assert all(v is None for v in fam.values())  # filler words, and the same word repeated


def test_small_words_rhyme_at_the_end_of_a_line_but_not_in_the_middle(r):
    _, fam = families(r, ["set me free", "that's you and me", "me and the sea"])
    assert fam[(0, "free")] == fam[(1, "me")] == fam[(2, "sea")] is not None
    assert fam[(0, "me")] is None and fam[(2, "me")] is None  # mid-line "me" is just filler
    _, fam2 = families(r, ["I see the blue", "and I knew you"])
    assert fam2[(0, "blue")] == fam2[(1, "you")] is not None


def test_homophones_count_as_a_family(r):
    _, fam = families(r, ["Tonight is the night", "Turn on the light and write"])
    assert fam[(0, "night")] == fam[(1, "light")] == fam[(1, "write")]


def test_guessed_words_never_join_families(r):
    out, fam = families(r, ["zorblax is the night", "turn on the light"])
    assert fam[(0, "zorblax")] is None
    assert out["unknown_words"] == ["zorblax"]


def test_family_numbers_follow_first_appearance(r):
    out, fam = families(r, ["the night and the day", "the light and the say", "right away"])
    ids = [f["id"] for f in out["families"]]
    assert ids == sorted(ids) and ids[0] == 0
    assert fam[(0, "night")] == 0


def test_analysis_is_fast_enough_for_live_typing(r):
    lines = ["I wrote your name in steam, then watched it fade away"] * 300
    t = time.time()
    analyze_lines(lines, r)
    assert time.time() - t < 2.0


# ------------------------------------------------------------------ HTTP API


def test_migrations_include_custom_pronunciations(db_file):
    conn = db.connect(db_file)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == len(db.MIGRATIONS) >= 3
    conn.execute("SELECT * FROM custom_pronunciations")


def test_status_endpoint(client):
    s = client.get("/api/phonetics/status").json()
    assert s["dictionary_words"] > 120_000 and s["frequency_available"] is True
    assert s["pos_available"] is True and "perfect" in s["quality_help"]


def test_word_endpoint(client):
    w = client.get("/api/phonetics/word", params={"word": "Every"}).json()
    assert (
        w["word"] == "every"
        and w["ambiguous"]
        and [p["syllables"] for p in w["pronunciations"]] == [3, 2]
    )
    assert w["pronunciations"][0]["ipa"].startswith("ˈɛ")
    assert client.get("/api/phonetics/word", params={"word": "../etc"}).status_code == 422
    assert client.get("/api/phonetics/word", params={"word": "two words"}).status_code == 422


def test_rhyme_endpoint(client):
    r = client.get("/api/phonetics/rhymes", params={"word": "fade", "limit": 5}).json()
    assert len(r["results"]) == 5 and r["total"] > 20
    first = r["results"][0]
    assert first["quality"] == "perfect" and {
        "ipa",
        "syllables",
        "stress",
        "ending",
        "zipf",
    } <= set(first)
    page2 = client.get(
        "/api/phonetics/rhymes", params={"word": "fade", "limit": 5, "offset": 5}
    ).json()
    assert [x["word"] for x in page2["results"]] != [x["word"] for x in r["results"]]


def test_rhyme_endpoint_filters_and_validation(client):
    g = lambda **p: client.get("/api/phonetics/rhymes", params={"word": "fade", **p})  # noqa: E731
    two = g(min_syllables=2, max_syllables=2).json()["results"]
    assert two and all(x["syllables"] == 2 for x in two)
    near = [x["quality"] for x in g(qualities="near", limit=50).json()["results"]]
    assert near and set(near) == {"near"}
    assert g(qualities="bogus").status_code == 422
    assert g(endings="sideways").status_code == 422
    assert g(familiarity="whatever").status_code == 422
    assert g(limit=0).status_code == 422 and g(min_syllables=0).status_code == 422


def test_rhymes_for_unknown_word_explain_themselves(client):
    r = client.get("/api/phonetics/rhymes", params={"word": "zorblax"}).json()
    assert (
        r["results"] == [] and "don’t know how" in r["notes"][0] and r["word"]["status"] == "guess"
    )


def test_ambiguous_word_note(client):
    r = client.get("/api/phonetics/rhymes", params={"word": "family"}).json()
    assert any("2 or 3 syllables" in n for n in r["notes"])


def test_analyze_endpoint_and_limits(client):
    out = client.post(
        "/api/phonetics/analyze", json={"lines": ["I made the grade", "in the shade"]}
    ).json()
    assert out["lines"][0]["syllables"]["min"] == 4 and out["families"][0]["size"] == 3
    assert out["lines"][0]["words"][1]["start"] == 2
    assert client.post("/api/phonetics/analyze", json={"lines": ["x"] * 301}).status_code == 422
    assert client.post("/api/phonetics/analyze", json={"lines": ["x" * 501]}).status_code == 422
    assert client.post("/api/phonetics/analyze", json={"lines": []}).json()["lines"] == []


def test_custom_pronunciation_lifecycle(client):
    assert client.get("/api/phonetics/custom").json() == []
    put = client.put("/api/phonetics/custom/Zorblax", json={"sounds_like": "lax"})
    assert (
        put.status_code == 200
        and put.json()["word"] == "zorblax"
        and put.json()["phones"] == "L AE1 K S"
    )
    assert (
        client.get("/api/phonetics/word", params={"word": "zorblax"}).json()["status"] == "custom"
    )
    # now it takes part in analysis and rhyme search
    a = client.post("/api/phonetics/analyze", json={"lines": ["zorblax", "pay the tax"]}).json()
    assert (
        a["unknown_words"] == []
        and a["lines"][0]["words"][0]["family"] == a["lines"][1]["words"][-1]["family"]
    )
    rh = client.get(
        "/api/phonetics/rhymes", params={"word": "tax", "familiarity": "any", "limit": 300}
    ).json()
    z = [x for x in rh["results"] if x["word"] == "zorblax"]
    assert z and z[0]["custom"] is True
    assert client.get("/api/phonetics/rhymes", params={"word": "zorblax"}).json()["results"]
    # editing replaces; deleting reverts to a guess
    client.put(
        "/api/phonetics/custom/zorblax",
        json={"phones": "Z AO1 R B AH0 L AE2 K S", "note": "my way"},
    )
    assert client.get("/api/phonetics/custom").json()[0]["syllables"] == 3
    assert client.delete("/api/phonetics/custom/zorblax").status_code == 204
    assert client.get("/api/phonetics/word", params={"word": "zorblax"}).json()["status"] == "guess"
    assert client.delete("/api/phonetics/custom/zorblax").status_code == 404


def test_custom_pronunciation_validation(client):
    put = lambda w, **b: client.put(f"/api/phonetics/custom/{w}", json=b)  # noqa: E731
    assert put("x", sounds_like="lax", phones="L AE1 K S").status_code == 422
    assert put("x").status_code == 422
    assert put("x", sounds_like="qqqzzz").json()["detail"]["code"] == "UNKNOWN_WORD"
    bad = put("x", phones="B R OW")
    assert bad.status_code == 422 and "stress number" in bad.json()["detail"]["message"]
    assert put("not a word", phones="B OW1").status_code in (404, 422)
    assert put("..%2F..", phones="B OW1").status_code in (404, 422)


def test_custom_overrides_a_dictionary_word_and_is_reversible(client):
    before = client.get("/api/phonetics/word", params={"word": "read"}).json()
    assert len(before["pronunciations"]) == 2
    client.put("/api/phonetics/custom/read", json={"phones": "R IY1 D"})
    after = client.get("/api/phonetics/word", params={"word": "read"}).json()
    assert len(after["pronunciations"]) == 1 and after["status"] == "custom"
    rh = {
        x["word"]
        for x in client.get("/api/phonetics/rhymes", params={"word": "read"}).json()["results"]
    }
    assert "need" in rh and "bed" not in rh
    client.delete("/api/phonetics/custom/read")
    assert (
        len(client.get("/api/phonetics/word", params={"word": "read"}).json()["pronunciations"])
        == 2
    )


def test_custom_limit(client, monkeypatch):
    from app import phonetics_routes

    monkeypatch.setattr(phonetics_routes, "MAX_CUSTOM", 2)
    for w in ("aa1", "bb2"):
        assert client.put(f"/api/phonetics/custom/{w}", json={"phones": "B OW1"}).status_code == 200
    assert client.put("/api/phonetics/custom/cc3", json={"phones": "B OW1"}).status_code == 422
    assert (
        client.put("/api/phonetics/custom/aa1", json={"phones": "K OW1"}).status_code == 200
    )  # edits still fine


def test_phonetics_makes_no_network_calls(monkeypatch, client):
    import socket

    def boom(*a, **k):
        raise AssertionError("network used")

    monkeypatch.setattr(socket, "create_connection", boom)
    assert client.get("/api/phonetics/rhymes", params={"word": "fade"}).status_code == 200
    assert client.post("/api/phonetics/analyze", json={"lines": ["hello world"]}).status_code == 200


def test_your_own_words_rank_first_within_their_rhyme_quality(client):
    client.put("/api/phonetics/custom/zorblax", json={"sounds_like": "lax"})
    r = client.get(
        "/api/phonetics/rhymes", params={"word": "tax", "familiarity": "any", "limit": 10}
    ).json()
    words = [x["word"] for x in r["results"]]
    assert words[0] == "zorblax", words  # not buried below hundreds of dictionary words
    assert r["results"][0]["custom"] is True and r["results"][0]["quality"] == "perfect"
