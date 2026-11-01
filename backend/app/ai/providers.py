"""Talking to the AI. Plain-English errors; the key is never put into a message."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

from ..service import ApiError

log = logging.getLogger("studio_bars.ai")
# The libraries print whole requests (your lyrics) when debugging is on. Keep them quiet.
for _name in ("anthropic", "httpx", "httpcore", "httpx2", "httpcore2"):
    logging.getLogger(_name).setLevel(logging.WARNING)

DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com"
TIMEOUT_SECONDS = 90.0


@dataclass
class Reply:
    text: str
    input_tokens: int
    output_tokens: int
    stop: str


def anthropic_url() -> str:
    return os.environ.get("STUDIO_BARS_AI_ANTHROPIC_URL", "").strip() or DEFAULT_ANTHROPIC_URL


def _fail(status: int, code: str, message: str) -> ApiError:
    return ApiError(status, code, message)


def call_anthropic(key: str, model: str, system: str, user: str, max_tokens: int) -> Reply:
    import anthropic

    client = anthropic.Anthropic(
        api_key=key, base_url=anthropic_url(), timeout=TIMEOUT_SECONDS, max_retries=1
    )
    kwargs: dict = {}
    if "haiku" not in model:
        kwargs["output_config"] = {"effort": "low"}  # lyrics are short: no need for deep reasoning
    try:
        msg = client.messages.create(
            model=model, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": user}], **kwargs,
        )  # fmt: skip
    except anthropic.APITimeoutError:
        raise _fail(
            504, "AI_TIMEOUT", "The AI took too long to answer. Nothing was changed. Try again."
        ) from None
    except anthropic.APIConnectionError:
        raise _fail(
            503,
            "AI_OFFLINE",
            "Could not reach the AI. Check your internet. Your lyrics are safe and nothing was changed.",
        ) from None
    except anthropic.APIStatusError as e:
        raise _status_error(e.status_code, str(getattr(e, "message", ""))) from None
    except Exception:  # noqa: BLE001 - never leak details (they could contain request data)
        log.warning("ai unexpected error (anthropic)")
        raise _fail(
            502, "AI_ERROR", "The AI had a problem. Nothing was changed. Try again."
        ) from None
    if msg.stop_reason == "refusal":
        raise _fail(
            422,
            "AI_REFUSED",
            "The AI declined to answer that. Nothing was changed. Try different wording.",
        )
    text = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text")
    return Reply(text, msg.usage.input_tokens, msg.usage.output_tokens, msg.stop_reason or "")


def _status_error(status: int, message: str) -> ApiError:
    low = message.lower()
    if status == 401:
        return _fail(
            502,
            "AI_KEY_REJECTED",
            "The AI did not accept your key. Check it in the AI tab and paste it again.",
        )
    if status == 402 or "credit balance" in low or "billing" in low:
        return _fail(
            502,
            "AI_BILLING",
            "Your AI account has no credit left or a billing problem. Check your account with the provider.",
        )
    if status == 403:
        return _fail(
            502,
            "AI_FORBIDDEN",
            "Your key is not allowed to use this model. Pick another model or check your key's permissions.",
        )
    if status == 404:
        return _fail(
            502,
            "AI_MODEL_MISSING",
            "The AI could not find that model. Pick another model in the AI tab.",
        )
    if status == 429:
        return _fail(503, "AI_BUSY", "The AI is rate-limiting you. Wait a minute and try again.")
    if status >= 500:
        return _fail(
            503,
            "AI_DOWN",
            "The AI service is having trouble right now. Try again in a moment. Nothing was changed.",
        )
    return _fail(502, "AI_ERROR", "The AI could not do that request. Nothing was changed.")


def call_openai_compat(
    base_url: str, key: str | None, model: str, system: str, user: str, max_tokens: int
) -> Reply:
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    body = {
        "model": model, "max_tokens": max_tokens, "temperature": 0.8,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }  # fmt: skip
    try:
        r = httpx.post(url, json=body, headers=headers, timeout=TIMEOUT_SECONDS)
    except httpx.TimeoutException:
        raise _fail(
            504, "AI_TIMEOUT", "The AI took too long to answer. Nothing was changed. Try again."
        ) from None
    except httpx.HTTPError:
        raise _fail(
            503,
            "AI_OFFLINE",
            "Could not reach the AI at that address. Is it running? Nothing was changed.",
        ) from None
    if r.status_code >= 400:
        raise _status_error(r.status_code, "")
    try:
        data = r.json()
        text = data["choices"][0]["message"]["content"] or ""
        usage = data.get("usage") or {}
        stop = data["choices"][0].get("finish_reason") or ""
    except (ValueError, KeyError, IndexError, TypeError):
        raise _fail(
            502, "BAD_AI_ANSWER", "The AI sent something unreadable. Nothing was changed."
        ) from None
    return Reply(
        text, int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0), stop
    )
