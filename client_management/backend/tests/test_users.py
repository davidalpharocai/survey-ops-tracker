"""Client-user CRUD and the attributed-user delete guard."""

from conftest import ADMIN, make_client, make_study, make_user


async def test_create_and_list_users(client):
    made = await make_client(client)
    await make_user(client, made["id"], name="Nina", email="nina@x.com")
    r = await client.get(f"/api/clients/{made['id']}/users", headers=ADMIN)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["name"] == "Nina"
    assert rows[0]["email"] == "nina@x.com"
    assert rows[0]["clientId"] == made["id"]


async def test_create_user_blank_name_400(client):
    made = await make_client(client)
    r = await client.post(
        f"/api/clients/{made['id']}/users", json={"name": "  "}, headers=ADMIN
    )
    assert r.status_code == 400


async def test_create_user_for_missing_client_404(client):
    r = await client.post(
        "/api/clients/9999/users", json={"name": "Ghost"}, headers=ADMIN
    )
    assert r.status_code == 404


async def test_delete_unattributed_user_archives_it(client, db):
    made = await make_client(client)
    u = await make_user(client, made["id"], name="Free Agent")
    r = await client.delete(f"/api/users/{u['id']}", headers=ADMIN)
    assert r.status_code == 200
    assert r.json() == {"clientId": made["id"], "name": "Free Agent"}

    # Gone from both list endpoints...
    assert (await client.get(f"/api/clients/{made['id']}/users", headers=ADMIN)).json() == []
    assert (await client.get("/api/users", headers=ADMIN)).json() == []
    assert (await client.get(f"/api/users/{u['id']}", headers=ADMIN)).status_code == 404

    # ...but soft-deleted, not removed.
    row = await db.fetchrow("SELECT deleted_at FROM client_users WHERE id = $1", u["id"])
    assert row is not None and row["deleted_at"] is not None


async def test_delete_attributed_user_409(client):
    made = await make_client(client)
    u = await make_user(client, made["id"])
    await make_study(client, made["id"], [u["id"]])
    r = await client.delete(f"/api/users/{u['id']}", headers=ADMIN)
    assert r.status_code == 409
    assert "attributed to 1 transaction(s)" in r.json()["detail"]


async def test_delete_user_attributed_only_to_archived_study_succeeds(client):
    # The attribution guard only counts ACTIVE transactions, so archiving
    # the study frees the user for deletion (which is itself an archive).
    made = await make_client(client)
    u = await make_user(client, made["id"])
    study = await make_study(client, made["id"], [u["id"]])
    assert (await client.delete(f"/api/studies/{study['id']}", headers=ADMIN)).status_code == 200
    r = await client.delete(f"/api/users/{u['id']}", headers=ADMIN)
    assert r.status_code == 200


async def test_flat_user_list_filters(client):
    a = await make_client(client, name="Alpha")
    b = await make_client(client, name="Beta")
    ua = await make_user(client, a["id"], name="Aaron", email="aaron@a.com")
    await make_user(client, b["id"], name="Bella", email="bella@b.com")

    r = await client.get("/api/users", params={"client_id": a["id"]}, headers=ADMIN)
    assert [u["id"] for u in r.json()] == [ua["id"]]
    assert r.json()[0]["client"]["name"] == "Alpha"

    r = await client.get("/api/users", params={"q": "bella"}, headers=ADMIN)
    assert [u["name"] for u in r.json()] == ["Bella"]


async def test_update_user(client, db):
    made = await make_client(client)
    u = await make_user(client, made["id"], name="Before")
    r = await client.patch(
        f"/api/users/{u['id']}",
        json={"name": "After", "email": "after@x.com"},
        headers={"X-User-Email": "tedi@alpharoc.ai"},  # admin edits
    )
    assert r.status_code == 200
    assert r.json()["name"] == "After"
    row = await db.fetchrow(
        "SELECT updated_by_email FROM client_users WHERE id = $1", u["id"]
    )
    assert row["updated_by_email"] == "tedi@alpharoc.ai"
