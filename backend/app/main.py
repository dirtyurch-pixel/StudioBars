"""Studio Bars backend."""

import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .lexicon.wordnet import get_wordnet
from .lexicon_routes import router as lexicon_router
from .phonetics.engine import get_dictionary
from .phonetics_routes import router as phonetics_router
from .routes import router
from .service import ApiError

APP_VERSION = "0.4.0-phase3"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # load the language data in the background so start-up is instant
    for loader in (get_dictionary, get_wordnet):
        threading.Thread(target=loader, daemon=True).start()
    yield


app = FastAPI(title="Studio Bars API", version=APP_VERSION, lifespan=lifespan)

# Only the local frontend may call the API from a browser.
# STUDIO_BARS_FRONTEND_ORIGIN may hold several addresses separated by commas.
_origins = [
    o.strip()
    for o in os.environ.get("STUDIO_BARS_FRONTEND_ORIGIN", "http://localhost:5173").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[*_origins, "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.exception_handler(ApiError)
async def api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content={"detail": {"code": exc.code, "message": exc.message, **exc.extra}},
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "studio-bars-backend", "version": APP_VERSION}


app.include_router(router)
app.include_router(phonetics_router)
app.include_router(lexicon_router)
