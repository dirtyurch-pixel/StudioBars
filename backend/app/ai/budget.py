"""The monthly spending limit and the usage log."""

from __future__ import annotations

import threading
import time
from datetime import UTC, datetime

from ..db import tx
from ..service import ApiError, new_id, now

DEFAULTS = {
    "ai_enabled": "0",
    "ai_provider": "anthropic",
    "ai_model": "claude-opus-5-5",
    "ai_base_url": "",
    "ai_cap_usd": "5.00",
    "ai_price_in": "0",
    "ai_price_out": "0",
}


def get_setting(conn, key: str) -> str:
    r = conn.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else DEFAULTS[key]


def set_settings(conn, values: dict[str, str]) -> None:
    with tx(conn):
        for k, v in values.items():
            conn.execute(
                "INSERT INTO app_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, v),
            )


def month_key(dt: datetime | None = None) -> str:
    return (dt or datetime.now(UTC)).strftime("%Y-%m")


def month_totals(conn) -> dict:
    r = conn.execute(
        "SELECT COALESCE(SUM(cost_usd),0) s, COUNT(*) n FROM ai_usage WHERE month=?", (month_key(),)
    ).fetchone()
    cap = float(get_setting(conn, "ai_cap_usd"))
    spent = round(r["s"], 6)
    return {
        "month": month_key(),
        "spent_usd": spent,
        "requests": r["n"],
        "cap_usd": cap,
        "remaining_usd": round(max(0.0, cap - spent), 6),
    }


def record(
    conn, provider: str, model: str, task: str, in_t: int, out_t: int, cost_usd: float, ok: bool
) -> None:
    with tx(conn):
        conn.execute(
            "INSERT INTO ai_usage VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                new_id(),
                now(),
                month_key(),
                provider,
                model,
                task,
                in_t,
                out_t,
                cost_usd,
                1 if ok else 0,
            ),
        )


def check_budget(conn, worst_case_usd: float) -> None:
    """Refuse BEFORE sending if this request could take the month past the limit."""
    t = month_totals(conn)
    if t["spent_usd"] + worst_case_usd > t["cap_usd"] + 1e-9:
        raise ApiError(
            402, "BUDGET_REACHED",
            f"This would go over your monthly AI limit (${t['cap_usd']:.2f}; used ${t['spent_usd']:.2f} so far). "
            "Nothing was sent. You can raise the limit in the AI tab.",
            spent_usd=t["spent_usd"], cap_usd=t["cap_usd"],
        )  # fmt: skip


class RateLimiter:
    """A few quick requests, then one every couple of seconds: stops a runaway loop, never a person."""

    def __init__(self, capacity: int = 6, per_second: float = 0.5, clock=time.monotonic):
        self.capacity, self.per_second, self.clock = capacity, per_second, clock
        self.tokens, self.last, self.lock = float(capacity), clock(), threading.Lock()

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
