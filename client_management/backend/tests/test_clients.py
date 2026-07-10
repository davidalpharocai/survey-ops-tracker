"""Client CRUD: validation, socc_code uniqueness, soft delete."""

from conftest import ADMIN, USER, make_client, make_contract, make_user


async def test_create_client_returns_fields(client):
    body = await make_client(
        client,
        name="Holocene",
        socc_code="Cl00042",
        primary_contact_name="Ana",
        relationship_manager="Tedi",
    )
    assert body["id"] == 1
    assert body["name"] == "Holocene"
    assert body["soccCode"] == "Cl00042"
    assert body["becameClientOn"] == "2024-01-15T00:00:00Z"
    assert body["primaryContactName"] == "Ana"
    assert body["relationshipManager"] == "Tedi"
    assert body["createdByEmail"] == "david@alpharoc.ai"


async def test_create_client_missing_became_on_400(client):
    r = await client.post("/api/clients", json={"name": "X"}, headers=ADMIN)
    assert r.status_code == 400
    assert "became a client" in r.json()["detail"]


async def test_create_client_garbage_became_on_400(client):
    r = await client.post(
        "/api/clients",
        json={"name": "X", "became_on": "not-a-date"},
        headers=ADMIN,
    )
    assert r.status_code == 400


async def test_create_client_blank_name_400(client):
    r = await client.post(
        "/api/clients", json={"name": "  ", "became_on": "2024-01-01"}, headers=ADMIN
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Client name is required."


async def test_duplicate_name_409(client):
    await make_client(client, name="Dup Co")
    r = await client.post(
        "/api/clients",
        json={"name": "Dup Co", "became_on": "2024-01-01"},
        headers=ADMIN,
    )
    assert r.status_code == 409


async def test_duplicate_socc_code_409(client):
    await make_client(client, name="A", socc_code="Cl00001")
    r = await client.post(
        "/api/clients",
        json={"name": "B", "became_on": "2024-01-01", "socc_code": "Cl00001"},
        headers=ADMIN,
    )
    assert r.status_code == 409
    assert "Cl00001" in r.json()["detail"]


async def test_patch_without_socc_code_preserves_it(client):
    made = await make_client(client, name="KeepCode", socc_code="Cl00007")
    r = await client.patch(
        f"/api/clients/{made['id']}",
        json={"name": "KeepCode Renamed", "became_on": "2024-01-15"},
        headers=ADMIN,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "KeepCode Renamed"
    assert body["soccCode"] == "Cl00007"  # omitted socc_code must survive


async def test_patch_socc_code_clash_409(client):
    await make_client(client, name="Owner", socc_code="Cl00011")
    other = await make_client(client, name="Other", socc_code="Cl00012")
    r = await client.patch(
        f"/api/clients/{other['id']}",
        json={"name": "Other", "became_on": "2024-01-15", "socc_code": "Cl00011"},
        headers=ADMIN,
    )
    assert r.status_code == 409


async def test_patch_can_change_socc_code(client):
    made = await make_client(client, name="Changer", socc_code="Cl00021")
    r = await client.patch(
        f"/api/clients/{made['id']}",
        json={"name": "Changer", "became_on": "2024-01-15", "socc_code": "Cl00022"},
        headers=ADMIN,
    )
    assert r.status_code == 200
    assert r.json()["soccCode"] == "Cl00022"


async def test_patch_sets_updated_by_email(client, db):
    made = await make_client(client, name="Attr Co")
    # A second admin edits it (a restricted member can't edit others' clients).
    r = await client.patch(
        f"/api/clients/{made['id']}",
        json={"name": "Attr Co", "became_on": "2024-01-15"},
        headers={"X-User-Email": "tedi@alpharoc.ai"},
    )
    assert r.status_code == 200
    row = await db.fetchrow(
        "SELECT created_by_email, updated_by_email, updated_at "
        "FROM clients WHERE id = $1",
        made["id"],
    )
    assert row["created_by_email"] == "david@alpharoc.ai"
    assert row["updated_by_email"] == "tedi@alpharoc.ai"
    assert row["updated_at"] is not None


async def test_archive_client_hides_it_everywhere(client, db):
    made = await make_client(client, name="Gone Inc")
    keep = await make_client(client, name="Stays Inc")
    r = await client.delete(f"/api/clients/{made['id']}", headers=ADMIN)
    assert r.status_code == 200
    assert r.json() == {"id": made["id"], "name": "Gone Inc"}

    # Gone from the list, from GET by id, and from the balances report.
    names = [c["name"] for c in (await client.get("/api/clients", headers=ADMIN)).json()]
    assert names == ["Stays Inc"]
    assert (await client.get(f"/api/clients/{made['id']}", headers=ADMIN)).status_code == 404
    report = (await client.get("/api/reports/balances", headers=ADMIN)).json()
    assert [row["client"]["id"] for row in report] == [keep["id"]]

    # Soft delete: the row is still in the database, stamped deleted_at.
    row = await db.fetchrow("SELECT deleted_at FROM clients WHERE id = $1", made["id"])
    assert row is not None and row["deleted_at"] is not None


async def test_archive_client_leaves_children_in_db(client, db):
    made = await make_client(client, name="Parent Co")
    user = await make_user(client, made["id"], name="Child User")
    txn = await make_contract(client, made["id"])
    await client.delete(f"/api/clients/{made['id']}", headers=ADMIN)

    # The client's users and transactions are NOT deleted (nor archived):
    # only the client row gets deleted_at.
    urow = await db.fetchrow(
        "SELECT deleted_at FROM client_users WHERE id = $1", user["id"]
    )
    trow = await db.fetchrow(
        "SELECT deleted_at FROM transactions WHERE id = $1", txn["id"]
    )
    assert urow is not None and urow["deleted_at"] is None
    assert trow is not None and trow["deleted_at"] is None


async def test_archived_name_can_be_reused(client, raw_client):
    # Name uniqueness only applies to ACTIVE clients: the DB enforces it
    # via the clients_name_active_key partial index (WHERE deleted_at IS
    # NULL), matching the app-level dup-check.
    made = await make_client(client, name="Phoenix LLC")
    await client.delete(f"/api/clients/{made['id']}", headers=ADMIN)
    r = await raw_client.post(
        "/api/clients",
        json={"name": "Phoenix LLC", "became_on": "2024-01-15"},
        headers=ADMIN,
    )
    assert r.status_code == 201
    assert r.json()["name"] == "Phoenix LLC"


async def test_delete_archived_client_404(client):
    made = await make_client(client, name="Twice")
    await client.delete(f"/api/clients/{made['id']}", headers=ADMIN)
    r = await client.delete(f"/api/clients/{made['id']}", headers=ADMIN)
    assert r.status_code == 404


async def test_list_clients_with_users_embedded(client):
    made = await make_client(client, name="WithUsers")
    await make_user(client, made["id"], name="Zed")
    await make_user(client, made["id"], name="Amy")
    r = await client.get("/api/clients", params={"include": "users"}, headers=ADMIN)
    assert r.status_code == 200
    rows = r.json()
    assert [u["name"] for u in rows[0]["users"]] == ["Amy", "Zed"]
