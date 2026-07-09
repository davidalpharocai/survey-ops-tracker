"""Editor attribution: PATCH stamps updated_by_email/updated_at while the
original actor_email stays untouched.

``updated_by_email`` is not serialised by ``transaction_dict``, so these
assertions go straight to the database.
"""

from conftest import ADMIN, USER, make_client, make_contract, make_study, make_user


async def test_create_sets_actor_email_only(client, db):
    made = await make_client(client)
    body = await make_contract(client, made["id"])
    row = await db.fetchrow(
        "SELECT actor_email, updated_by_email, updated_at "
        "FROM transactions WHERE id = $1",
        body["id"],
    )
    assert row["actor_email"] == "david@alpharoc.ai"
    assert row["updated_by_email"] is None
    assert row["updated_at"] is None


async def test_patch_contract_sets_updated_by_caller(client, db):
    made = await make_client(client)
    body = await make_contract(client, made["id"])  # created by david
    r = await client.patch(
        f"/api/contracts/{body['id']}",
        json={
            "client_id": made["id"],
            "name": "Edited deal",
            "occurred_on": "2024-02-01",
            "renewal_on": "2025-02-01",
            "credits_amount": 1200,
            "dollars_amount": 0,
        },
        headers=USER,  # sarah edits
    )
    assert r.status_code == 200
    assert r.json()["actorEmail"] == "david@alpharoc.ai"  # unchanged
    row = await db.fetchrow(
        "SELECT actor_email, updated_by_email, updated_at "
        "FROM transactions WHERE id = $1",
        body["id"],
    )
    assert row["actor_email"] == "david@alpharoc.ai"
    assert row["updated_by_email"] == "sarah@alpharoc.ai"
    assert row["updated_at"] is not None


async def test_patch_study_sets_updated_by_caller(client, db):
    made = await make_client(client)
    user = await make_user(client, made["id"])
    body = await make_study(client, made["id"], [user["id"]])  # by david
    r = await client.patch(
        f"/api/studies/{body['id']}",
        json={
            "client_id": made["id"],
            "name": "Edited study",
            "occurred_on": "2024-03-02",
            "cost_type": "credits",
            "cost": 130,
            "client_user_ids": [user["id"]],
        },
        headers=USER,
    )
    assert r.status_code == 200
    row = await db.fetchrow(
        "SELECT actor_email, updated_by_email FROM transactions WHERE id = $1",
        body["id"],
    )
    assert row["actor_email"] == "david@alpharoc.ai"
    assert row["updated_by_email"] == "sarah@alpharoc.ai"


async def test_delete_stamps_updated_by(client, db):
    made = await make_client(client)
    body = await make_contract(client, made["id"])
    r = await client.delete(f"/api/contracts/{body['id']}", headers=USER)
    assert r.status_code == 200
    row = await db.fetchrow(
        "SELECT updated_by_email, deleted_at FROM transactions WHERE id = $1",
        body["id"],
    )
    assert row["updated_by_email"] == "sarah@alpharoc.ai"
    assert row["deleted_at"] is not None
