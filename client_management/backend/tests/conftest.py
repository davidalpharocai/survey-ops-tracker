"""Test harness for the FastAPI backend.

The app's ``get_settings()`` is ``lru_cache``d and evaluated at import
time by nearly every module (``app.db`` builds the engine from it), so
the test environment MUST be configured before the first ``app.*``
import. That happens right here at the top of conftest, which pytest
imports before collecting any test module.

Database strategy: a throwaway ``ccm_test`` database on the already
running local Postgres (port 5433). It is dropped and recreated once per
session, the app schema is applied via ``app.db.apply_schema()``, and
every table is truncated between tests.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

# --- Environment: must precede any `app.*` import (see module docstring).
_PG_HOST = "localhost:5433"
ADMIN_DSN = f"postgresql://postgres:dev@{_PG_HOST}/postgres"
TEST_DB = "ccm_test"
TEST_DSN = f"postgresql://postgres:dev@{_PG_HOST}/{TEST_DB}"

os.environ["DATABASE_URL"] = TEST_DSN
os.environ["DATABASE_URL_SECRET_ARN"] = ""
os.environ["ENV"] = "development"
os.environ["ALLOWED_DOMAIN"] = "alpharoc.ai"
# Blank Cognito -> the X-User-Email dev auth path.
os.environ["COGNITO_USER_POOL_ID"] = ""
os.environ["COGNITO_APP_CLIENT_ID"] = ""
os.environ["COGNITO_ALLOWED_GROUP"] = "ccm-users"
os.environ["COGNITO_ADMIN_GROUP"] = "ccm-admins"
# david@ is allow-listed admin; sarah@ is a plain member.
os.environ["CCM_ADMIN_EMAILS"] = "david@alpharoc.ai,tedi@alpharoc.ai"
# Blank Athena -> audit-log admin endpoints return empty result sets.
os.environ["ATHENA_DATABASE"] = ""
os.environ["ATHENA_TABLE"] = ""
os.environ["AUDIT_S3_OUTPUT"] = ""

# Make `app` importable regardless of how pytest was invoked.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402

# Auth headers used throughout the suite (dev X-User-Email path).
ADMIN = {"X-User-Email": "david@alpharoc.ai"}  # in CCM_ADMIN_EMAILS
ADMIN2 = {"X-User-Email": "tedi@alpharoc.ai"}  # second admin (unrestricted)
# sarah@ is a plain @alpharoc.ai member -> RESTRICTED salesperson under the
# permissions model (sees only her own clients; can't add credits).
USER = {"X-User-Email": "sarah@alpharoc.ai"}


async def _recreate_database() -> None:
    """Drop and recreate the throwaway test database."""
    conn = await asyncpg.connect(ADMIN_DSN)
    try:
        await conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        await conn.execute(f"CREATE DATABASE {TEST_DB}")
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
def _database():
    """Create ``ccm_test`` and apply the app schema, once per session.

    Runs the async setup through ``asyncio.run`` from a *sync* fixture so
    it does not depend on pytest-asyncio's (function-scoped) event loops.
    The app engine uses NullPool, so no connection outlives the loop it
    was created on.
    """
    asyncio.run(_recreate_database())

    import app.db as app_db  # deferred: env above must win

    # The dev engine echoes SQL (ENV=development); silence it for tests.
    try:
        app_db.engine.echo = False
    except Exception:
        logging.getLogger("sqlalchemy.engine.Engine").setLevel(logging.WARNING)

    asyncio.run(app_db.apply_schema())
    yield
    asyncio.run(app_db.engine.dispose())


@pytest_asyncio.fixture(autouse=True)
async def _clean_tables(_database):
    """Truncate every table before each test."""
    conn = await asyncpg.connect(TEST_DSN)
    try:
        await conn.execute(
            "TRUNCATE transaction_users, transactions, client_users, clients, "
            "salespeople RESTART IDENTITY CASCADE"
        )
    finally:
        await conn.close()


@pytest_asyncio.fixture
async def client():
    """An httpx client speaking ASGI directly to the app (no live server)."""
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


@pytest_asyncio.fixture
async def raw_client():
    """Like ``client`` but unhandled app exceptions become 500 responses
    (instead of re-raising into the test), for asserting current
    error-path behaviour."""
    from app.main import app

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


@pytest_asyncio.fixture
async def db():
    """A raw asyncpg connection to the test database, for direct SQL checks."""
    conn = await asyncpg.connect(TEST_DSN)
    yield conn
    await conn.close()


# --- Factories -------------------------------------------------------------


async def make_client(client, name="Acme Corp", **overrides) -> dict:
    """Create a client via the API and return the response body."""
    payload = {"name": name, "became_on": "2024-01-15", **overrides}
    r = await client.post("/api/clients", json=payload, headers=ADMIN)
    assert r.status_code == 201, r.text
    return r.json()


async def make_user(client, client_id, name="Pat Jones", **overrides) -> dict:
    """Create a client user via the API and return the response body."""
    payload = {"name": name, **overrides}
    r = await client.post(
        f"/api/clients/{client_id}/users", json=payload, headers=ADMIN
    )
    assert r.status_code == 201, r.text
    return r.json()


async def make_contract(
    client,
    client_id,
    name="Annual contract",
    occurred_on="2024-02-01",
    renewal_on="2025-02-01",
    credits_amount=1000,
    dollars_amount=0,
    **overrides,
) -> dict:
    """Create a contract via the API and return the response body."""
    payload = {
        "client_id": client_id,
        "name": name,
        "occurred_on": occurred_on,
        "renewal_on": renewal_on,
        "credits_amount": credits_amount,
        "dollars_amount": dollars_amount,
        **overrides,
    }
    r = await client.post("/api/contracts", json=payload, headers=ADMIN)
    assert r.status_code == 201, r.text
    return r.json()


async def make_study(
    client,
    client_id,
    user_ids,
    name="Brand study",
    occurred_on="2024-03-01",
    cost_type="credits",
    cost=100,
    **overrides,
) -> dict:
    """Create a study via the API and return the response body."""
    payload = {
        "client_id": client_id,
        "name": name,
        "occurred_on": occurred_on,
        "cost_type": cost_type,
        "cost": cost,
        "client_user_ids": user_ids,
        **overrides,
    }
    r = await client.post("/api/studies", json=payload, headers=ADMIN)
    assert r.status_code == 201, r.text
    return r.json()


async def get_balances(client, client_id) -> dict:
    """Fetch /api/clients/{id}/balances."""
    r = await client.get(f"/api/clients/{client_id}/balances", headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()
