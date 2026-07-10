"""Study endpoints: cadence math, setup-cost folding, validation,
attribution rules, soft delete, and bulk-update."""

import pytest

from conftest import (
    ADMIN,
    get_balances,
    make_client,
    make_contract,
    make_study,
    make_user,
)


async def _client_with_user(client):
    made = await make_client(client)
    user = await make_user(client, made["id"])
    return made, user


def _study_payload(client_id, user_ids, **overrides):
    base = {
        "client_id": client_id,
        "name": "Study",
        "occurred_on": "2024-03-01",
        "cost_type": "credits",
        "cost": 100,
        "client_user_ids": user_ids,
    }
    base.update(overrides)
    return base


# --- Cost arithmetic --------------------------------------------------------


async def test_single_credits_study_subtracts_total(client):
    made, user = await _client_with_user(client)
    body = await make_study(client, made["id"], [user["id"]], cost=100)
    assert body["creditsDelta"] == -100.0
    assert body["dollarsDelta"] == 0.0
    assert body["cadence"] is None
    bal = await get_balances(client, made["id"])
    assert bal["credits"] == -100.0


async def test_single_dollars_study_subtracts_dollars_only(client):
    made, user = await _client_with_user(client)
    body = await make_study(
        client, made["id"], [user["id"]], cost_type="dollars", cost=250
    )
    assert body["dollarsDelta"] == -250.0
    assert body["creditsDelta"] == 0.0
    bal = await get_balances(client, made["id"])
    assert bal["dollars"] == -250.0
    assert bal["credits"] == 0.0


async def test_monthly_tracker_with_setup_credits(client):
    # monthly x12 * 10 per run + 20 setup, all on the credits side.
    made, user = await _client_with_user(client)
    body = await make_study(
        client,
        made["id"],
        [user["id"]],
        cadence="monthly",
        cost=10,
        setup_cost=20,
    )
    assert body["creditsDelta"] == -140.0
    assert body["dollarsDelta"] == 0.0
    assert body["cadence"] == "monthly"
    assert body["costPerRun"] == 10.0
    assert body["setupCost"] == 20.0


async def test_tracker_setup_folds_into_credits_even_for_dollars(client):
    # Confirmed from study_logic/studies.py: setup cost is ALWAYS
    # denominated in credits — a dollars tracker still burns its setup
    # from the credits balance.
    made, user = await _client_with_user(client)
    body = await make_study(
        client,
        made["id"],
        [user["id"]],
        cost_type="dollars",
        cadence="monthly",
        cost=10,
        setup_cost=20,
    )
    assert body["dollarsDelta"] == -120.0
    assert body["creditsDelta"] == -20.0  # setup only, on the credits side
    bal = await get_balances(client, made["id"])
    assert bal["dollars"] == -120.0
    assert bal["credits"] == -20.0


@pytest.mark.parametrize(
    ("cadence", "runs"), [("weekly", 52), ("monthly", 12), ("quarterly", 4)]
)
async def test_cadence_multipliers(client, cadence, runs):
    made, user = await _client_with_user(client)
    body = await make_study(
        client, made["id"], [user["id"]], cadence=cadence, cost=10
    )
    assert body["creditsDelta"] == -10.0 * runs


async def test_unknown_cadence_treated_as_single_and_setup_ignored(client):
    # cadence "biweekly" is not a tracker cadence: it normalises to
    # single (cadence None), the cost is NOT multiplied, and setup_cost
    # only applies to trackers so it is dropped.
    made, user = await _client_with_user(client)
    body = await make_study(
        client,
        made["id"],
        [user["id"]],
        cadence="biweekly",
        cost=10,
        setup_cost=20,
    )
    assert body["cadence"] is None
    assert body["creditsDelta"] == -10.0
    assert body["setupCost"] is None


async def test_legacy_cost_per_run_fallback(client):
    made, user = await _client_with_user(client)
    payload = _study_payload(made["id"], [user["id"]], cadence="monthly")
    del payload["cost"]
    payload["cost_per_run"] = "10"
    r = await client.post("/api/studies", json=payload, headers=ADMIN)
    assert r.status_code == 201
    assert r.json()["creditsDelta"] == -120.0


