"""Impersonation read-only guard.

When an admin views the app AS another user, the frontend forwards the
``X-Impersonated-By`` header. The backend must reject every mutating
request so an admin can never change data while wearing someone else's
identity — reads still work so they can confirm the scoped view.
"""

from conftest import ADMIN, make_client

IMP = {"X-Impersonated-By": "boss@alpharoc.ai"}


async def test_create_blocked_while_impersonating(client):
    r = await client.post(
        "/api/clients",
        json={"name": "Nope", "became_on": "2024-01-01"},
        headers={**ADMIN, **IMP},
    )
    assert r.status_code == 403
    assert "another user" in r.json()["detail"].lower()


async def test_patch_blocked_while_impersonating(client):
    made = await make_client(client)  # created normally (no impersonation)
    r = await client.patch(
        f"/api/clients/{made['id']}",
        json={"name": "Renamed"},
        headers={**ADMIN, **IMP},
    )
    assert r.status_code == 403


async def test_delete_blocked_while_impersonating(client):
    made = await make_client(client)
    r = await client.delete(
        f"/api/clients/{made['id']}", headers={**ADMIN, **IMP}
    )
    assert r.status_code == 403


async def test_reads_allowed_while_impersonating(client):
    await make_client(client)
    r = await client.get("/api/clients", headers={**ADMIN, **IMP})
    assert r.status_code == 200


async def test_writes_work_without_impersonation(client):
    # Sanity: the guard only bites when the header is present.
    r = await client.post(
        "/api/clients",
        json={"name": "Fine", "became_on": "2024-01-01"},
        headers=ADMIN,
    )
    assert r.status_code == 201
