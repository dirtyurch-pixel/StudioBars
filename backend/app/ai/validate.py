"""Checks what the AI sent back. Anything odd is dropped; if nothing usable is left, nothing is shown."""

from __future__ import annotations

import json
import re

from ..schemas import MAX_LINE_CHARS

MAX_CANDIDATES = 6
MAX_NOTES = 8
MAX_NOTE_CHARS = 600
_BULLET = re.compile(r"^\s*(?:[-*•–—]+|\d{1,2}[.):]|\(\d{1,2}\))\s+")
_QUOTES = "\"'“”‘’`«»"
_META = re.compile(
    r"^\s*(?:\[.*\]|\(.*\)$|(?:verse|chorus|hook|bridge|intro|outro|pre-?chorus|line|option|candidate|suggestion)\s*\d*\s*[:\-])",
    re.I,
)
_MARKDOWN = re.compile(r"(\*\*|__|^#+\s|```|\|)")


def extract_json(text: str):
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.I)
    try:
        return json.loads(t)
    except ValueError:
        pass
    a, b = t.find("{"), t.rfind("}")
    if a != -1 and b > a:
        try:
            return json.loads(t[a : b + 1])
        except ValueError:
            return None
    return None


def clean_line(raw) -> str | None:
    if not isinstance(raw, str):
        return None
    t = raw.strip()
    if "\n" in t or "\r" in t:
        return None
    t = _BULLET.sub("", t).strip()
    while len(t) >= 2 and t[0] in _QUOTES and t[-1] in _QUOTES:
        t = t[1:-1].strip()
    t = t.strip(_QUOTES + " ")
    if not t or len(t) > MAX_LINE_CHARS or len(t) < 2:
        return None
    if _META.match(t) or _MARKDOWN.search(t) or "<" in t or ">" in t:
        return None
    if not re.search(r"[A-Za-z]", t):
        return None
    return t


def parse_lines(text: str, existing: set[str], limit: int) -> list[dict]:
    data = extract_json(text)
    items = data.get("suggestions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    seen = {e.strip().lower() for e in existing}
    out: list[dict] = []
    for it in items:
        raw = it.get("text") if isinstance(it, dict) else it
        t = clean_line(raw)
        if t is None or t.lower() in seen:
            continue
        seen.add(t.lower())
        reason = it.get("reason", "") if isinstance(it, dict) else ""
        reason = " ".join(reason.split())[:160] if isinstance(reason, str) else ""
        out.append({"text": t, "reason": reason})
        if len(out) >= min(limit, MAX_CANDIDATES):
            break
    return out


def parse_notes(text: str) -> list[str]:
    data = extract_json(text)
    items = data.get("notes") if isinstance(data, dict) else None
    if isinstance(items, str):
        items = [items]
    if not isinstance(items, list):
        return []
    out = []
    for it in items:
        if isinstance(it, str) and it.strip():
            out.append(" ".join(_MARKDOWN.sub("", it).split())[:MAX_NOTE_CHARS])
        if len(out) >= MAX_NOTES:
            break
    return out


def parse_improvements(text: str, section_lines: list[dict], limit: int) -> list[dict]:
    """'Improve my lines' answers: each names a line NUMBER in the current section. Locked, empty, unknown or
    unchanged lines are dropped; one suggestion per line."""
    data = extract_json(text)
    items = data.get("suggestions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    used: set[str] = set()
    for it in items:
        if not isinstance(it, dict):
            continue
        n = it.get("line")
        if isinstance(n, str) and n.strip().isdigit():
            n = int(n.strip())
        if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= len(section_lines):
            continue
        ln = section_lines[n - 1]
        if ln["is_locked"] or not ln["text"].strip() or ln["id"] in used:
            continue
        t = clean_line(it.get("text"))
        if t is None or t.strip().lower() == ln["text"].strip().lower():
            continue
        reason = it.get("reason", "")
        reason = " ".join(reason.split())[:160] if isinstance(reason, str) else ""
        used.add(ln["id"])
        out.append({"text": t, "reason": reason, "line_id": ln["id"]})
        if len(out) >= min(limit, MAX_CANDIDATES):
            break
    return out
