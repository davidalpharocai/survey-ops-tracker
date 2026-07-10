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
    adjustments,
    admin,
    archive,
    clients,
    contracts,
    credit_requests,
    health,
    me,
    reports,
    salespeople,
    search,
    socc,
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
    # In production, serve no interactive docs and no machine-readable
    # OpenAPI schema: the API is internal-only, so there is no reason to
    # publish its full surface to anyone who reaches the origin.
    docs_url=None if settings.is_production else "/docs",
    openapi_url=None if settings.is_production else "/openapi.json",
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
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-User-Email",
        "X-Impersonated-By",
    ],
)

# Audit every mutating request (writes + denied attempts) as a structured
# CloudWatch log line for the S3/Athena audit trail.
app.add_middleware(AuditMiddleware)


@app.middleware("http")
async def _impersonation_readonly(request: Request, call_next):
    """Block writes while an admin is viewing the app as another user.

    The frontend sets ``X-Impersonated-By`` (the real admin's email) only
    when an admin has an active impersonation session. Any mutating method
    carrying that header is rejected so an admin can never change data while
    wearing someone else's identity; reads pass through so they can confirm
    the impersonated user's scoped view.
    """
    if request.headers.get("x-impersonated-by") and request.method not in (
        "GET",
        "HEAD",
        "OPTIONS",
    ):
        return JSONResponse(
            status_code=403,
            content={
                "detail": "You're viewing as another user (read-only). "
                "Exit to make changes."
            },
        )
    return await call_next(request)

app.include_router(health.router)
app.include_router(me.router)
app.include_router(clients.router)
app.include_router(users.router)
app.include_router(contracts.router)
app.include_router(studies.router)
app.include_router(adjustments.router)
app.include_router(credit_requests.router)
app.include_router(transactions.router)
app.include_router(reports.router)
app.include_router(salespeople.router)
app.include_router(search.router)
app.include_router(socc.router)
app.include_router(admin.router)
app.include_router(archive.router)
app.include_router(team.router)


@app.exception_handler(MoneyParseError)
async def _money_parse_error(_: Request, exc: MoneyParseError) -> JSONResponse:
    """Return a 400 (not a 500) when a money field holds a typo."""
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/", tags=["meta"])
async def root() -> dict[str, str]:
    """Service identity endpoint.

    Returns just enough to confirm the service is up for a smoke check,
    without disclosing the build version to unauthenticated callers.

    Returns
    -------
    dict of str to str
        The service name and a static ``ok`` status.
    """
    return {"service": app.title, "status": "ok"}
