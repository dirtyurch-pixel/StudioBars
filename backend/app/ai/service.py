"""AI co-writer logic. It READS the song and PROPOSES lines. It never writes to songs, sections or lines."""

from __future__ import annotations

import json
import logging

from ..db import tx
from ..phonetics import engine
from ..phonetics.engine import classify
from ..phonetics.words import Resolver, analyze_lines, tokenize
from ..phonetics_routes import load_custom
from ..service import ApiError, load_song, new_id, now
from . import budget, keystore, pricing, prompts, providers, validate

log = logging.getLogger("studio_bars.ai")
PROVIDER_LABELS = {
    "anthropic": "Claude (Anthropic)",
    "openai_compat": "Other / local (OpenAI-compatible, e.g. Ollama)",
}


def _settings(conn) -> dict:
    g = lambda k: budget.get_setting(conn, k)  # noqa: E731
    return {
        "enabled": g("ai_enabled") == "1",
        "provider": g("ai_provider"),
        "model": g("ai_model"),
        "base_url": g("ai_base_url"),
        "cap_usd": float(g("ai_cap_usd")),
        "price_in": float(g("ai_price_in")),
        "price_out": float(g("ai_price_out")),
    }


def status(conn) -> dict:
    s = _settings(conn)
    models = []
    for mid, m in pricing.MODELS.items():
        est = pricing.cost(pricing.TYPICAL_IN, pricing.TYPICAL_OUT, m["in"], m["out"])
        models.append({"id": mid, "label": m["label"], "typical_request_usd": round(est, 4)})
    return {
        **s,
        "key": keystore.status(s["provider"]),
        "usage": budget.month_totals(conn),
        "models": models,
        "providers": [{"id": k, "label": v} for k, v in PROVIDER_LABELS.items()],
        "tasks": [{"id": k, "label": v["label"], "kind": v["kind"], "needs_line": v["target"], "needs_rhyme": bool(v.get("rhyme")), "whole_song": bool(v.get("whole"))} for k, v in prompts.TASKS.items()],
        "personas": [{"id": k, "label": v["label"], "text": v["text"]} for k, v in prompts.PERSONAS.items()],
        "ready": _ready(s),
        "disclosure": (
            "When you press Send, the text shown in “What will be sent” (your title, genres and the lines of the sections listed) "
            "goes over the internet to the AI company you chose. Nothing is sent before you press Send. Your key stays on this computer."
        ),
    }  # fmt: skip


def _ready(s: dict) -> bool:
    if not s["enabled"]:
        return False
    if s["provider"] == "anthropic":
        return bool(keystore.get_key("anthropic")[0])
    return bool(s["base_url"])


def update_settings(conn, data: dict) -> dict:
    cur = _settings(conn)
    provider = data.get("provider", cur["provider"])
    if provider not in keystore.PROVIDERS:
        raise ApiError(422, "BAD_SETTING", "Unknown AI provider.")
    model = (data.get("model", cur["model"]) or "").strip()
    base_url = (data.get("base_url", cur["base_url"]) or "").strip()
    if provider == "anthropic":
        if model not in pricing.MODELS:
            raise ApiError(422, "BAD_SETTING", "Pick one of the listed Claude models.")
        base_url = ""
    else:
        if not model or len(model) > 100:
            raise ApiError(422, "BAD_SETTING", "Enter the model name your AI server uses.")
        if base_url and not base_url.startswith(("http://", "https://")):
            raise ApiError(
                422, "BAD_SETTING", "The server address must start with http:// or https://"
            )
    cap = data.get("cap_usd", cur["cap_usd"])
    if not isinstance(cap, int | float) or cap < 0 or cap > 1000:
        raise ApiError(422, "BAD_SETTING", "The monthly limit must be between $0 and $1000.")
    pi, po = data.get("price_in", cur["price_in"]), data.get("price_out", cur["price_out"])
    if not all(isinstance(x, int | float) and 0 <= x <= 1000 for x in (pi, po)):
        raise ApiError(
            422,
            "BAD_SETTING",
            "Prices must be numbers (dollars per million words-pieces), 0 or more.",
        )
    enabled = bool(data.get("enabled", cur["enabled"]))
    budget.set_settings(conn, {
        "ai_enabled": "1" if enabled else "0", "ai_provider": provider, "ai_model": model,
        "ai_base_url": base_url, "ai_cap_usd": f"{float(cap):.2f}", "ai_price_in": str(pi), "ai_price_out": str(po),
    })  # fmt: skip
    return status(conn)


