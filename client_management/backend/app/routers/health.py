"""Health and readiness endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness probe.

    Returns
    -------
    dict of str to str
        A static ``{"status": "ok"}`` payload; does not touch the
        database so it stays cheap for orchestrator probes.
    """
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Readiness probe that verifies database connectivity.

    Parameters
    ----------
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict of str to str
        ``{"status": "ready"}`` once a trivial query succeeds.
    """
    await session.execute(text("SELECT 1"))
    return {"status": "ready"}