async def test_legacy_cost_amount_fallback(client):
    made, user = await _client_with_user(client)
    payload = _study_payload(made["id"], [user["id"]])
    del payload["cost"]
    payload["cost_amount"] = "250"
    r = await client.post("/api/studies", json=payload, headers=ADMIN)
    assert r.status_code == 201
    assert r.json()["creditsDelta"] == -250.0


async def test_balances_are_the_running_sum(client):
    made, user = await _client_with_user(client)
    await make_contract(
        client, made["id"], credits_amount=1000, dollars_amount=5000
    )
    await make_study(client, made["id"], [user["id"]], cost=100)
    await make_study(
        client,
        made["id"],
        [user["id"]],
        name="Tracker",
        cadence="monthly",
        cost=10,
        setup_cost=20,
    )
    await make_study(
        client, made["id"], [user["id"]], name="USD study",
        cost_type="dollars", cost=250,
    )
    bal = await get_balances(client, made["id"])
    assert bal["credits"] == 1000.0 - 100.0 - 140.0
    assert bal["dollars"] == 5000.0 - 250.0


# --- Validation -------------------------------------------------------------


async def test_study_missing_date_400(client):
    made, user = await _client_with_user(client)
    payload = _study_payload(made["id"], [user["id"]])
    del payload["occurred_on"]
    r = await client.post("/api/studies", json=payload, headers=ADMIN)
    assert r.status_code == 400
    assert r.json()["detail"] == "Study date is required."


