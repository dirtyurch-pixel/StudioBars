"""Copies the AI wording (tasks, rules, helper styles, models and prices) from the PC version into the phone version,
so both always send the same instructions. Run from backend/:  PYTHONPATH=. .venv/bin/python ../scripts/make_phone_ai_data.py
A backend test fails if the copy is out of date."""

import json
from pathlib import Path

from app.ai import pricing, prompts

DEST = Path(__file__).resolve().parents[1] / "frontend" / "src" / "local" / "ai" / "promptData.json"


def data() -> dict:
    return {
        "SYSTEM": prompts.SYSTEM,
        "TASKS": prompts.TASKS,
        "PERSONAS": prompts.PERSONAS,
        "LINES_FORMAT": prompts.LINES_FORMAT,
        "NOTES_FORMAT": prompts.NOTES_FORMAT,
        "IMPROVE_FORMAT": prompts.IMPROVE_FORMAT,
        "MAX_CONTEXT_CHARS": prompts.MAX_CONTEXT_CHARS,
        "MODELS": pricing.MODELS,
        "DEFAULT_MODEL": pricing.DEFAULT_MODEL,
        "TYPICAL_IN": pricing.TYPICAL_IN,
        "TYPICAL_OUT": pricing.TYPICAL_OUT,
    }


if __name__ == "__main__":
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(data(), indent=1, ensure_ascii=False) + "\n")
    print("wrote", DEST)
