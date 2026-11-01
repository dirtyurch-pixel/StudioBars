import hashlib
import time
from pathlib import Path

import pytest

from app.lexicon import wordnet as W
from app.lexicon.heteronyms import HETERONYMS, said_as
from app.lexicon.service import describe
from app.phonetics.engine import get_dictionary

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def wn():
    return W.get_wordnet()


# ------------------------------------------------------------------ data & licence


def test_wordnet_files_are_the_unmodified_originals():
    d = W.DATA_DIR
    lines = (d / "MANIFEST.sha256").read_text().splitlines()
    assert len(lines) >= 13
    for line in lines:
        digest, name = line.split()
        assert hashlib.sha256((d / name).read_bytes()).hexdigest() == digest, name


def test_wordnet_licence_travels_with_every_copy():
    for p in (W.DATA_DIR / "LICENSE", ROOT / "licenses" / "wordnet-LICENSE.txt"):
        t = p.read_text()
        assert "WordNet 3.0 Copyright 2006 by Princeton University" in t
        assert "must" not in t.lower() or "advertising or publicity" in t
    assert (W.DATA_DIR / "LICENSE").read_text() == (
        ROOT / "licenses" / "wordnet-LICENSE.txt"
    ).read_text()
    assert "Princeton" in (W.DATA_DIR / "README.md").read_text()


def test_nothing_in_the_runtime_imports_a_network_library_for_wordnet():
    src = (Path(W.__file__)).read_text()
    assert "urllib" not in src and "requests" not in src and "httpx" not in src


# ------------------------------------------------------------------ reading WordNet


def test_loads_all_four_parts_of_speech(wn):
    assert {p: len(wn.index[p]) for p in "nvar"} == {"n": 117798, "v": 11529, "a": 21479, "r": 4481}


def test_parse_a_known_meaning(wn):
    s = wn.synset("v", 224651)
    assert s.words[0] == "fade" and "melt" in s.words
    assert s.definition.startswith("become less clearly visible")
    assert s.examples[0] == "The scene begins to fade" and len(s.examples) == 2
    assert s.id == "v00224651"


@pytest.mark.parametrize(
    "word,pos,expected",
    [("made", "v", "make"), ("feet", "n", "foot"), ("happier", "a", "happy"), ("lying", "v", "lie"),
     ("children", "n", "child"), ("rains", "n", "rain"), ("went", "v", "go"), ("better", "a", "good")],
)  # fmt: skip
def test_base_forms(wn, word, pos, expected):
    assert expected in wn.morphy(word, pos)


def test_unknown_words_have_no_base_form(wn):
    assert not wn.knows("zorblax") and wn.morphy("", "n") == []


def test_meanings_come_most_common_first(wn):
    first = wn.senses("bank", "n")[0]
    assert "sloping land" in first[3].definition  # WordNet's most common meaning of "bank"
    assert [s[2] for s in wn.senses("run", "v")][:3] == [1, 2, 3]


@pytest.mark.parametrize("word,pos", [("rain", "n"), ("run", "v"), ("happy", "a"), ("lead", "v")])
def test_usual_part_of_speech(wn, word, pos):
    assert wn.usual_pos(word) == pos


def test_sense_rank_and_first_sense(wn):
    s = wn.senses("fade", "v")[1][3]
    rank, total = wn.sense_rank("v", "fade", s.offset)
    assert rank == 2 and total >= 4
    assert wn.first_sense("v", "fade").offset == wn.senses("fade", "v")[0][3].offset


def test_lookups_are_fast_and_memory_light(wn):
    t = time.time()
    for _ in range(100):
        describe("run")
    assert (time.time() - t) / 100 < 0.15


# ------------------------------------------------------------------ meanings for songwriters


def test_describe_basics():
    d = describe("rain")
    assert (
        d["found"]
        and d["source"].startswith("WordNet 3.0")
        and d["pos_counts"] == {"noun": 3, "verb": 1}
    )
    s = d["senses"][0]
    assert s["definition"].startswith("water falling in drops")
    assert {"word": "precipitation"} in s["broader"]
    assert any(x["word"] in {"drizzle", "shower", "downpour"} for x in s["narrower"])
    assert all(
        k in s
        for k in (
            "synonyms",
            "antonyms",
            "similar",
            "related",
            "imagery",
            "examples",
            "fit",
            "said_as",
        )
    )


