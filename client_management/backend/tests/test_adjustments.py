"""Adjustment endpoint: signed correction rows, validation, reversal
references, balance flow-through, and idempotency."""

from datetime import datetime, timezone

from conftest import ADMIN, USER, get_balances, make_client, make_contract


def _payload(client_id, **overrides):
    base = {
        "client_id": client_id,
        "credits_delta": -100,
        "dollars_delta": 0,
        "note": "Billing correction",
    }
    base.update(overrides)
    return base


async def make_adjustment(client, client_id, headers=ADMIN, **overrides):
    r = await client.post(
        "/api/adjustments", json=_payload(client_id, **overrides), headers=headers
    )
    return r


# --- Creation ----------------------------------------------------------------


async def test_adjustment_creates_new_ledger_row(client):
    made = await make_client(client)
    r = await make_adjustment(client, made["id"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "adjustment"
    assert body["name"] == "Adjustment"
    assert body["creditsDelta"] == -100.0
    assert body["dollarsDelta"] == 0.0
    assert body["note"] == "Billing correction"
    assert body["actorEmail"] == "david@alpharoc.ai"
    assert body["clientName"] == made["name"]
    assert body["reversesTransactionId"] is None
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    assert body["occurredOn"] == f"{today}T00:00:00Z"


async def test_adjustment_allows_plain_users(client):
    made = await make_client(client)
    r = await make_adjustment(client, made["id"], headers=USER)
    assert r.status_code == 201
    assert r.json()["actorEmail"] == "sarah@alpharoc.ai"


async def test_adjustment_flows_into_balances_and_log(client):
    # reports.py sums ALL of a client's transactions regardless of kind,
    # so an adjustment moves the balance with no report changes.
    made = await make_client(client)
    await make_contract(client, made["id"], credits_amount=1000, dollars_amount=100)
    r = await make_adjustment(
        client, made["id"], credits_delta=-250, dollars_delta="$50"
    )
    assert r.status_code == 201

    bal = await get_balances(client, made["id"])
    assert bal["credits"] == 750.0
    assert bal["dollars"] == 150.0

    log = (
        await client.get(f"/api/clients/{made['id']}/transactions", headers=ADMIN)
    ).json()
    assert [t["kind"] for t in log] == ["adjustment", "contract"]


async def test_adjustment_signed_both_directions(client):
    made = await make_client(client)
    r = await make_adjustment(
        client, made["id"], credits_delta=500, dollars_delta=-75.5
    )
    assert r.status_code == 201
    body = r.json()
    assert body["creditsDelta"] == 500.0
    assert body["dollarsDelta"] == -75.5


# --- Validation ---------------------------------------------------------------


async def test_adjustment_note_required(client):
    made = await make_client(client)
    for note in ("", "   ", None):
        r = await make_adjustment(client, made["id"], note=note)
        assert r.status_code == 400
        assert "note" in r.json()["detail"].lower()


async def test_adjustment_both_deltas_zero_400(client):
    made = await make_client(client)
    r = await make_adjustment(
        client, made["id"], credits_delta=0, dollars_delta=""
    )
    assert r.status_code == 400
    assert "non-zero" in r.json()["detail"]


async def test_adjustment_money_typo_400(client):
    made = await make_client(client)
    r = await make_adjustment(client, made["id"], credits_delta="1O0")
    assert r.status_code == 400
    assert "1O0" in r.json()["detail"]


async def test_adjustment_missing_client_404(client):
    r = await make_adjustment(client, 4242)
    assert r.status_code == 404


async def test_adjustment_archived_client_404(client):
    made = await make_client(client)
    await client.delete(f"/api/clients/{made['id']}", headers=ADMIN)
    r = await make_adjustment(client, made["id"])
    assert r.status_code == 404


# --- Reversal references -------------------------------------------------------


async def test_adjustment_reversing_names_the_original(client):
    made = await make_client(client)
    txn = await make_contract(client, made["id"], credits_amount=1000)
    r = await make_adjustment(
        client,
        made["id"],
        credits_delta=-1000,
        note="Contract voided",
        reverses_transaction_id=txn["id"],
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == f"Adjustment of #{txn['id']}"
    assert body["reversesTransactionId"] == txn["id"]
    assert (await get_balances(client, made["id"]))["credits"] == 0.0


async def test_adjustment_reversing_missing_transaction_404(client):
    made = await make_client(client)
    r = await make_adjustment(
        client, made["id"], reverses_transaction_id=4242
    )
    assert r.status_code == 404


async def test_adjustment_reversing_archived_transaction_404(client):
    made = await make_client(client)
    txn = await make_contract(client, made["id"])
    await client.delete(f"/api/contracts/{txn['id']}", headers=ADMIN)
    r = await make_adjustment(
        client, made["id"], reverses_transaction_id=txn["id"]
    )
    assert r.status_code == 404


async def test_adjustment_reversing_other_clients_transaction_400(client):
    mine = await make_client(client, name="Mine Co")
    theirs = await make_client(client, name="Theirs Co")
    txn = await make_contract(client, theirs["id"])
    r = await make_adjustment(
        client, mine["id"], reverses_transaction_id=txn["id"]
    )
    assert r.status_code == 400
    assert "different client" in r.json()["detail"]


# --- Idempotency ----------------------------------------------------------------


async def test_adjustment_idempotency_key_replay_returns_same_row(client, db):
    made = await make_client(client)
    headers = {**ADMIN, "Idempotency-Key": "adj-abc-1"}
    first = await client.post(
        "/api/adjustments", json=_payload(made["id"]), headers=headers
    )
    assert first.status_code == 201
    second = await client.post(
        "/api/adjustments", json=_payload(made["id"]), headers=headers
    )
    assert second.status_code in (200, 201)
    assert second.json()["id"] == first.json()["id"]

    count = await db.fetchval(
        "SELECT count(*) FROM transactions WHERE kind = 'adjustment'"
    )
    assert count == 1
    # The balance moved exactly once.
    assert (await get_balances(client, made["id"]))["credits"] == -100.0


async def test_adjustment_different_keys_create_two_rows(client, db):
    made = await make_client(client)
    for key in ("adj-key-1", "adj-key-2"):
        r = await client.post(
            "/api/adjustments",
            json=_payload(made["id"]),
            headers={**ADMIN, "Idempotency-Key": key},
        )
        assert r.status_code == 201
    count = await db.fetchval(
        "SELECT count(*) FROM transactions WHERE kind = 'adjustment'"
    )
    assert count == 2
