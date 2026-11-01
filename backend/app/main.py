"""Studio Bars backend (Phase 0): a minimal API with one /health route."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

APP_VERSION = "0.0.0-phase0"

app = FastAPI(title="Studio Bars API", version=APP_VERSION)

# Only the local frontend may call the API from a browser.
_origin = os.environ.get("STUDIO_BARS_FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_origin, "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "studio-bars-backend", "version": APP_VERSION}