def _require_ready(conn) -> dict:
    s = _settings(conn)
    if not s["enabled"]:
        raise ApiError(403, "AI_OFF", "AI is switched off. Turn it on in the AI tab first.")
    if not _ready(s):
        raise ApiError(
            409, "AI_NOT_SETUP", "Add your AI key (or server address) in the AI tab first."
        )
    return s


def _plan(conn, req: dict) -> tuple[dict, dict, dict]:
    s = _require_ready(conn)
    song = load_song(conn, req["song_id"])
    p = prompts.build(song, req)
    pi, po = pricing.prices(s["model"], s["price_in"], s["price_out"])
    est_in = pricing.estimate_tokens(p["system"] + p["user"])
    p["est_in"] = est_in
    p["est_cost"] = pricing.cost(est_in, p["max_tokens"] // 2, pi, po)
    p["worst_cost"] = pricing.cost(est_in, p["max_tokens"], pi, po)
    p["prices"] = (pi, po)
    return s, song, p


def prepare(conn, req: dict) -> dict:
    """Show exactly what would be sent. No network, no charge, nothing saved."""
    s, _, p = _plan(conn, req)
    t = budget.month_totals(conn)
    return {
        "hash": prompts.prompt_hash(s["provider"], s["model"], s["base_url"], p),
        "provider": s["provider"],
        "model": s["model"],
        "system": p["system"],
        "user": p["user"],
        "sent": p["sent"],
        "est_input_tokens": p["est_in"],
        "max_output_tokens": p["max_tokens"],
        "est_cost_usd": round(p["est_cost"], 5),
        "worst_cost_usd": round(p["worst_cost"], 5),
        "over_budget": t["spent_usd"] + p["worst_cost"] > t["cap_usd"] + 1e-9,
        "usage": t,
    }


def _call(s: dict, p: dict) -> providers.Reply:
    if s["provider"] == "anthropic":
        key, _ = keystore.get_key("anthropic")
        return providers.call_anthropic(
            key or "", s["model"], p["system"], p["user"], p["max_tokens"]
        )
    key, _ = keystore.get_key("openai_compat")
    return providers.call_openai_compat(
        s["base_url"], key, s["model"], p["system"], p["user"], p["max_tokens"]
    )


def _spend(conn, s: dict, task: str, reply: providers.Reply, p: dict) -> float:
    in_t = reply.input_tokens or p["est_in"]
    out_t = reply.output_tokens or pricing.estimate_tokens(reply.text)
    pi, po = p["prices"]
    c = pricing.cost(in_t, out_t, pi, po)
    budget.record(conn, s["provider"], s["model"], task, in_t, out_t, c, True)
    return c


def _run(conn, req: dict, ack_hash: str) -> tuple[dict, dict, dict, providers.Reply]:
    s, song, p = _plan(conn, req)
    if prompts.prompt_hash(s["provider"], s["model"], s["base_url"], p) != ack_hash:
        raise ApiError(
            409,
            "CONTEXT_CHANGED",
            "The song changed since you looked at “What will be sent”. Please check it again.",
        )
    if not budget.limiter.allow():
        raise ApiError(
            429,
            "SLOW_DOWN",
            "That was a lot of requests very quickly. Wait a few seconds and try again.",
        )
    budget.check_budget(conn, p["worst_cost"])
    log.info(
        "ai request task=%s provider=%s model=%s est_in=%d",
        req["task"],
        s["provider"],
        s["model"],
        p["est_in"],
    )
    reply = providers.Reply("", 0, 0, "")
    reply = _call(s, p)
    return s, song, p, reply


def _analyse(conn, texts: list[str], target_text: str | None) -> list[dict]:
    resolver = Resolver(engine.get_dictionary(), load_custom(conn))
    ref_ph = None
    if target_text:
        toks = tokenize(target_text)
        if toks:
            info = resolver.lookup(toks[-1].norm)
            ref_ph = info.prons[0].phones if info.has_phones else None
    res = analyze_lines(texts, resolver)["lines"] if texts else []
    out = []
    for text, r in zip(texts, res, strict=True):
        quality = None
        toks = tokenize(text)
        if ref_ph and toks:
            info = resolver.lookup(toks[-1].norm)
            if info.has_phones:
                quality = classify(ref_ph, info.prons[0].phones)
        out.append({"syllables": r["syllables"], "rhymes_with_target": quality})
    return out


def suggest(conn, req: dict, ack_hash: str) -> dict:
    s, song, p, reply = _run(conn, req, ack_hash)
    cost = _spend(conn, s, req["task"], reply, p)
    usage = {
        "input_tokens": reply.input_tokens,
        "output_tokens": reply.output_tokens,
        "cost_usd": round(cost, 5),
    }
    totals = budget.month_totals(conn)
    base = {"kind": p["kind"], "model": s["model"], "usage": usage, "month": totals}
    if p["kind"] == "notes":
        notes = validate.parse_notes(reply.text)
        if not notes:
            raise ApiError(
                502,
                "BAD_AI_ANSWER",
                "The AI’s answer could not be used, so nothing was changed. You were charged for it; try again.",
                month=totals,
            )
        return {**base, "notes": notes, "suggestions": []}

    lines = {ln["id"]: ln for s_ in song["sections"] for ln in s_["lines"]}
    existing = {ln["text"] for ln in lines.values()}
    if p.get("improve"):
        sec_lines = [lines[i] for i in p["section_line_ids"]]
        cands = validate.parse_improvements(reply.text, sec_lines, p["count"])
    else:
        cands = validate.parse_lines(reply.text, existing, p["count"])
    if not cands:
        raise ApiError(
            502,
            "BAD_AI_ANSWER",
            "The AI’s answer could not be used, so nothing was changed. You were charged for it; try again.",
            month=totals,
        )
    ref_id = p["rhyme_id"] or p["target_id"]
    ref_text = lines[ref_id]["text"] if ref_id else None
    if p.get("improve"):
        # each improvement is compared with the line it replaces (does it keep the rhyme sound?)
        info = [_analyse(conn, [c["text"]], lines[c["line_id"]]["text"])[0] for c in cands]
    else:
        info = _analyse(
            conn, [c["text"] for c in cands], ref_text
        )  # numbers computed HERE, never trusted from the AI
    ctx = prompts.prompt_hash(s["provider"], s["model"], s["base_url"], p)
    out = []
    with tx(conn):
        for c, a in zip(cands, info, strict=True):
            sid = new_id()
            conn.execute(
                "INSERT INTO ai_suggestions (id,song_id,section_id,target_line_id,task,provider,model,context_hash,text,reason,settings_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (sid, req["song_id"], req["section_id"], c.get("line_id") or p["target_id"], req["task"], s["provider"], s["model"], ctx, c["text"], c["reason"], json.dumps({"count": p["count"]}), now()),
            )  # fmt: skip
            item = {"id": sid, "text": c["text"], "reason": c["reason"], **a}
            if c.get("line_id"):
                item["target_line_id"] = c["line_id"]
            out.append(item)
    return {**base, "suggestions": out, "notes": [], "target_line_id": p["target_id"]}


def accept(conn, suggestion_id: str) -> dict:
    with tx(conn):
        r = conn.execute("SELECT id FROM ai_suggestions WHERE id=?", (suggestion_id,)).fetchone()
        if r is None:
            raise ApiError(404, "NOT_FOUND", "Suggestion not found.")
        conn.execute(
            "UPDATE ai_suggestions SET accepted_at=? WHERE id=? AND accepted_at IS NULL",
            (now(), suggestion_id),
        )
    return {"ok": True}


def test_connection(conn) -> dict:
    s = _require_ready(conn)
    p = {
        "system": "Reply with the single word OK.",
        "user": "Reply with the single word OK.",
        "max_tokens": 20,
    }
    pi, po = pricing.prices(s["model"], s["price_in"], s["price_out"])
    p["est_in"] = pricing.estimate_tokens(p["user"] * 2)
    p["prices"] = (pi, po)
    budget.check_budget(conn, pricing.cost(p["est_in"], p["max_tokens"], pi, po))
    if not budget.limiter.allow():
        raise ApiError(429, "SLOW_DOWN", "Wait a few seconds and try again.")
    reply = _call(s, p)
    _spend(conn, s, "test", reply, p)
    return {"ok": True, "model": s["model"], "month": budget.month_totals(conn)}
