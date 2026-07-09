"""Admin archive endpoints: listing archived rows and restoring them.

Encodes the restore rule: archiving a client stamps only the client row
(children are hidden by the parent join/404, never individually stamped),
so restoring the client alone brings them back — while a child archived
individually stays archived, and a child cannot be restored while its
owning client is still archived (409).
"""

from conftest import (
    ADMIN,
    USER,
    get_balances,
    make_client,
    make_contract,
    make_user,
)


async def _archive_client(client, client_id):
    r = await client.delete(f"/api/clients/{client_id}", headers=ADMIN)
    assert r.status_code == 200, r.text


async def _restore(client, kind, rec_id, headers=ADMIN):
    return await client.post(
        "/api/admin/archive/restore",
        json={"type": kind, "id": rec_id},
        headers=headers,
    )


# --- Access control ---------------------------------------------------------


async def test_archive_list_requires_admin(client):
    r = await client.get("/api/admin/archive", headers=USER)
    assert r.status_code == 403


async def test_restore_requires_admin(client):
    r = await _restore(client, "client", 1, headers=USER)
    assert r.status_code == 403


# --- Listing ----------------------------------------------------------------


async def test_empty_archive(client):
    r = await client.get("/api/admin/archive", headers=ADMIN)
    assert r.status_code == 200
    assert r.json() == {"clients": [], "users": [], "transactions": []}


async def test_archived_client_listed_with_who_and_when(client):
    made = await make_client(client, name="Gone Inc")
    await _archive_client(client, made["id"])

    body = (await client.get("/api/admin/archive", headers=ADMIN)).json()
    assert len(body["clients"]) == 1
    row = body["clients"][0]
    assert row["id"] == made["id"]
    assert row["name"] == "Gone Inc"
    assert row["deletedAt"] is not None
    assert row["updatedByEmail"] == "david@alpharoc.ai"  # who archived
    assert body["users"] == []
    assert body["transactions"] == []


async def test_archived_children_listed_with_client_name(client):
    made = await make_client(client, name="Parent Co")
    other = await make_user(client, made["id"], name="Keep Me")
    user = await make_user(client, made["id"], name="Old Contact")
    txn = await make_contract(client, made["id"], name="Old Deal")
    # Archive the user (reassign-guard: it has no transactions) and the txn.
    del_u = await client.delete(f"/api/users/{user['id']}", headers=ADMIN)
    assert del_u.status_code == 200, del_u.text
    del_t = await client.delete(f"/api/contracts/{txn['id']}", headers=ADMIN)
    assert del_t.status_code == 200
    assert other  # untouched contact stays out of the archive

    body = (await client.get("/api/admin/archive", headers=ADMIN)).json()
    assert body["clients"] == []
    assert [u["name"] for u in body["users"]] == ["Old Contact"]
    assert body["users"][0]["clientName"] == "Parent Co"
    assert [t["name"] for t in body["transactions"]] == ["Old Deal"]
    assert body["transactions"][0]["clientName"] == "Parent Co"
    assert body["transactions"][0]["kind"] == "contract"


async def test_archive_lists_newest_deleted_first(client):
    a = await make_client(client, name="First Archived")
    b = await make_client(client, name="Second Archived")
    await _archive_client(client, a["id"])
    await _archive_client(client, b["id"])

    body = (await client.get("/api/admin/archive", headers=ADMIN)).json()
    # Same-second deletes fall back to id desc — still newest first.
    assert [c["name"] for c in body["clients"]] == [
        "Second Archived",
        "First Archived",
    ]


# --- Restore: clients -------------------------------------------------------


async def test_restore_client_brings_it_back(client):
    made = await make_client(client, name="Phoenix Inc")
    await _archive_client(client, made["id"])
    assert (
        await client.get(f"/api/clients/{made['id']}", headers=ADMIN)
    ).status_code == 404

    r = await _restore(client, "client", made["id"])
    assert r.status_code == 200
    assert r.json() == {"type": "client", "id": made["id"], "name": "Phoenix Inc"}

    # Back in GET-by-id and the list; out of the archive.
    assert (
        await client.get(f"/api/clients/{made['id']}", headers=ADMIN)
    ).status_code == 200
    names = [
        c["name"]
        for c in (await client.get("/api/clients", headers=ADMIN)).json()
    ]
    assert names == ["Phoenix Inc"]
    body = (await client.get("/api/admin/archive", headers=ADMIN)).json()
    assert body["clients"] == []


async def test_restore_client_stamps_restorer(client, db):
    made = await make_client(client, name="Attr Restore")
    await _archive_client(client, made["id"])
    # tedi@ is also in CCM_ADMIN_EMAILS (see conftest).
    r = await _restore(
        client, "client", made["id"], headers={"X-User-Email": "tedi@alpharoc.ai"}
    )
    assert r.status_code == 200
    row = await db.fetchrow(
        "SELECT deleted_at, updated_by_email FROM clients WHERE id = $1",
        made["id"],
    )
    assert row["deleted_at"] is None
    assert row["updated_by_email"] == "tedi@alpharoc.ai"


