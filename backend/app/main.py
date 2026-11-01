"""Studio Bars backend."""

import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import access
from .ai_routes import router as ai_router
from .craft_routes import router as craft_router
from .lexicon.wordnet import get_wordnet
from .lexicon_routes import router as lexicon_router
from .phonetics.engine import get_dictionary
from .phonetics_routes import router as phonetics_router
from .routes import router
from .service import ApiError

APP_VERSION = "0.6.0-phase5"


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


@app.middleware("http")
async def pin_lock(request: Request, call_next):
    path = request.url.path
    if (
        path.startswith("/api/")
        and not path.startswith("/api/auth/")
        and request.method != "OPTIONS"
    ):
        if not access.is_ok(request):
            return JSONResponse(
                status_code=401,
                content={
                    "detail": {
                        "code": "PIN_REQUIRED",
                        "message": "Enter your PIN to open Studio Bars.",
                    }
                },
            )
    return await call_next(request)


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
app.include_router(ai_router)
app.include_router(craft_router)
app.include_router(access.router)


def mount_web(application: FastAPI, web_dir: str) -> None:
    """Serve the built web app from this same server, so one address works on a phone or tablet."""
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    root = os.path.realpath(web_dir)
    if os.path.isdir(os.path.join(root, "assets")):
        application.mount(
            "/assets", StaticFiles(directory=os.path.join(root, "assets")), name="assets"
        )

    @application.get("/{path:path}", include_in_schema=False)
    def web_app(path: str):
        full = os.path.realpath(os.path.join(root, path))
        if path and full.startswith(root + os.sep) and os.path.isfile(full):
            return FileResponse(full)
        return FileResponse(os.path.join(root, "index.html"))


if os.environ.get("STUDIO_BARS_SERVE_FRONTEND", "").strip():
    mount_web(app, os.environ["STUDIO_BARS_SERVE_FRONTEND"].strip())
