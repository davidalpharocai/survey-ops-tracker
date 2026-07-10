"""Salesperson list + client assignment + snapshot propagation."""

from tests.conftest import ADMIN, make_client


async def _mk_salesperson(client, name="Jenna", email=None):
    body = {"name": name}
    if email is not None:
        body["email"] = email
    r = await client.post("/api/salespeople", json=body, headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


async def test_create_and_list_salesperson(client):
    sp = await _mk_salesperson(client, "Jenna", "jenna@alpharoc.ai")
    assert sp["name"] == "Jenna"
    assert sp["email"] == "jenna@alpharoc.ai"
    assert sp["active"] is True

    r = await client.get("/api/salespeople", headers=ADMIN)
    assert r.status_code == 200, r.text
    names = [s["name"] for s in r.json()]
    assert names == ["Jenna"]


async def test_create_lowercases_email(client):
    sp = await _mk_salesperson(client, "Alex", "Alex@AlphaROC.ai")
    assert sp["email"] == "alex@alpharoc.ai"


async def test_create_rejects_blank_name(client):
    r = await client.post("/api/salespeople", json={"name": "   "}, headers=ADMIN)
    assert r.status_code == 400, r.text


async def test_create_is_idempotent_by_name(client):
    a = await _mk_salesperson(client, "Vineet")
    b = await _mk_salesperson(client, "vineet")  # case-insensitive match
    assert a["id"] == b["id"]
    r = await client.get("/api/salespeople", headers=ADMIN)
    assert len(r.json()) == 1


async def test_create_fills_missing_email_on_dedupe(client):
    a = await _mk_salesperson(client, "Vineet")  # no email
    assert a["email"] is None
    b = await _mk_salesperson(client, "Vineet", "vineet@alpharoc.ai")
    assert b["id"] == a["id"]
    assert b["email"] == "vineet@alpharoc.ai"


async def test_client_create_with_salesperson_sets_snapshot(client):
    sp = await _mk_salesperson(client, "Jenna", "jenna@alpharoc.ai")
    c = await make_client(client, name="Beacon", salesperson_id=sp["id"])
    assert c["salespersonId"] == sp["id"]
    assert c["salespersonName"] == "Jenna"
    assert c["salespersonEmail"] == "jenna@alpharoc.ai"
    # Legacy relationship_manager is mirrored so old readers keep working.
    assert c["relationshipManager"] == "Jenna"


async def test_client_create_rejects_unknown_salesperson(client):
    r = await client.post(
        "/api/clients",
        json={"name": "Nope", "became_on": "2024-01-15", "salesperson_id": 9999},
        headers=ADMIN,
    )
    assert r.status_code == 400, r.text


async def test_client_create_without_salesperson_is_allowed(client):
    c = await make_client(client, name="Legacy Co")
    assert c["salespersonId"] is None
    assert c["salespersonName"] is None


async def test_client_update_reassigns_salesperson(client):
    a = await _mk_salesperson(client, "Jenna", "jenna@alpharoc.ai")
    b = await _mk_salesperson(client, "Alex", "alex@alpharoc.ai")
    c = await make_client(client, name="Switchers", salesperson_id=a["id"])
    r = await client.patch(
        f"/api/clients/{c['id']}",
        json={"name": "Switchers", "became_on": "2024-01-15", "salesperson_id": b["id"]},
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["salespersonId"] == b["id"]
    assert body["salespersonName"] == "Alex"
    assert body["salespersonEmail"] == "alex@alpharoc.ai"


async def test_patch_salesperson_email_propagates_to_clients(client):
    sp = await _mk_salesperson(client, "Jenna")  # no email yet
    c = await make_client(client, name="Downstream", salesperson_id=sp["id"])
    assert c["salespersonEmail"] is None

    r = await client.patch(
        f"/api/salespeople/{sp['id']}",
        json={"name": "Jenna", "email": "jenna@alpharoc.ai"},
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text

    # The client's denormalized snapshot must have been updated too.
    got = await client.get(f"/api/clients/{c['id']}", headers=ADMIN)
    assert got.json()["salespersonEmail"] == "jenna@alpharoc.ai"


async def test_patch_salesperson_rename_rejects_duplicate(client):
    await _mk_salesperson(client, "Jenna")
    alex = await _mk_salesperson(client, "Alex")
    r = await client.patch(
        f"/api/salespeople/{alex['id']}",
        json={"name": "jenna"},
        headers=ADMIN,
    )
    assert r.status_code == 409, r.text


async def test_delete_archives_and_hides_from_default_list(client):
    sp = await _mk_salesperson(client, "Temp")
    d = await client.delete(f"/api/salespeople/{sp['id']}", headers=ADMIN)
    assert d.status_code == 200, d.text
    active = await client.get("/api/salespeople", headers=ADMIN)
    assert active.json() == []
    allsp = await client.get("/api/salespeople?include=all", headers=ADMIN)
    assert [s["name"] for s in allsp.json()] == ["Temp"]


async def test_legacy_rm_update_repoints_snapshot(client):
    # Importer/legacy path: update sends relationship_manager, no salesperson_id.
    await _mk_salesperson(client, "Jenna", "jenna@alpharoc.ai")
    alex = await _mk_salesperson(client, "Alex", "alex@alpharoc.ai")
    c = await make_client(client, name="Rebooked", salesperson_id=None,
                          relationship_manager="Jenna")
    # snapshot should have resolved Jenna on create? No — create only snapshots
    # from salesperson_id. Legacy create leaves it blank; that's fine.
    r = await client.patch(
        f"/api/clients/{c['id']}",
        json={"name": "Rebooked", "became_on": "2024-01-15", "relationship_manager": "Alex"},
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["relationshipManager"] == "Alex"
    assert body["salespersonId"] == alex["id"]
    assert body["salespersonEmail"] == "alex@alpharoc.ai"


async def test_legacy_rm_update_clears_snapshot_when_unmatched(client):
    jenna = await _mk_salesperson(client, "Jenna", "jenna@alpharoc.ai")
    c = await make_client(client, name="Orphan", salesperson_id=jenna["id"])
    assert c["salespersonEmail"] == "jenna@alpharoc.ai"
    r = await client.patch(
        f"/api/clients/{c['id']}",
        json={"name": "Orphan", "became_on": "2024-01-15", "relationship_manager": "Nobody"},
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["relationshipManager"] == "Nobody"
    assert body["salespersonId"] is None
    assert body["salespersonEmail"] is None


async def test_patch_salesperson_rename_keeps_email_when_omitted(client):
    sp = await _mk_salesperson(client, "Jenna", "jenna@alpharoc.ai")
    r = await client.patch(
        f"/api/salespeople/{sp['id']}",
        json={"name": "Jenna S"},  # email omitted -> must not blank it
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "jenna@alpharoc.ai"


async def test_restore_archived_salesperson(client):
    sp = await _mk_salesperson(client, "Temp", "temp@alpharoc.ai")
    await client.delete(f"/api/salespeople/{sp['id']}", headers=ADMIN)
    # Restore via PATCH active=true (what the roster "Restore" button sends).
    r = await client.patch(
        f"/api/salespeople/{sp['id']}",
        json={"name": "Temp", "active": True},
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    assert r.json()["active"] is True
    active = await client.get("/api/salespeople", headers=ADMIN)
    assert "Temp" in [s["name"] for s in active.json()]


async def test_restore_into_taken_name_conflicts(client):
    a = await _mk_salesperson(client, "Dup")
    await client.delete(f"/api/salespeople/{a['id']}", headers=ADMIN)
    await _mk_salesperson(client, "Dup")  # a new active "Dup"
    r = await client.patch(
        f"/api/salespeople/{a['id']}",
        json={"name": "Dup", "active": True},
        headers=ADMIN,
    )
    assert r.status_code == 409, r.text


async def test_edit_client_keeps_archived_salesperson(client):
    sp = await _mk_salesperson(client, "Jenna", "jenna@alpharoc.ai")
    c = await make_client(client, name="Sticky", salesperson_id=sp["id"])
    await client.delete(f"/api/salespeople/{sp['id']}", headers=ADMIN)
    # Editing an unrelated field must NOT fail just because the assigned
    # salesperson is now archived (the picker resubmits the same id).
    r = await client.patch(
        f"/api/clients/{c['id']}",
        json={"name": "Sticky Renamed", "became_on": "2024-01-15", "salesperson_id": sp["id"]},
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    assert r.json()["salespersonId"] == sp["id"]


async def test_new_assignment_to_archived_salesperson_rejected(client):
    keep = await _mk_salesperson(client, "Keep")
    gone = await _mk_salesperson(client, "Gone")
    c = await make_client(client, name="Mover", salesperson_id=keep["id"])
    await client.delete(f"/api/salespeople/{gone['id']}", headers=ADMIN)
    # Assigning this client to a DIFFERENT, archived salesperson is still 400.
    r = await client.patch(
        f"/api/clients/{c['id']}",
        json={"name": "Mover", "became_on": "2024-01-15", "salesperson_id": gone["id"]},
        headers=ADMIN,
    )
    assert r.status_code == 400, r.text


async def test_reports_balances_include_salesperson(client):
    sp = await _mk_salesperson(client, "Jenna", "jenna@alpharoc.ai")
    await make_client(client, name="Reportable", salesperson_id=sp["id"])
    r = await client.get("/api/reports/balances", headers=ADMIN)
    assert r.status_code == 200, r.text
    row = next(x for x in r.json() if x["client"]["name"] == "Reportable")
    assert row["client"]["salespersonEmail"] == "jenna@alpharoc.ai"