async def test_restore_client_makes_unstamped_children_visible_again(client):
    # THE RULE: archiving a client never stamps its children, so restoring
    # the client alone makes contacts/transactions visible again.
    made = await make_client(client, name="Family Co")
    user = await make_user(client, made["id"], name="Hidden Contact")
    await make_contract(client, made["id"], credits_amount=500)
    await _archive_client(client, made["id"])

    r = await _restore(client, "client", made["id"])
    assert r.status_code == 200

    users = (
        await client.get(f"/api/clients/{made['id']}/users", headers=ADMIN)
    ).json()
    assert [u["id"] for u in users] == [user["id"]]
    assert (await get_balances(client, made["id"]))["credits"] == 500.0
    report = (await client.get("/api/reports/balances", headers=ADMIN)).json()
    assert [row["client"]["id"] for row in report] == [made["id"]]


async def test_restore_client_leaves_individually_archived_children_archived(
    client,
):
    made = await make_client(client, name="Partial Co")
    txn = await make_contract(client, made["id"], name="Voided Deal")
    del_t = await client.delete(f"/api/contracts/{txn['id']}", headers=ADMIN)
    assert del_t.status_code == 200  # archived individually, BEFORE the client
    await _archive_client(client, made["id"])

    r = await _restore(client, "client", made["id"])
    assert r.status_code == 200

    # The individually archived contract stays archived...
    assert (
        await client.get(f"/api/clients/{made['id']}/contracts", headers=ADMIN)
    ).json() == []
    # ...and remains restorable from the archive page.
    body = (await client.get("/api/admin/archive", headers=ADMIN)).json()
    assert [t["id"] for t in body["transactions"]] == [txn["id"]]


async def test_restore_client_with_reused_name_409(client):
    made = await make_client(client, name="Reborn LLC")
    await _archive_client(client, made["id"])
    await make_client(client, name="Reborn LLC")  # name reused while archived

    r = await _restore(client, "client", made["id"])
    assert r.status_code == 409
    assert "Reborn LLC" in r.json()["detail"]


# --- Restore: children gated on the owning client ---------------------------


async def test_restore_user_of_archived_client_409(client):
    made = await make_client(client, name="Locked Co")
    user = await make_user(client, made["id"], name="Trapped")
    del_u = await client.delete(f"/api/users/{user['id']}", headers=ADMIN)
    assert del_u.status_code == 200
    await _archive_client(client, made["id"])

    r = await _restore(client, "user", user["id"])
    assert r.status_code == 409
    assert "Restore the client first" in r.json()["detail"]

    # Restore the client, then the contact goes through.
    assert (await _restore(client, "client", made["id"])).status_code == 200
    r = await _restore(client, "user", user["id"])
    assert r.status_code == 200
    users = (
        await client.get(f"/api/clients/{made['id']}/users", headers=ADMIN)
    ).json()
    assert [u["name"] for u in users] == ["Trapped"]


async def test_restore_transaction_of_archived_client_409(client):
    made = await make_client(client, name="Frozen Co")
    txn = await make_contract(client, made["id"])
    del_t = await client.delete(f"/api/contracts/{txn['id']}", headers=ADMIN)
    assert del_t.status_code == 200
    await _archive_client(client, made["id"])

    r = await _restore(client, "transaction", txn["id"])
    assert r.status_code == 409
    assert "Restore the client first" in r.json()["detail"]


async def test_restore_transaction_restores_balance(client):
    made = await make_client(client)
    txn = await make_contract(client, made["id"], credits_amount=750)
    del_t = await client.delete(f"/api/contracts/{txn['id']}", headers=ADMIN)
    assert del_t.status_code == 200
    assert (await get_balances(client, made["id"]))["credits"] == 0.0

    r = await _restore(client, "transaction", txn["id"])
    assert r.status_code == 200
    assert (await get_balances(client, made["id"]))["credits"] == 750.0
    contracts = (
        await client.get(f"/api/clients/{made['id']}/contracts", headers=ADMIN)
    ).json()
    assert [c["id"] for c in contracts] == [txn["id"]]


# --- Restore: bad input -----------------------------------------------------


async def test_restore_unknown_type_400(client):
    r = await _restore(client, "spaceship", 1)
    assert r.status_code == 400


async def test_restore_missing_or_active_record_404(client):
    made = await make_client(client, name="Active Co")
    # Nonexistent id.
    assert (await _restore(client, "client", 4242)).status_code == 404
    # Exists but is not archived.
    assert (await _restore(client, "client", made["id"])).status_code == 404
