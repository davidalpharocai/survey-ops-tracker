"""Async SQLAlchemy engine and session management."""

from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# NullPool: the backend runs on Lambda, where a pooled connection would
# be frozen between invocations and resumed stale. Open a fresh asyncpg
# connection per request and close it on session teardown instead.
# Engine and session factory are only created when DATABASE_URL is set;
# the admin-query Lambda runs without a DB and must never reach these.
if settings.db_enabled:
    engine = create_async_engine(
        settings.async_database_url,
        poolclass=NullPool,
        echo=not settings.is_production,
    )
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
else:
    engine = None  # type: ignore[assignment]
    SessionLocal = None  # type: ignore[assignment]


class Base(DeclarativeBase):
    """Declarative base for all ORM models.

    Tables are owned by ``backend/app/schema.sql``, applied idempotently
    on startup by :func:`apply_schema`. The models map onto those tables.
    """


async def apply_schema() -> None:
    """Apply ``schema.sql`` idempotently against the database.

    The schema file uses ``CREATE ... IF NOT EXISTS`` exclusively, so
    running it on every boot only ever adds missing objects and never
    drops data. Statements are executed individually because the asyncpg
    driver rejects multiple commands in a single prepared statement.
    """
    raw = SCHEMA_PATH.read_text(encoding="utf-8")
    # Drop full-line SQL comments so leading comment blocks don't get
    # glued onto the first real statement when splitting on ';'.
    sql = "\n".join(
        line for line in raw.splitlines() if not line.strip().startswith("--")
    )
    statements = [stmt.strip() for stmt in sql.split(";") if stmt.strip()]
    async with engine.begin() as conn:
        for stmt in statements:
            await conn.exec_driver_sql(stmt)


async def get_session() -> AsyncIterator[AsyncSession]:
    """Yield a database session for a single request.

    Intended for use as a FastAPI dependency. The session is closed
    automatically when the request finishes.

    Yields
    ------
    AsyncSession
        An open SQLAlchemy async session bound to the request.

    Raises
    ------
    RuntimeError
        If the database is not configured (admin-query Lambda context).
    """
    if SessionLocal is None:
        raise RuntimeError("Database not configured in this Lambda context.")
    async with SessionLocal() as session:
        yield session