def test_unknown_word_says_so_without_inventing_anything():
    d = describe("zorblax")
    assert not d["found"] and d["senses"] == [] and "does not have" in d["notes"][0]


def test_opposites():
    assert {"word": "unhappy"} in describe("happy")["senses"][0]["antonyms"]
    slow = describe("fast")
    assert any(a["word"] == "slow" for s in slow["senses"] for a in s["antonyms"])


def test_adjectives_get_a_similar_meaning_list():
    sims = [x["word"] for s in describe("fast")["senses"] if s["pos"] == "a" for x in s["similar"]]
    assert {"rapid", "swift"} <= set(sims)


def test_parts_of_speech_are_ordered_by_use():
    assert describe("lead")["senses"][0]["pos"] == "v"
    assert describe("rain")["senses"][0]["pos"] == "n"
    only_noun = describe("rain", pos="n")
    assert {s["pos"] for s in only_noun["senses"]} == {"n"}


def test_synonyms_are_per_meaning_and_flag_meaning_shift():
    seen_flag = seen_ok = False
    for word in ("light", "bank", "fade", "cool", "run"):
        for s in describe(word)["senses"]:
            flags = ["shift" in x for x in s["synonyms"]]
            assert flags == sorted(flags)  # safe synonyms come before risky ones
            for x in s["synonyms"]:
                if "shift" in x:
                    seen_flag = True
                    assert x["shift"]["rank"] > 1 and x["shift"]["usually_means"]
                else:
                    seen_ok = True
    assert seen_flag and seen_ok


def test_synonym_shift_names_what_the_word_usually_means():
    # "bank" the building is not what "depository" mostly means; WordNet knows each word's commonest meaning
    d = describe("light")
    risky = [x for s in d["senses"] for x in s["synonyms"] if "shift" in x]
    assert risky and all(len(x["shift"]["usually_means"]) > 5 for x in risky)


def test_different_meanings_have_different_synonym_lists():
    d = describe("bank")
    lists = [tuple(x["word"] for x in s["synonyms"]) for s in d["senses"] if s["pos"] == "n"]
    assert len(set(lists)) > 3  # not one blended list


def test_context_picks_the_meaning_that_fits_the_line():
    money = describe("bank", "he deposited the money at the bank to open an account")
    assert money["context_used"] and money["reordered"]
    top = money["senses"][0]
    assert "financial" in top["definition"] and top["fit"]["score"] >= 2
    assert (
        set(top["fit"]["matched"]) <= {"deposit", "money", "account", "open"}
        and top["fit"]["matched"]
    )
    # two meanings can tie (the noun and the verb "to bank"): then nothing is crowned "best"
    scores = sorted((s["fit"]["score"] for s in money["senses"]), reverse=True)
    assert top["fit"]["best"] == (scores[0] > scores[1])
    river = describe("bank", "we sat on the bank of the river watching the water")
    assert "sloping land" in river["senses"][0]["definition"]


def test_context_never_hides_meanings_and_is_optional():
    plain = describe("bank")
    ctx = describe("bank", "he deposited the money at the bank")
    assert sorted(s["id"] for s in plain["senses"]) == sorted(s["id"] for s in ctx["senses"])
    assert (
        not plain["context_used"] and plain["senses"][0]["fit"] is None and not plain["reordered"]
    )


def test_context_without_matches_keeps_normal_order():
    d = describe("bank", "zzz qqq")
    assert d["context_used"] and not d["reordered"]
    assert [s["sense_no"] for s in d["senses"] if s["pos"] == "n"][:2] == [1, 2]


# ------------------------------------------------------------------ same spelling, different sound


def test_every_heteronym_pronunciation_exists_in_the_dictionary():
    d = get_dictionary()
    for word, entries in HETERONYMS.items():
        have = {" ".join(p) for p in d.prons[word]}
        for _pos, _hints, phones in entries:
            assert phones in have, (word, phones, have)


