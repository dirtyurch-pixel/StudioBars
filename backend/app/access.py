"""Optional PIN lock for when the app is opened from another device (phone, tablet).

- No PIN set: the API only answers this computer itself (loopback). Other devices are refused.
- PIN set (6+ characters): every /api call needs a sign-in cookie. Signing in creates a RANDOM session token;
  the server keeps only its SHA-256, with an expiry. Signing out cancels it on the server, and changing the PIN
  cancels every session. Wrong guesses are slowed down.
- The cookie is marked Secure when the app is reached over https (directly or through a proxy that says so).
Sessions live in memory: restarting the server signs everyone out.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import threading
import time
from typing import Annotated

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, StringConstraints

from .ai.budget import RateLimiter
from .service import ApiError

COOKIE = "sb_session"
MIN_PIN = 6
SESSION_SECONDS = 30 * 24 * 3600
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}
router = APIRouter(prefix="/api/auth")
_guesses = RateLimiter(
    capacity=5, per_second=1 / 12
)  # 5 quick tries, then about one every 12 seconds

_lock = threading.Lock()
_sessions: dict[
    str, tuple[float, str]
] = {}  # sha256(token) -> (expires at, which PIN it was made with)


def pin() -> str:
    return os.environ.get("STUDIO_BARS_ACCESS_PIN", "").strip()


def _digest(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()


def pin_too_short() -> bool:
    p = pin()
    return bool(p) and len(p) < MIN_PIN


def _is_loopback(request: Request) -> bool:
    host = request.client.host if request.client else ""
    return host in LOOPBACK or host.startswith("127.")


def _secure(request: Request) -> bool:
    return (
        request.url.scheme == "https"
        or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
    )


def is_ok(request: Request) -> bool:
    p = pin()
    if not p:
        return _is_loopback(request)  # no PIN: only this computer may use the API
    if len(p) < MIN_PIN:
        return False
    tok = request.cookies.get(COOKIE, "")
    if not tok:
        return False
    key = _digest(tok)
    now = time.time()
    with _lock:
        hit = _sessions.get(key)
        if not hit:
            return False
        expires, made_with = hit
        if expires < now or not hmac.compare_digest(made_with, _digest(p)):
            _sessions.pop(key, None)
            return False
    return True


def refusal(request: Request) -> tuple[str, str]:
    """Why a request was refused, in words for the person."""
    if not pin() and not _is_loopback(request):
        return (
            "PIN_NOT_SET",
            "Studio Bars only opens on this computer until a PIN is set. Start it with a PIN to use it from another device.",
        )
    if pin_too_short():
        return (
            "PIN_TOO_SHORT",
            f"The PIN set on the computer is too short. Use at least {MIN_PIN} characters.",
        )
    return ("PIN_REQUIRED", "Enter your PIN to open Studio Bars.")


class LoginIn(BaseModel):
    pin: Annotated[str, StringConstraints(max_length=100)]


@router.get("/status")
def status(request: Request):
    return {"required": bool(pin()), "ok": is_ok(request)}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response):
    p = pin()
    if not p:
        if not _is_loopback(request):
            code, msg = refusal(request)
            raise ApiError(403, code, msg)
        return {"required": False, "ok": True}
    if len(p) < MIN_PIN:
        code, msg = refusal(request)
        raise ApiError(403, code, msg)
    if not _guesses.allow():
        raise ApiError(429, "SLOW_DOWN", "Too many tries. Wait a few seconds and try again.")
    if not hmac.compare_digest(body.pin.encode(), p.encode()):
        raise ApiError(401, "BAD_PIN", "That PIN is not right.")
    tok = secrets.token_urlsafe(32)
    now = time.time()
    with _lock:
        for k in [k for k, (exp, _) in _sessions.items() if exp < now]:
            del _sessions[k]
        _sessions[_digest(tok)] = (now + SESSION_SECONDS, _digest(p))
    response.set_cookie(
        COOKIE,
        tok,
        max_age=SESSION_SECONDS,
        httponly=True,
        samesite="lax",
        secure=_secure(request),
    )
    return {"required": True, "ok": True}


@router.post("/logout")
def logout(request: Request, response: Response):
    tok = request.cookies.get(COOKIE, "")
    if tok:
        with _lock:
            _sessions.pop(
                _digest(tok), None
            )  # cancelled on the server, not just forgotten by this browser
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.post("/logout-everywhere")
def logout_everywhere(request: Request, response: Response):
    if not is_ok(request):
        code, msg = refusal(request)
        raise ApiError(401, code, msg)
    with _lock:
        _sessions.clear()
    response.delete_cookie(COOKIE)
    return {"ok": True}
