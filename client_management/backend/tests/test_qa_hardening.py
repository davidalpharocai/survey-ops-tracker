"""Regression tests for the overnight QA-hardening pass.

Each test pins one confirmed finding so it cannot silently regress:

* money parsing rejects nan/inf (not just non-numeric typos);
* negative setup costs are refused;
* the balance-health run-out projection can't overflow the date type;
* writes against an archived client 404 instead of resurrecting it;
* idempotency keys are namespaced per kind (no wrong-kind replay);
* study attribution ignores archived contacts;
* user search is case-insensitive and treats %/_ literally;
* client-name uniqueness is case-insensitive on create;
* the public root endpoint does not disclose the build version.
"""

from datetime import date, timedelta

from tests.conftest import (
    ADMIN,
    make_client,
    make_contract,
    make_study,
    make_user,
)


# --- Money parsing ---------------------------------------------------------


async def test_contract_rejects_nan_amount(client):
    made = await make_client(client)
    r = await client.post(
        "/api/contracts",
        json={
            "client_id": made["id"],
            "name": "Bad",
            "occurred_on": "2024-02-01",
            "credits_amount": "nan",
        },
        headers=ADMIN,
    )
    assert r.status_code == 400, r.text


async def test_contract_rejects_infinite_amount(client):
    made = await make_client(client)
    r = await client.post(
        "/api/contracts",
        json={
            "client_id": made["id"],
            "name": "Bad",
            "occurred_on": "2024-02-01",
            "credits_amount": "1e400",  # floats to +inf
        },
        headers=ADMIN,
    )
    assert r.status_code == 400, r.text


# --- Negative setup cost ---------------------------------------------------


async def test_study_rejects_negative_setup_cost(client):
    made = await make_client(client)
    user = await make_user(client, made["id"])
    r = await client.post(
        "/api/studies",
        json={
            "client_id": made["id"],
            "name": "Recurring",
            "occurred_on": "2024-03-01",
            "cost_type": "credits",
            "cadence": "monthly",
            "cost_per_run": 10,
            "setup_cost": -100,
            "client_user_ids": [user["id"]],
        },
        headers=ADMIN,
    )
    assert r.status_code == 400, r.text


# --- Balance-health run-out overflow --------------------------------------


async def test_balance_health_survives_tiny_burn(client):
    # A huge balance draining at a sliver of a credit per month projects a
    # run-out millions of days out. Before the guard, today + timedelta(days)
    # raised OverflowError and 500'd the whole report; now it returns null.
    made = await make_client(client)
    user = await make_user(client, made["id"])
    recent = (date.today() - timedelta(days=10)).isoformat()
    renewal = (date.today() + timedelta(days=355)).isoformat()
    await make_contract(
        client,
        made["id"],
        name="Big prepay",
        occurred_on=recent,
        renewal_on=renewal,
        credits_amount=1_000_000,
    )
    await make_study(
        client,
        made["id"],
        [user["id"]],
        name="Tiny recent burn",
        occurred_on=recent,
        cost=1,
    )
    r = await client.get("/api/reports/balance-health", headers=ADMIN)
    assert r.status_code == 200, r.text
    rows = {row["client"]["id"]: row for row in r.json()}
    assert made["id"] in rows
    # Overflowed projection is reported as "no foreseeable run-out".
    assert rows[made["id"]]["creditsRunOutOn"] is None


# --- Archived-client write guards -----------------------------------------


async def test_cannot_add_contract_to_archived_client(client):
    made = await make_client(client)
    await client.delete(f"/api/clients/{made['id']}", headers=ADMIN)
    r = await client.post(
        "/api/contracts",
        json={
            "client_id": made["id"],
            "name": "Ghost",
            "occurred_on": "2024-02-01",
            "credits_amount": 100,
        },
        headers=ADMIN,
    )
    assert r.status_code == 404, r.text


