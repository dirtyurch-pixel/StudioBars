"""Where the AI key lives.

The key is kept on the computer that runs the Studio Bars server, in a private file (or an environment
variable). It is NEVER sent back to the browser, never logged and never committed to Git: the file sits in
`data/private/`, which `.gitignore` excludes. Anyone who can read this computer's files can read the key, so
only use a key you could revoke, and set a spending limit on it with your AI provider as well.
"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

PROVIDERS = ("anthropic", "openai_compat")
ENV_NAMES = {
    "anthropic": ("STUDIO_BARS_AI_KEY", "ANTHROPIC_API_KEY"),
    "openai_compat": ("STUDIO_BARS_AI_KEY_COMPAT",),
}
KEY_OK = re.compile(r"^[\x21-\x7e]{8,400}$")  # printable ASCII, no spaces or newlines


class KeyError_(ValueError):
    pass


def key_dir() -> Path:
    default = Path(__file__).resolve().parents[3] / "data" / "private"
    return Path(os.environ.get("STUDIO_BARS_AI_KEY_DIR", str(default)))


def _file(provider: str) -> Path:
    return key_dir() / f"ai_key_{provider}"


def get_key(provider: str) -> tuple[str | None, str | None]:
    """(key, source) where source is 'env' or 'file'."""
    for name in ENV_NAMES.get(provider, ()):
        v = os.environ.get(name, "").strip()
        if v:
            return v, "env"
    try:
        v = _file(provider).read_text(encoding="utf-8").strip()
    except OSError:
        return None, None
    return (v, "file") if v else (None, None)


def hint(key: str) -> str:
    """Only the last 4 characters, so the user can tell which key is saved."""
    return "…" + key[-4:] if len(key) >= 8 else "…"


def status(provider: str) -> dict:
    key, source = get_key(provider)
    return {"configured": bool(key), "source": source, "hint": hint(key) if key else None}


def set_key(provider: str, key: str) -> None:
    if provider not in PROVIDERS:
        raise KeyError_("Unknown provider.")
    key = key.strip()
    if not KEY_OK.match(key):
        raise KeyError_(
            "That does not look like an API key (it should be one long line of letters and numbers, no spaces)."
        )
    d = key_dir()
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".key-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(key)
        try:
            os.chmod(tmp, 0o600)  # owner only (ignored on Windows)
        except OSError:
            pass
        os.replace(tmp, _file(provider))
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def delete_key(provider: str) -> bool:
    try:
        _file(provider).unlink()
        return True
    except OSError:
        return False
