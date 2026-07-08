"""FastAPI application entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.audit import AuditMiddleware
from app.config import get_settings
from app.db import apply_schema
from app.helpers import MoneyParseError
from app.routers import (
    admin,
    clients,
    contracts,
    health,
    reports,
    studies,
    team,
    transactions,
    users,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Apply the schema once on startup, before serving traffic.

    The backend now owns the schema (``app/schema.sql``); applying it
    here on boot is idempotent and replaces the frontend's old
    apply-schema step.

    Parameters
    ----------
    _ : FastAPI
        The application instance (unused).

    Yields
    ------
    None
        Control returns to the server for the application's lifetime.
    """
    if settings.db_enabled:
        await apply_schema()
    yield


app = FastAPI(
    title="AlphaROC Client Credit Management API",
    version="0.2.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    lifespan=lifespan,
)

# CORS: restrict browser-direct calls to the known frontend origin.
# All server-to-server (Next.js SSR → Lambda) calls are unaffected since
# CORS is a browser-only mechanism.
_cors_origins = (
    [settings.frontend_url]
    if settings.is_production and settings.frontend_url
    else ["http://localhost:3000"]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-User-Email"],
)

# Audit every mutating request (writes + denied attempts) as a structured
# CloudWatch log line for the S3/Athena audit trail.
app.add_middleware(AuditMiddleware)

app.include_router(health.router)
app.include_router(clients.router)
app.include_router(users.router)
app.include_router(contracts.router)
app.include_router(studies.router)
app.include_router(transactions.router)
app.include_router(reports.router)
app.include_router(admin.router)
app.include_router(team.router)


@app.exception_handler(MoneyParseError)
async def _money_parse_error(_: Request, exc: MoneyParseError) -> JSONResponse:
    """Return a 400 (not a 500) when a money field holds a typo."""
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/", tags=["meta"])
async def root() -> dict[str, str]:
    """Service identity endpoint.

    Returns
    -------
    dict of str to str
        The service name and version, useful for smoke checks.
    """
    return {"service": app.title, "version": app.version}
