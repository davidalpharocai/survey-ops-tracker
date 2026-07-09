"""Contract endpoints: balance effect, validation 400s, money parsing,
socc_project_code, soft delete."""

from conftest import ADMIN, get_balances, make_client, make_contract


def _payload(client_id, **overrides):
    base = {
        "client_id": client_id,
        "name": "Deal",
        "occurred_on": "2024-02-01",
        "renewal_on": "2025-02-01",
        "credits_amount": 100,
        "dollars_amount": 0,
    }
    base.update(overrides)
    return base


async def test_contract_adds_credits_and_dollars(client):
    made = await make_client(client)
    body = await make_contract(
        client, made["id"], credits_amount=1000, dollars_amount=2500.5
    )
    assert body["kind"] == "contract"
    assert body["creditsAmount"] == 1000.0
    assert body["dollarsAmount"] == 2500.5
    assert body["creditsDelta"] == 1000.0
    assert body["dollarsDelta"] == 2500.5
    assert body["clientName"] == made["name"]

    bal = await get_balances(client, made["id"])
    assert bal["credits"] == 1000.0
    assert bal["dollars"] == 2500.5


async def test_contract_missing_occurred_on_400(client):
    made = await make_client(client)
    p = _payload(made["id"])
    del p["occurred_on"]
    r = await client.post("/api/contracts", json=p, headers=ADMIN)
    assert r.status_code == 400
    assert r.json()["detail"] == "Contract date is required."


async def test_contract_garbage_occurred_on_400(client):
    made = await make_client(client)
    r = await client.post(
        "/api/contracts", json=_payload(made["id"], occurred_on="bogus"), headers=ADMIN
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Contract date is required."


async def test_contract_garbage_renewal_400(client):
    made = await make_client(client)
    r = await client.post(
        "/api/contracts",
        json=_payload(made["id"], renewal_on="not-a-date"),
        headers=ADMIN,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Renewal date must be a valid date."


async def test_contract_renewal_not_after_occurred_400(client):
    made = await make_client(client)
    for renewal in ("2024-02-01", "2024-01-31"):  # equal and before
        r = await client.post(
            "/api/contracts",
            json=_payload(made["id"], renewal_on=renewal),
            headers=ADMIN,
        )
        assert r.status_code == 400
        assert r.json()["detail"] == "Renewal date must be after the contract date."


async def test_contract_negative_amount_400(client):
    made = await make_client(client)
    r = await client.post(
        "/api/contracts", json=_payload(made["id"], credits_amount=-5), headers=ADMIN
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Contract amounts must be non-negative."


async def test_contract_both_amounts_zero_400(client):
    made = await make_client(client)
    r = await client.post(
        "/api/contracts",
        json=_payload(made["id"], credits_amount=0, dollars_amount=0),
        headers=ADMIN,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Enter at least one of credits or dollars."


async def test_contract_money_typo_400_not_500(client):
    # "1O0" (letter O) must surface as a 400 MoneyParseError, never a
    # silent 0 or a 500.
    made = await make_client(client)
    r = await client.post(
        "/api/contracts",
        json=_payload(made["id"], credits_amount="1O0"),
        headers=ADMIN,
    )
    assert r.status_code == 400
    assert "1O0" in r.json()["detail"]


async def test_contract_formatted_money_accepted(client):
    made = await make_client(client)
    body = await make_contract(
        client, made["id"], credits_amount="$1,500", dollars_amount="1,000.50"
    )
    assert body["creditsAmount"] == 1500.0
    assert body["dollarsAmount"] == 1000.5


async def test_contract_blank_renewal_defaults_to_one_year(client):
    made = await make_client(client)
    body = await make_contract(
        client, made["id"], occurred_on="2024-03-15", renewal_on=""
    )
    assert body["renewalOn"] == "2025-03-15T00:00:00Z"


async def test_contract_missing_client_404(client):
    r = await client.post("/api/contracts", json=_payload(4242), headers=ADMIN)
    assert r.status_code == 404


async def test_contract_socc_project_code_roundtrip(client):
    made = await make_client(client)
    body = await make_contract(client, made["id"], socc_project_code="PR00123")
    assert body["soccProjectCode"] == "PR00123"

    # PATCH omitting socc_project_code preserves it.
    r = await client.patch(
        f"/api/contracts/{body['id']}",
        json=_payload(made["id"], name="Deal v2"),
        headers=ADMIN,
    )
    assert r.status_code == 200
    assert r.json()["soccProjectCode"] == "PR00123"
    assert r.json()["name"] == "Deal v2"

    # PATCH with an explicit empty string clears it.
    r = await client.patch(
        f"/api/contracts/{body['id']}",
        json=_payload(made["id"], socc_project_code="  "),
        headers=ADMIN,
    )
    assert r.json()["soccProjectCode"] is None


async def test_patch_contract_money_typo_400(client):
    made = await make_client(client)
    body = await make_contract(client, made["id"])
    r = await client.patch(
        f"/api/contracts/{body['id']}",
        json=_payload(made["id"], dollars_amount="1O0"),
        headers=ADMIN,
    )
    assert r.status_code == 400


async def test_delete_contract_soft(client, db):
    made = await make_client(client)
    body = await make_contract(client, made["id"], credits_amount=750)
    assert (await get_balances(client, made["id"]))["credits"] == 750.0

    r = await client.delete(f"/api/contracts/{body['id']}", headers=ADMIN)
    assert r.status_code == 200

    # Balance restored, gone from lists and single-txn GET...
    assert (await get_balances(client, made["id"]))["credits"] == 0.0
    assert (await client.get(f"/api/clients/{made['id']}/contracts", headers=ADMIN)).json() == []
    assert (await client.get(f"/api/transactions/{body['id']}", headers=ADMIN)).status_code == 404

    # ...but the row survives in the database.
    row = await db.fetchrow(
        "SELECT deleted_at FROM transactions WHERE id = $1", body["id"]
    )
    assert row is not None and row["deleted_at"] is not None


async def test_get_transaction_returns_contract(client):
    made = await make_client(client)
    body = await make_contract(client, made["id"])
    r = await client.get(f"/api/transactions/{body['id']}", headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["kind"] == "contract"
    assert r.json()["clientId"] == made["id"]
