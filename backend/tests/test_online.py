import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.lexicon import online
from app.lexicon.online import OnlineError, RateLimiter


@pytest.fixture(autouse=True)
def fresh_limiter(monkeypatch):
    monkeypatch.setattr(online, "limiter", RateLimiter(capacity=50, per_second=50))


class Recorder:
    """Stands in for the internet. Remembers every request that would have been sent."""

    def __init__(self, response=None, error=None):
        self.urls, self.response, self.error = [], response, error

    def __call__(self, url, timeout):
        self.urls.append((url, timeout))
        if self.error:
            raise self.error
        return (
            self.response
            if self.response is not None
            else [{"word": "made", "score": 900}, {"word": "shade", "score": 800}]
        )


def enable(client, on=True):
    return client.put("/api/lexicon/online/settings", json={"enabled": on})


def ask(client, word="fade", kind="rhymes", **kw):
    return client.get("/api/lexicon/online/words", params={"word": word, "kind": kind, **kw})


# ------------------------------------------------------------------ off by default, and what is sent


def test_nothing_is_sent_while_it_is_off(client, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(online, "http_get", rec)
    r = ask(client)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "ONLINE_OFF"
    assert rec.urls == []


def test_turning_it_on_and_off_is_remembered(client):
    assert client.get("/api/lexicon/online/status").json()["enabled"] is False
    assert enable(client).json()["enabled"] is True
    assert client.get("/api/lexicon/online/status").json()["enabled"] is True
    assert enable(client, False).json()["enabled"] is False


def test_only_the_single_word_leaves_the_computer(client, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(online, "http_get", rec)
    enable(client)
    r = ask(client, "Fade", "rhymes").json()
    ((url, timeout),) = rec.urls
    assert (
        url == "https://api.datamuse.com/words?rel_rhy=fade&max=30"
    )  # nothing else: no lyrics, no title, no id
    assert timeout == online.TIMEOUT_SECONDS <= 5
    assert r["online"] is True and r["sent"] == "Only the word “fade” was sent."
    assert r["source"].startswith("Datamuse") and [x["word"] for x in r["results"]] == [
        "made",
        "shade",
    ]
    assert r["query"] == {"word": "fade", "kind": "rhymes"}


@pytest.mark.parametrize(
    "kind,param",
    [
        ("related", "ml"),
        ("associated", "rel_trg"),
        ("rhymes", "rel_rhy"),
        ("near-rhymes", "rel_nry"),
    ],
)
def test_each_kind_maps_to_the_right_question(client, monkeypatch, kind, param):
    rec = Recorder()
    monkeypatch.setattr(online, "http_get", rec)
    enable(client)
    ask(client, "rain", kind, limit=10)
    assert f"{param}=rain&max=10" in rec.urls[0][0]


def test_bad_requests_are_refused_before_anything_is_sent(client, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(online, "http_get", rec)
    enable(client)
    assert ask(client, kind="everything").status_code == 422
    assert ask(client, word="two words").status_code == 422
    assert ask(client, word="a;b").status_code == 422
    assert ask(client, limit=500).status_code == 422
    assert rec.urls == []


def test_the_address_can_be_pointed_elsewhere_for_testing(client, monkeypatch):
    monkeypatch.setenv("STUDIO_BARS_DATAMUSE_URL", "http://127.0.0.1:9999/")
    rec = Recorder()
    monkeypatch.setattr(online, "http_get", rec)
    enable(client)
    ask(client)
    assert rec.urls[0][0].startswith("http://127.0.0.1:9999/words?")


# ------------------------------------------------------------------ saved answers and working offline


def test_repeat_lookups_use_the_saved_answer(client, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(online, "http_get", rec)
    enable(client)
    first = ask(client).json()
    second = ask(client).json()
    assert len(rec.urls) == 1
    assert second["from_cache"] is True and second["online"] is False and not second["stale"]
    assert "Nothing was sent" in second["sent"] and second["results"] == first["results"]
    assert client.get("/api/lexicon/online/status").json()["cached_answers"] == 1


def _age_cache(db_file, days):
    import sqlite3
    from datetime import UTC, datetime, timedelta

    c = sqlite3.connect(db_file)
    c.execute(
        "UPDATE online_cache SET fetched_at=?",
        ((datetime.now(UTC) - timedelta(days=days)).isoformat(),),
    )
    c.commit()
    c.close()


def test_offline_shows_saved_results_marked_as_saved(client, monkeypatch, db_file):
    monkeypatch.setattr(online, "http_get", Recorder())
    enable(client)
    ask(client)
    _age_cache(db_file, 30)  # too old to trust as fresh
    monkeypatch.setattr(
        online,
        "http_get",
        Recorder(error=OnlineError("offline", "Cannot reach the online word service.")),
    )
    r = ask(client)
    assert r.status_code == 200
    body = r.json()
    assert body["stale"] is True and body["online"] is False and body["results"]
    assert "Showing saved results" in body["notice"] and "Cannot reach" in body["notice"]


def test_offline_with_nothing_saved_is_a_clear_error_not_a_hang(client, monkeypatch):
    monkeypatch.setattr(
        online,
        "http_get",
        Recorder(error=OnlineError("offline", "Cannot reach the online word service.")),
    )
    enable(client)
    r = ask(client, "neverseen")
    assert r.status_code == 503 and r.json()["detail"]["code"] == "ONLINE_UNAVAILABLE"
    assert "Nothing saved" in r.json()["detail"]["message"]


def test_a_refusal_mentions_the_api_key_and_still_falls_back(client, monkeypatch, db_file):
    monkeypatch.setattr(online, "http_get", Recorder())
    enable(client)
    ask(client)
    _age_cache(db_file, 30)
    monkeypatch.setattr(
        online,
        "http_get",
        Recorder(
            error=OnlineError(
                "refused", "The word service refused the request. It may now need an API key."
            )
        ),
    )
    body = ask(client).json()
    assert body["stale"] and "API key" in body["notice"]
    assert (
        "API key" in client.get("/api/lexicon/online/status").json()["key_notice"]
        or "key" in client.get("/api/lexicon/online/status").json()["key_notice"]
    )


def test_stale_answers_are_refreshed_when_the_service_is_back(client, monkeypatch, db_file):
    monkeypatch.setattr(online, "http_get", Recorder(response=[{"word": "old"}]))
    enable(client)
    ask(client)
    _age_cache(db_file, 30)
    monkeypatch.setattr(online, "http_get", Recorder(response=[{"word": "new"}]))
    body = ask(client).json()
    assert body["online"] and body["results"][0]["word"] == "new" and not body["stale"]


# ------------------------------------------------------------------ rate limit, junk, cache size


def test_rate_limiter_with_a_fake_clock():
    t = [0.0]
    rl = RateLimiter(capacity=3, per_second=1.0, clock=lambda: t[0])
    assert [rl.allow() for _ in range(4)] == [True, True, True, False]
    t[0] += 2.0
    assert [rl.allow() for _ in range(3)] == [True, True, False]
    t[0] += 1000
    assert sum(rl.allow() for _ in range(10)) == 3  # never more than the burst size


def test_too_many_lookups_are_slowed_down_not_sent(client, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(online, "http_get", rec)
    monkeypatch.setattr(online, "limiter", RateLimiter(capacity=2, per_second=0.0001))
    enable(client)
    assert ask(client, "one").status_code == 200 and ask(client, "two").status_code == 200
    third = ask(client, "three")
    assert third.status_code == 429 and third.json()["detail"]["code"] == "RATE_LIMITED"
    assert len(rec.urls) == 2
    assert ask(client, "one").status_code == 200  # saved answers are never blocked


def test_junk_in_the_answer_is_dropped(client, monkeypatch):
    junk = [
        {"word": "<script>alert(1)</script>"},
        {"word": "x" * 200},
        {"word": 5},
        "string",
        {"nope": 1},
        {"word": "fine", "score": 3},
        {"word": "ok-word"},
    ]
    monkeypatch.setattr(online, "http_get", Recorder(response=junk))
    enable(client)
    assert [x["word"] for x in ask(client).json()["results"]] == ["fine", "ok-word"]
    monkeypatch.setattr(online, "http_get", Recorder(response={"not": "a list"}))
    assert ask(client, "other").json()["results"] == []


def test_the_saved_answers_stay_a_sensible_size(client, monkeypatch):
    monkeypatch.setattr(online, "http_get", Recorder())
    monkeypatch.setattr(online, "MAX_CACHE", 3)
    enable(client)
    for w in ("aa", "bb", "cc", "dd", "ee"):
        ask(client, w)
    assert client.get("/api/lexicon/online/status").json()["cached_answers"] == 3


# ------------------------------------------------------------------ the real network code, against a local test server


class _Handler(BaseHTTPRequestHandler):
    mode = "ok"
    seen: list = []

    def do_GET(self):  # noqa: N802
        _Handler.seen.append((self.path, dict(self.headers)))
        if _Handler.mode == "slow":
            time.sleep(1.5)
        if _Handler.mode in ("403", "429", "500"):
            self.send_response(int(_Handler.mode))
            self.end_headers()
            return
        body = (
            b"not json"
            if _Handler.mode == "garbage"
            else json.dumps([{"word": "made", "score": 1}]).encode()
        )
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def log_message(self, *a):
        pass


@pytest.fixture()
def local_server():
    srv = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    _Handler.seen, _Handler.mode = [], "ok"
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_real_request_is_a_plain_get_with_no_secrets(local_server):
    assert online.http_get(f"{local_server}/words?rel_rhy=fade&max=3", 3)[0]["word"] == "made"
    path, headers = _Handler.seen[0]
    lower = {k.lower() for k in headers}
    assert path == "/words?rel_rhy=fade&max=3"
    assert headers["User-Agent"].startswith("StudioBars/")
    assert not ({"authorization", "cookie", "x-api-key"} & lower)


@pytest.mark.parametrize(
    "mode,reason", [("403", "refused"), ("429", "busy"), ("500", "server"), ("garbage", "bad")]
)
def test_real_errors_are_translated(local_server, mode, reason):
    _Handler.mode = mode
    with pytest.raises(OnlineError) as e:
        online.http_get(f"{local_server}/words?ml=x", 3)
    assert e.value.reason == reason


def test_real_timeout_and_refused_connection_are_offline(local_server):
    _Handler.mode = "slow"
    t = time.time()
    with pytest.raises(OnlineError) as e:
        online.http_get(f"{local_server}/words?ml=x", 0.3)
    assert (
        e.value.reason == "offline" and time.time() - t < 1.2
    )  # gave up quickly instead of freezing
    with pytest.raises(OnlineError) as e2:
        online.http_get("http://127.0.0.1:1/words?ml=x", 1)
    assert e2.value.reason == "offline"


def test_end_to_end_through_the_api_against_the_local_server(client, local_server, monkeypatch):
    monkeypatch.setenv("STUDIO_BARS_DATAMUSE_URL", local_server)
    enable(client)
    r = ask(client, "fade").json()
    assert r["online"] and r["results"][0]["word"] == "made"
    _Handler.mode = "500"
    monkeypatch.setattr(online, "FRESH_DAYS", 0)
    r2 = ask(client, "fade").json()  # service now failing: saved answer is shown
    assert r2["stale"] and "Showing saved results" in r2["notice"]
