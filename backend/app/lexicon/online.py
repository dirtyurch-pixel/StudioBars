"""Optional online word helper (Datamuse, https://www.datamuse.com/api/).

Rules this module enforces:
- Off until the user turns it on. Nothing is ever sent while it is off.
- Only ONE word, typed or selected by the user, is sent. Never lyrics, never a song title.
- Short timeout, a rate limit, and a saved copy of every answer so repeats cost nothing.
- If the service is unreachable or refuses, saved answers are shown (marked as saved) instead of an error.

Datamuse says an API key will be required from 1 February 2027. Their public page does not say how a key
is passed, so none is sent: when the service refuses us, the user is told and saved answers keep working.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from urllib.parse import urlparse

from ..db import tx
from ..service import ApiError, now

KINDS = {
    "related": "ml",
    "associated": "rel_trg",
    "sounds-like": "sl",
    "rhymes": "rel_rhy",
    "near-rhymes": "rel_nry",
}
FRESH_DAYS = 7
MAX_CACHE = 5000
TIMEOUT_SECONDS = 4.0
OK_WORD = re.compile(r"^[A-Za-z][A-Za-z' -]{0,58}$")
SETTING = "online_helper_enabled"
USER_AGENT = "StudioBars/0.4 (personal songwriting app; word lookups only)"


def base_url() -> str:
    return os.environ.get("STUDIO_BARS_DATAMUSE_URL", "https://api.datamuse.com").rstrip("/")


def host_label() -> str:
    return urlparse(base_url()).netloc


class OnlineError(Exception):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason, self.message = reason, message


def http_get(url: str, timeout: float) -> list:
    """The one place that talks to the internet. Tests replace this function."""
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - fixed https host
            return json.loads(r.read(2_000_000).decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 402, 403):
            raise OnlineError(
                "refused", "The word service refused the request. It may now need an API key."
            ) from e
        if e.code == 429:
            raise OnlineError("busy", "The word service is asking us to slow down.") from e
        raise OnlineError("server", f"The word service had a problem (HTTP {e.code}).") from e
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        raise OnlineError("offline", "Cannot reach the online word service.") from e
    except ValueError as e:
        raise OnlineError("bad", "The word service sent something unexpected.") from e


class RateLimiter:
    """At most `capacity` quick requests, then about `per_second` per second."""

    def __init__(self, capacity: int = 10, per_second: float = 2.0, clock=time.monotonic):
        self.capacity, self.per_second, self.clock = capacity, per_second, clock
        self.tokens, self.last = float(capacity), clock()
        self.lock = threading.Lock()

    def allow(self) -> bool:
        with self.lock:
            t = self.clock()
            self.tokens = min(self.capacity, self.tokens + (t - self.last) * self.per_second)
            self.last = t
            if self.tokens >= 1:
                self.tokens -= 1
                return True
            return False


limiter = RateLimiter()


# ---------------------------------------------------------------- settings & cache


def is_enabled(conn) -> bool:
    r = conn.execute("SELECT value FROM app_settings WHERE key=?", (SETTING,)).fetchone()
    return bool(r) and r["value"] == "1"


def set_enabled(conn, enabled: bool) -> None:
    with tx(conn):
        conn.execute(
            "INSERT INTO app_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (SETTING, "1" if enabled else "0"),
        )


def status(conn) -> dict:
    return {
        "enabled": is_enabled(conn),
        "service": "Datamuse",
        "host": host_label(),
        "cached_answers": conn.execute("SELECT COUNT(*) FROM online_cache").fetchone()[0],
        "sends": "Only the single word you look up. Never your lyrics or song titles.",
        "key_notice": "Datamuse has announced that an API key will be required from 1 February 2027.",
    }


def _cache_get(conn, key: str):
    return conn.execute("SELECT body, fetched_at FROM online_cache WHERE key=?", (key,)).fetchone()


def _cache_put(conn, key: str, body: list) -> str:
    ts = now()
    with tx(conn):
        conn.execute(
            "INSERT INTO online_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, fetched_at=excluded.fetched_at",
            (key, json.dumps(body), ts),
        )
        conn.execute(
            "DELETE FROM online_cache WHERE key NOT IN (SELECT key FROM online_cache ORDER BY fetched_at DESC LIMIT ?)",
            (MAX_CACHE,),
        )
    return ts


def _age_days(iso: str) -> float:
    return (datetime.now(UTC) - datetime.fromisoformat(iso)).total_seconds() / 86400


def _clean(raw: list, limit: int) -> list[dict]:
    out = []
    for item in raw if isinstance(raw, list) else []:
        w = item.get("word") if isinstance(item, dict) else None
        if isinstance(w, str) and OK_WORD.match(w):
            out.append(
                {
                    "word": w,
                    "score": item.get("score") if isinstance(item.get("score"), int) else None,
                }
            )
        if len(out) >= limit:
            break
    return out


def words(conn, word: str, kind: str, limit: int = 30) -> dict:
    if kind not in KINDS:
        raise ApiError(422, "BAD_KIND", f"Kind must be one of: {', '.join(KINDS)}.")
    if not is_enabled(conn):
        raise ApiError(
            403,
            "ONLINE_OFF",
            "The online word helper is switched off. Turn it on first if you want it.",
        )
    key = f"{kind}:{word.lower()}:{limit}"
    cached = _cache_get(conn, key)

    def reply(body: list, fetched_at: str, live: bool, stale: bool, notice: str | None) -> dict:
        return {
            "source": "Datamuse (online word service)",
            "online": live,
            "from_cache": not live,
            "stale": stale,
            "fetched_at": fetched_at,
            "query": {"word": word, "kind": kind},
            "sent": f"Only the word “{word}” was sent."
            if live
            else "Nothing was sent: this is a saved answer.",
            "results": _clean(body, limit),
            "notice": notice,
        }

    if cached and _age_days(cached["fetched_at"]) < FRESH_DAYS:
        return reply(json.loads(cached["body"]), cached["fetched_at"], False, False, None)

    def fallback(why: str, status_code: int, code: str) -> dict:
        if cached:
            return reply(
                json.loads(cached["body"]),
                cached["fetched_at"],
                False,
                True,
                f"{why} Showing saved results from {cached['fetched_at'][:10]}.",
            )
        raise ApiError(status_code, code, why + " Nothing saved for this word yet.")

    if not limiter.allow():
        return fallback("Too many lookups at once.", 429, "RATE_LIMITED")
    url = f"{base_url()}/words?{urllib.parse.urlencode({KINDS[kind]: word, 'max': limit})}"
    try:
        body = http_get(url, TIMEOUT_SECONDS)
    except OnlineError as e:
        return fallback(e.message, 503, "ONLINE_UNAVAILABLE")
    fetched_at = _cache_put(conn, key, body if isinstance(body, list) else [])
    return reply(body if isinstance(body, list) else [], fetched_at, True, False, None)
