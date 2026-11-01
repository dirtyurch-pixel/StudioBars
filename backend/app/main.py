"""Studio Bars backend."""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .routes import router
from .service import ApiError

APP_VERSION = "0.1.0-phase1"

app = FastAPI(title="Studio Bars API", version=APP_VERSION)

# Only the local frontend may call the API from a browser.
_origin = os.environ.get("STUDIO_BARS_FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_origin, "http://127.0.0.1:5173"],
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