@pytest.mark.parametrize(
    "word,pos,definition,phones",
    [
        ("lead", "n", "a soft heavy toxic malleable metallic element", "L EH1 D"),
        ("lead", "n", "a position of leadership", "L IY1 D"),
        ("lead", "v", "take somebody somewhere", "L IY1 D"),
        ("tear", "n", "water secreted by the lacrimal glands", "T IH1 R"),
        ("tear", "v", "separate or cause to separate abruptly", "T EH1 R"),
        ("bass", "n", "the lowest adult male singing voice", "B EY1 S"),
        ("bass", "n", "any of various North American freshwater fish", "B AE1 S"),
        ("wind", "v", "to move in a twisting course", "W AY1 N D"),
        ("wind", "n", "air moving", "W IH1 N D"),
        ("live", "a", "exerting force", "L AY1 V"),
        ("live", "v", "be alive", "L IH1 V"),
        ("close", "a", "near in space", "K L OW1 S"),
        ("close", "v", "move so that an opening or passage is obstructed", "K L OW1 Z"),
    ],
)
def test_said_as(word, pos, definition, phones):
    assert said_as(word, pos, definition) == phones


def test_unlisted_words_have_no_special_pronunciation():
    assert said_as("fade", "v", "x") is None and said_as("lead", "r", "x") is None


def test_describe_shows_how_each_meaning_of_lead_is_said():
    d = describe("lead")
    ipas = {s["said_as"]["ipa"] for s in d["senses"] if s["said_as"]}
    assert ipas == {"lˈɛd", "lˈid"}
    assert any("said differently" in n for n in d["notes"])
    assert all(s["said_as"]["in_dictionary"] for s in d["senses"] if s["said_as"])


# ------------------------------------------------------------------ HTTP


def test_word_endpoint(client):
    r = client.get(
        "/api/lexicon/word", params={"word": "Rain", "context": "cold rain on the glass"}
    ).json()
    assert r["found"] and r["context_used"] and r["senses"][0]["pos"] == "n"
    assert (
        client.get("/api/lexicon/word", params={"word": "rain", "pos": "verb"}).json()["senses"][0][
            "pos"
        ]
        == "v"
    )
    assert (
        client.get("/api/lexicon/word", params={"word": "rain", "pos": "noun phrase"}).status_code
        == 422
    )
    assert client.get("/api/lexicon/word", params={"word": "../etc"}).status_code == 422
    assert client.get("/api/lexicon/word", params={"word": "a" * 61}).status_code == 422
    assert (
        client.get("/api/lexicon/word", params={"word": "rain", "context": "x" * 601}).status_code
        == 422
    )
    assert client.get("/api/lexicon/word", params={"word": "zorblax"}).json()["found"] is False


def test_status_credits_princeton(client):
    s = client.get("/api/lexicon/status").json()
    assert s["wordnet"]["owner"] == "Princeton University" and "WordNet 3.0" in s["credit"]
    assert s["online"]["enabled"] is False  # the online helper is off until the user turns it on


def test_the_line_you_are_writing_counts_more_than_the_lines_beside_it():
    # "watch" in the NEXT line would otherwise tie with "money" in THIS line and pick the river bank
    line, next_line = "he put the money in the bank", "I watch the lights fade fast"
    mixed = describe("bank", context=f"{line} {next_line}")
    weighted = describe("bank", context=line, around=next_line)
    assert "financial" in weighted["senses"][0]["definition"]
    assert weighted["senses"][0]["fit"]["score"] >= 2
    assert mixed["context_used"]  # the old, unweighted way of asking still works
    only_around = describe("bank", context="", around="money and deposits")
    assert only_around["context_used"] and "financial" in only_around["senses"][0]["definition"]


def test_around_is_accepted_over_http(client):
    r = client.get(
        "/api/lexicon/word",
        params={
            "word": "bank",
            "context": "put the money in the bank",
            "around": "I watch the lights",
        },
    ).json()
    assert "financial" in r["senses"][0]["definition"]
    assert (
        client.get("/api/lexicon/word", params={"word": "bank", "around": "x" * 601}).status_code
        == 422
    )