async def test_cannot_add_user_to_archived_client(client):
    made = await make_client(client)
    await client.delete(f"/api/clients/{made['id']}", headers=ADMIN)
    r = await client.post(
        f"/api/clients/{made['id']}/users",
        json={"name": "Ghost"},
        headers=ADMIN,
    )
    assert r.status_code == 404, r.text


# --- Idempotency namespacing ----------------------------------------------


async def test_idempotency_key_is_namespaced_per_kind(client):
    made = await make_client(client)
    user = await make_user(client, made["id"])
    key = {"Idempotency-Key": "shared-key-123", **ADMIN}

    c1 = await client.post(
        "/api/contracts",
        json={
            "client_id": made["id"],
            "name": "Contract A",
            "occurred_on": "2024-02-01",
            "credits_amount": 500,
        },
        headers=key,
    )
    assert c1.status_code == 201, c1.text
    contract = c1.json()

    # Replaying the SAME key on the SAME endpoint returns the same row.
    c2 = await client.post(
        "/api/contracts",
        json={
            "client_id": made["id"],
            "name": "Contract A",
            "occurred_on": "2024-02-01",
            "credits_amount": 500,
        },
        headers=key,
    )
    assert c2.status_code == 201, c2.text
    assert c2.json()["id"] == contract["id"]

    # The same key on a DIFFERENT endpoint must create a fresh row, not
    # replay the contract back as if it were a study.
    s1 = await client.post(
        "/api/studies",
        json={
            "client_id": made["id"],
            "name": "Study B",
            "occurred_on": "2024-03-01",
            "cost_type": "credits",
            "cost": 100,
            "client_user_ids": [user["id"]],
        },
        headers=key,
    )
    assert s1.status_code == 201, s1.text
    study = s1.json()
    assert study["id"] != contract["id"]
    assert study["kind"] == "study"


# --- Study attribution ignores archived contacts --------------------------


async def test_study_rejects_archived_contact(client):
    made = await make_client(client)
    user = await make_user(client, made["id"])
    # Archive the contact (no transactions yet, so this succeeds).
    d = await client.delete(f"/api/users/{user['id']}", headers=ADMIN)
    assert d.status_code == 200, d.text
    r = await client.post(
        "/api/studies",
        json={
            "client_id": made["id"],
            "name": "Study",
            "occurred_on": "2024-03-01",
            "cost_type": "credits",
            "cost": 100,
            "client_user_ids": [user["id"]],
        },
        headers=ADMIN,
    )
    assert r.status_code == 400, r.text


# --- User search: case-insensitive + literal metacharacters ---------------


async def test_user_search_is_case_insensitive(client):
    made = await make_client(client)
    await make_user(client, made["id"], name="Alpha Bravo")
    await make_user(client, made["id"], name="Charlie Delta")
    r = await client.get("/api/users", params={"q": "ALPHA"}, headers=ADMIN)
    assert r.status_code == 200, r.text
    names = [u["name"] for u in r.json()]
    assert names == ["Alpha Bravo"]


async def test_user_search_treats_percent_literally(client):
    made = await make_client(client)
    await make_user(client, made["id"], name="Alpha Bravo")
    await make_user(client, made["id"], name="Fifty % Off")
    # Unescaped, "%" is a LIKE wildcard matching everyone; escaped, it only
    # matches the contact whose name literally contains a percent sign.
    r = await client.get("/api/users", params={"q": "%"}, headers=ADMIN)
    assert r.status_code == 200, r.text
    names = [u["name"] for u in r.json()]
    assert names == ["Fifty % Off"]


# --- Case-insensitive client-name uniqueness ------------------------------


async def test_client_create_dup_is_case_insensitive(client):
    await make_client(client, name="Acme Corp")
    r = await client.post(
        "/api/clients",
        json={"name": "acme corp", "became_on": "2024-01-15"},
        headers=ADMIN,
    )
    assert r.status_code == 409, r.text


# --- Root endpoint does not leak the build version ------------------------


async def test_root_hides_version(client):
    r = await client.get("/")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "version" not in body
    assert body["status"] == "ok"