async def test_study_garbage_date_400(client):
    made, user = await _client_with_user(client)
    r = await client.post(
        "/api/studies",
        json=_study_payload(made["id"], [user["id"]], occurred_on="garbage"),
        headers=ADMIN,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Study date is required."


async def test_study_blank_name_400(client):
    made, user = await _client_with_user(client)
    r = await client.post(
        "/api/studies",
        json=_study_payload(made["id"], [user["id"]], name="  "),
        headers=ADMIN,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Study name is required."


async def test_study_money_typo_400(client):
    made, user = await _client_with_user(client)
    r = await client.post(
        "/api/studies",
        json=_study_payload(made["id"], [user["id"]], cost="1O0"),
        headers=ADMIN,
    )
    assert r.status_code == 400
    assert "1O0" in r.json()["detail"]


async def test_study_negative_cost_per_run_400(client):
    made, user = await _client_with_user(client)
    payload = _study_payload(made["id"], [user["id"]])
    del payload["cost"]
    payload["cost_per_run"] = "-50"
    r = await client.post("/api/studies", json=payload, headers=ADMIN)
    assert r.status_code == 400
    assert r.json()["detail"] == "Cost cannot be negative."


async def test_negative_unified_cost_400(client):
    # A provided unified `cost` wins even when negative, so validation
    # rejects it just like a negative legacy cost_per_run.
    made, user = await _client_with_user(client)
    r = await client.post(
        "/api/studies",
        json=_study_payload(made["id"], [user["id"]], cost=-50),
        headers=ADMIN,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Cost cannot be negative."


async def test_study_without_users_400(client):
    made, _ = await _client_with_user(client)
    r = await client.post(
        "/api/studies", json=_study_payload(made["id"], []), headers=ADMIN
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Pick at least one user this study belongs to."


async def test_study_with_other_clients_user_400(client):
    made_a, _ = await _client_with_user(client)
    made_b = await make_client(client, name="Other Client")
    user_b = await make_user(client, made_b["id"], name="Outsider")
    r = await client.post(
        "/api/studies",
        json=_study_payload(made_a["id"], [user_b["id"]]),
        headers=ADMIN,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Pick users that belong to this client."


async def test_study_duplicate_user_ids_rejected(client):
    # Current behaviour: duplicates in client_user_ids make the resolved
    # set shorter than the request list, which trips the same 400 as an
    # invalid user. Arguably it should dedupe, but this is what it does.
    made, user = await _client_with_user(client)
    r = await client.post(
        "/api/studies",
        json=_study_payload(made["id"], [user["id"], user["id"]]),
        headers=ADMIN,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Pick users that belong to this client."


async def test_study_missing_client_404(client):
    r = await client.post(
        "/api/studies", json=_study_payload(31337, [1]), headers=ADMIN
    )
    assert r.status_code == 404


# --- List / decoration ------------------------------------------------------


async def test_list_studies_decorated(client):
    made, user = await _client_with_user(client)
    user2 = await make_user(client, made["id"], name="Second User")
    await make_study(
        client,
        made["id"],
        [user["id"], user2["id"]],
        name="Tracker",
        cadence="monthly",
        cost=10,
        setup_cost=20,
        socc_project_code="PR00777",
    )
    r = await client.get(f"/api/clients/{made['id']}/studies", headers=ADMIN)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["costType"] == "credits"
    assert row["costAnnual"] == 120.0  # -creditsDelta minus setup
    assert row["costPerRun"] == 10.0
    assert row["setupCost"] == 20.0
    assert row["cadence"] == "monthly"
    assert sorted(row["userIds"]) == sorted([user["id"], user2["id"]])
    assert {u["name"] for u in row["userObjs"]} == {user["name"], "Second User"}
    assert row["soccProjectCode"] == "PR00777"
    assert row["isImported"] is False


async def test_list_studies_excludes_contracts(client):
    made, user = await _client_with_user(client)
    await make_contract(client, made["id"])
    await make_study(client, made["id"], [user["id"]])
    rows = (await client.get(f"/api/clients/{made['id']}/studies", headers=ADMIN)).json()
    assert [row["kind"] for row in rows] == ["study"]


# --- Update / delete --------------------------------------------------------


async def test_patch_study_recomputes_deltas(client):
    made, user = await _client_with_user(client)
    body = await make_study(
        client, made["id"], [user["id"]], cost=100, socc_project_code="PR00001"
    )
    r = await client.patch(
        f"/api/studies/{body['id']}",
        json=_study_payload(
            made["id"], [user["id"]], name="Now a tracker",
            cadence="quarterly", cost=50, setup_cost=10,
        ),
        headers=ADMIN,
    )
    assert r.status_code == 200
    out = r.json()
    assert out["creditsDelta"] == -(10.0 + 50.0 * 4)
    assert out["cadence"] == "quarterly"
    # socc_project_code omitted (None) -> preserved.
    assert out["soccProjectCode"] == "PR00001"
    bal = await get_balances(client, made["id"])
    assert bal["credits"] == -210.0


async def test_patch_study_404_for_contract_id(client):
    made, user = await _client_with_user(client)
    contract = await make_contract(client, made["id"])
    r = await client.patch(
        f"/api/studies/{contract['id']}",
        json=_study_payload(made["id"], [user["id"]]),
        headers=ADMIN,
    )
    assert r.status_code == 404


async def test_delete_study_restores_balances_and_soft_deletes(client, db):
    made, user = await _client_with_user(client)
    await make_contract(client, made["id"], credits_amount=500)
    body = await make_study(client, made["id"], [user["id"]], cost=200)
    assert (await get_balances(client, made["id"]))["credits"] == 300.0

    r = await client.delete(f"/api/studies/{body['id']}", headers=ADMIN)
    assert r.status_code == 200
    assert r.json() == {"clientId": made["id"], "name": body["name"]}

    # Balance restored; gone from the list and the single-txn endpoint.
    assert (await get_balances(client, made["id"]))["credits"] == 500.0
    assert (await client.get(f"/api/clients/{made['id']}/studies", headers=ADMIN)).json() == []
    assert (await client.get(f"/api/transactions/{body['id']}", headers=ADMIN)).status_code == 404

    # Soft delete: the ledger row is still there.
    row = await db.fetchrow(
        "SELECT deleted_at, credits_delta FROM transactions WHERE id = $1",
        body["id"],
    )
    assert row is not None and row["deleted_at"] is not None
    assert float(row["credits_delta"]) == -200.0


async def test_deleted_study_cannot_be_patched(client):
    made, user = await _client_with_user(client)
    body = await make_study(client, made["id"], [user["id"]])
    await client.delete(f"/api/studies/{body['id']}", headers=ADMIN)
    r = await client.patch(
        f"/api/studies/{body['id']}",
        json=_study_payload(made["id"], [user["id"]]),
        headers=ADMIN,
    )
    assert r.status_code == 404


# --- Bulk update ------------------------------------------------------------


async def test_bulk_update_prices_multiple_studies(client):
    made, user = await _client_with_user(client)
    s1 = await make_study(client, made["id"], [user["id"]], name="One", cost=100)
    s2 = await make_study(client, made["id"], [user["id"]], name="Two", cost=100)
    r = await client.post(
        "/api/studies/bulk-update",
        json={
            "client_id": made["id"],
            "studies": {
                str(s1["id"]): _study_payload(made["id"], [user["id"]], name="One", cost=150),
                str(s2["id"]): _study_payload(made["id"], [user["id"]], name="Two", cost=175),
            },
        },
        headers=ADMIN,
    )
    assert r.status_code == 200
    assert r.json() == {"updated": 2, "errors": []}
    bal = await get_balances(client, made["id"])
    assert bal["credits"] == -(150.0 + 175.0)


async def test_bulk_update_per_row_errors_do_not_abort(client):
    made, user = await _client_with_user(client)
    good = await make_study(client, made["id"], [user["id"]], name="Good", cost=100)
    bad = await make_study(client, made["id"], [user["id"]], name="Bad", cost=100)
    r = await client.post(
        "/api/studies/bulk-update",
        json={
            "client_id": made["id"],
            "studies": {
                str(good["id"]): _study_payload(made["id"], [user["id"]], name="Good", cost=999),
                # No users -> per-row error, the other row still saves.
                str(bad["id"]): _study_payload(made["id"], [], name="Bad", cost=1),
            },
        },
        headers=ADMIN,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["updated"] == 1
    assert body["errors"] == ["'Bad': pick at least one user"]

    rows = (await client.get(f"/api/clients/{made['id']}/studies", headers=ADMIN)).json()
    by_name = {row["name"]: row for row in rows}
    assert by_name["Good"]["creditsDelta"] == -999.0
    assert by_name["Bad"]["creditsDelta"] == -100.0  # untouched


async def test_bulk_update_deleted_study_is_error_row(client):
    made, user = await _client_with_user(client)
    dead = await make_study(client, made["id"], [user["id"]], name="Dead")
    await client.delete(f"/api/studies/{dead['id']}", headers=ADMIN)
    r = await client.post(
        "/api/studies/bulk-update",
        json={
            "client_id": made["id"],
            "studies": {
                str(dead["id"]): _study_payload(made["id"], [user["id"]], name="Dead"),
            },
        },
        headers=ADMIN,
    )
    assert r.status_code == 200
    assert r.json() == {"updated": 0, "errors": [f"#{dead['id']}: not found"]}


async def test_bulk_update_rejects_other_clients_study(client):
    made_a, user_a = await _client_with_user(client)
    made_b = await make_client(client, name="B Corp")
    user_b = await make_user(client, made_b["id"])
    foreign = await make_study(client, made_b["id"], [user_b["id"]], name="Foreign")
    r = await client.post(
        "/api/studies/bulk-update",
        json={
            "client_id": made_a["id"],
            "studies": {
                str(foreign["id"]): _study_payload(made_a["id"], [user_a["id"]]),
            },
        },
        headers=ADMIN,
    )
    assert r.status_code == 200
    assert r.json()["errors"] == [f"#{foreign['id']}: not found"]
    assert r.json()["updated"] == 0


# --- Idempotency -------------------------------------------------------------


async def test_study_idempotency_key_replay_returns_same_row(client, db):
    made, user = await _client_with_user(client)
    headers = {**ADMIN, "Idempotency-Key": "study-key-1"}
    payload = _study_payload(made["id"], [user["id"]])
    first = await client.post("/api/studies", json=payload, headers=headers)
    assert first.status_code == 201, first.text
    second = await client.post("/api/studies", json=payload, headers=headers)
    assert second.status_code in (200, 201)
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["clientName"] == made["name"]

    count = await db.fetchval(
        "SELECT count(*) FROM transactions WHERE kind = 'study'"
    )
    assert count == 1
    # The replay did not double-charge the client.
    bal = await get_balances(client, made["id"])
    assert bal["credits"] == -100.0


# --- Inline new-contact on study create (atomic) ----------------------------


async def test_inline_new_contact_created_and_attributed(client):
    made = await make_client(client)  # no contacts yet
    payload = _study_payload(
        made["id"],
        [],
        new_contact_name="Jordan Lee",
        new_contact_email="jordan@acme.com",
    )
    r = await client.post("/api/studies", json=payload, headers=ADMIN)
    assert r.status_code == 201, r.text

    users = await client.get(
        f"/api/clients/{made['id']}/users", headers=ADMIN
    )
    names = {u["name"] for u in users.json()}
    assert "Jordan Lee" in names
    # exactly one contact was created
    assert len([u for u in users.json() if u["name"] == "Jordan Lee"]) == 1


async def test_inline_new_contact_rolls_back_when_study_invalid(client):
    made = await make_client(client)
    # An invalid contract link makes study creation fail AFTER the inline
    # contact is added — the whole request must roll back (no orphan contact).
    payload = _study_payload(
        made["id"],
        [],
        new_contact_name="Ghost Contact",
        contract_id=999999,
    )
    r = await client.post("/api/studies", json=payload, headers=ADMIN)
    assert r.status_code == 400, r.text

    users = await client.get(
        f"/api/clients/{made['id']}/users", headers=ADMIN
    )
    names = {u["name"] for u in users.json()}
    assert "Ghost Contact" not in names


# --- New study fields: audience / target N / actual N / description ---------


async def test_study_new_fields_round_trip(client):
    made, user = await _client_with_user(client)
    payload = _study_payload(
        made["id"],
        [user["id"]],
        audience="Institutional investors",
        target_n=600,
        actual_n_delivered=542,
        description="Q1 buy-side sentiment wave",
    )
    r = await client.post("/api/studies", json=payload, headers=ADMIN)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["audience"] == "Institutional investors"
    assert body["targetN"] == 600
    assert body["actualNDelivered"] == 542
    assert body["description"] == "Q1 buy-side sentiment wave"


async def test_study_new_fields_default_none(client):
    made, user = await _client_with_user(client)
    body = await make_study(client, made["id"], [user["id"]], cost=100)
    assert body["audience"] is None
    assert body["targetN"] is None
    assert body["actualNDelivered"] is None
    assert body["description"] is None


async def test_study_new_fields_update_and_clear(client):
    made, user = await _client_with_user(client)
    body = await make_study(
        client,
        made["id"],
        [user["id"]],
        cost=100,
        audience="Retail",
        target_n=1000,
        actual_n_delivered=900,
        description="v1",
    )
    # Update some, clear others (the form always submits every field, so an
    # omitted/blank value means "clear", mirroring the contract link).
    r = await client.patch(
        f"/api/studies/{body['id']}",
        json=_study_payload(
            made["id"],
            [user["id"]],
            audience="",
            target_n=1200,
            actual_n_delivered="",
            description="v2",
        ),
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    upd = r.json()
    assert upd["audience"] is None
    assert upd["targetN"] == 1200
    assert upd["actualNDelivered"] is None
    assert upd["description"] == "v2"


async def test_study_counts_accept_numeric_strings(client):
    made, user = await _client_with_user(client)
    payload = _study_payload(
        made["id"],
        [user["id"]],
        target_n="750",
        actual_n_delivered="",
    )
    r = await client.post("/api/studies", json=payload, headers=ADMIN)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["targetN"] == 750
    assert body["actualNDelivered"] is None


async def test_study_different_idempotency_keys_create_two_rows(client, db):
    made, user = await _client_with_user(client)
    payload = _study_payload(made["id"], [user["id"]])
    ids = set()
    for key in ("study-key-a", "study-key-b"):
        r = await client.post(
            "/api/studies",
            json=payload,
            headers={**ADMIN, "Idempotency-Key": key},
        )
        assert r.status_code == 201
        ids.add(r.json()["id"])
    assert len(ids) == 2
    count = await db.fetchval(
        "SELECT count(*) FROM transactions WHERE kind = 'study'"
    )
    assert count == 2
