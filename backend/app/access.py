"""Optional PIN lock for when the app is opened from another device (phone, tablet).

If STUDIO_BARS_ACCESS_PIN is not set, nothing changes (local use, no lock).
If it is set, every /api call needs the sign-in cookie, which is only given for the right PIN.
Wrong guesses are slowed down. The PIN itself is never stored in the browser (only a keyed hash).
"""

from __future__ import annotations

import hashlib
import hmac
import os
from typing import Annotated

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, StringConstraints

from .ai.budget import RateLimiter
from .service import ApiError

COOKIE = "sb_session"
router = APIRouter(prefix="/api/auth")
_guesses = RateLimiter(
    capacity=5, per_second=1 / 12
)  # 5 quick tries, then about one every 12 seconds


def pin() -> str:
    return os.environ.get("STUDIO_BARS_ACCESS_PIN", "").strip()


def token(p: str) -> str:
    return hmac.new(p.encode(), b"studio-bars-session-v1", hashlib.sha256).hexdigest()


def is_ok(request: Request) -> bool:
    p = pin()
    if not p:
        return True
    return hmac.compare_digest(request.cookies.get(COOKIE, ""), token(p))


class LoginIn(BaseModel):
    pin: Annotated[str, StringConstraints(max_length=100)]


@router.get("/status")
def status(request: Request):
    return {"required": bool(pin()), "ok": is_ok(request)}


@router.post("/login")
def login(body: LoginIn, response: Response):
    p = pin()
    if not p:
        return {"required": False, "ok": True}
    if not _guesses.allow():
        raise ApiError(429, "SLOW_DOWN", "Too many tries. Wait a few seconds and try again.")
    if not hmac.compare_digest(body.pin.encode(), p.encode()):
        raise ApiError(401, "BAD_PIN", "That PIN is not right.")
    response.set_cookie(COOKIE, token(p), max_age=60 * 60 * 24 * 30, httponly=True, samesite="lax")
    return {"required": True, "ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}
