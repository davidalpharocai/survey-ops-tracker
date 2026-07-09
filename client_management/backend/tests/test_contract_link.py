"""Contract-linked ledger — study→contract link validation (Phase 1)
and the archive guard (Phase 2)."""

from tests.conftest import (
    ADMIN,
    make_client,
    make_contract,
    make_study,
    make_user,
)


async def test_create_study_links_to_contract(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    con = await make_contract(client, c["id"], name="Retainer", credits_amount=1000)
    r = await client.post(
        "/api/studies",
        json={
            "client_id": c["id"],
            "name": "S1",
            "occurred_on": "2024-03-01",
            "cost_type": "credits",
            "cost": 100,
            "client_user_ids": [u["id"]],
            "contract_id": con["id"],
        },
        headers=ADMIN,
    )
    assert r.status_code == 201, r.text
    assert r.json()["contractId"] == con["id"]


async def test_create_study_unassigned_by_default(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    study = await make_study(client, c["id"], [u["id"]], name="Loose")
    assert study["contractId"] is None


async def test_create_study_rejects_foreign_contract(client):
    a = await make_client(client, name="Client A")
    con_a = await make_contract(client, a["id"], name="A-Contract")
    b = await make_client(client, name="Client B")
    ub = await make_user(client, b["id"])
    r = await client.post(
        "/api/studies",
        json={
            "client_id": b["id"],
            "name": "cross",
            "occurred_on": "2024-03-01",
            "cost_type": "credits",
            "cost": 50,
            "client_user_ids": [ub["id"]],
            "contract_id": con_a["id"],  # belongs to client A
        },
        headers=ADMIN,
    )
    assert r.status_code == 400, r.text


async def test_create_study_rejects_non_contract(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    other_study = await make_study(client, c["id"], [u["id"]], name="not-a-contract")
    r = await client.post(
        "/api/studies",
        json={
            "client_id": c["id"],
            "name": "bad-link",
            "occurred_on": "2024-03-01",
            "cost_type": "credits",
            "cost": 50,
            "client_user_ids": [u["id"]],
            "contract_id": other_study["id"],  # a study id, not a contract
        },
        headers=ADMIN,
    )
    assert r.status_code == 400, r.text


async def test_update_study_reassigns_and_unlinks(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    con = await make_contract(client, c["id"], name="Retainer", credits_amount=1000)
    study = await make_study(client, c["id"], [u["id"]], name="S", contract_id=con["id"])
    assert study["contractId"] == con["id"]

    base = {
        "name": "S",
        "occurred_on": "2024-03-01",
        "cost_type": "credits",
        "cost": 100,
        "client_user_ids": [u["id"]],
    }
    # Unlink (contract_id omitted -> None means unlink per the design).
    r = await client.patch(f"/api/studies/{study['id']}", json=base, headers=ADMIN)
    assert r.status_code == 200, r.text
    assert r.json()["contractId"] is None

    # Relink.
    r = await client.patch(
        f"/api/studies/{study['id']}",
        json={**base, "contract_id": con["id"]},
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    assert r.json()["contractId"] == con["id"]


async def test_cannot_archive_contract_with_active_linked_studies(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    con = await make_contract(client, c["id"], name="C")
    await make_study(client, c["id"], [u["id"]], name="s", contract_id=con["id"])
    r = await client.delete(f"/api/contracts/{con['id']}", headers=ADMIN)
    assert r.status_code == 409, r.text


async def test_can_archive_contract_after_linked_studies_archived(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    con = await make_contract(client, c["id"], name="C")
    study = await make_study(client, c["id"], [u["id"]], name="s", contract_id=con["id"])
    d = await client.delete(f"/api/studies/{study['id']}", headers=ADMIN)
    assert d.status_code == 200, d.text
    r = await client.delete(f"/api/contracts/{con['id']}", headers=ADMIN)
    assert r.status_code == 200, r.text


async def test_update_study_rejects_foreign_contract(client):
    a = await make_client(client, name="AA")
    con_a = await make_contract(client, a["id"], name="AA-Con")
    b = await make_client(client, name="BB")
    ub = await make_user(client, b["id"])
    study = await make_study(client, b["id"], [ub["id"]], name="s")
    r = await client.patch(
        f"/api/studies/{study['id']}",
        json={
            "name": "s",
            "occurred_on": "2024-03-01",
            "cost_type": "credits",
            "cost": 100,
            "client_user_ids": [ub["id"]],
            "contract_id": con_a["id"],
        },
        headers=ADMIN,
    )
    assert r.status_code == 400, r.text
