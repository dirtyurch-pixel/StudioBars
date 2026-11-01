"""Models and prices. Prices are ESTIMATES in US dollars per million tokens (Claude API price list, read
2026-10-06); the real charge is whatever your provider bills. The app counts the tokens the provider reports."""

from __future__ import annotations

MODELS: dict[str, dict] = {
    "claude-haiku-5-5": {
        "label": "Claude Haiku 5.5: cheapest and fastest",
        "in": 0.10,
        "out": 0.50,
    },
    "claude-sonnet-5-5": {"label": "Claude Sonnet 5.5: balanced", "in": 2.00, "out": 10.00},
    "claude-opus-5-5": {"label": "Claude Opus 5.5: best writing", "in": 4.00, "out": 20.00},
    "claude-fable-5-1": {
        "label": "Claude Fable 5.1: most capable, costs most",
        "in": 10.00,
        "out": 50.00,
    },
}
DEFAULT_MODEL = "claude-opus-5-5"
TYPICAL_IN, TYPICAL_OUT = 1500, 500  # a typical lyric request, for the "about $X per request" hint


def prices(model: str, override_in: float = 0.0, override_out: float = 0.0) -> tuple[float, float]:
    if model in MODELS:
        return MODELS[model]["in"], MODELS[model]["out"]
    return (
        override_in,
        override_out,
    )  # other providers: whatever the user entered (0 = free, e.g. a local model)


def cost(in_tokens: int, out_tokens: int, price_in: float, price_out: float) -> float:
    return (in_tokens * price_in + out_tokens * price_out) / 1_000_000


def estimate_tokens(text: str) -> int:
    """A cautious guess (about 3.5 characters per token) used only for the pre-send cost check."""
    return int(len(text) / 3.5) + 20
