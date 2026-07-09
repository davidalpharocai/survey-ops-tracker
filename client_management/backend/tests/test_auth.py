"""Auth behaviour on the dev (X-User-Email) path — Cognito unset."""

from conftest import ADMIN, USER


async def test_missing_header_is_401(client):
    r = await client.get("/api/clients")
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing X-User-Email header."


async def test_wrong_domain_is_403(client):
    r = await client.get(
        "/api/clients", headers={"X-User-Email": "mallory@gmail.com"}
    )
    assert r.status_code == 403
    assert "alpharoc.ai" in r.json()["detail"]


async def test_allowed_domain_member_can_read(client):
    r = await client.get("/api/clients", headers=USER)
    assert r.status_code == 200
    assert r.json() == []


async def test_writes_denied_without_auth(client):
    r = await client.post(
        "/api/clients", json={"name": "X", "became_on": "2024-01-01"}
    )
    assert r.status_code == 401


async def test_admin_endpoint_allows_allowlisted_admin(client):
    r = await client.get("/api/admin/team", headers=ADMIN)
    assert r.status_code == 200
    body = r.json()
    # Local dev: Cognito unset -> configured False, no members.
    assert body["configured"] is False
    assert "david@alpharoc.ai" in body["allowlistAdmins"]
    assert body["members"] == []


async def test_admin_endpoint_rejects_non_admin(client):
    r = await client.get("/api/admin/team", headers=USER)
    assert r.status_code == 403
    assert r.json()["detail"] == "Admin access required."


async def test_admin_check_is_case_insensitive(client):
    r = await client.get(
        "/api/admin/team", headers={"X-User-Email": "David@AlphaROC.ai"}
    )
    assert r.status_code == 200


async def test_audit_log_endpoint_empty_when_athena_unconfigured(client):
    r = await client.get("/api/admin/audit-logs", headers=ADMIN)
    assert r.status_code == 200
    assert r.json() == {
        "rows": [],
        "queryId": None,
        "nextToken": None,
        "athena": False,
    }
