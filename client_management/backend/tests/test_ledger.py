"""Contract-linked ledger — grouped /ledger endpoint (Phase 2)."""

from tests.conftest import (
    ADMIN,
    get_balances,
    make_client,
    make_contract,
    make_study,
    make_user,
)


async def test_ledger_groups_studies_under_contracts(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    con = await make_contract(client, c["id"], name="Retainer", credits_amount=1000)
    await make_study(client, c["id"], [u["id"]], name="Linked", cost=300, contract_id=con["id"])
    await make_study(client, c["id"], [u["id"]], name="Loose", cost=100)
    r = await client.get(f"/api/clients/{c['id']}/ledger", headers=ADMIN)
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["contracts"]) == 1
    assert d["contracts"][0]["remainingCredits"] == 700  # 1000 - 300
    assert [s["name"] for s in d["contracts"][0]["studies"]] == ["Linked"]
    assert [s["name"] for s in d["unassigned"]] == ["Loose"]


async def test_ledger_overdrawn_contract_is_negative(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    con = await make_contract(client, c["id"], name="Small", credits_amount=100)
    await make_study(client, c["id"], [u["id"]], name="Big", cost=250, contract_id=con["id"])
    r = await client.get(f"/api/clients/{c['id']}/ledger", headers=ADMIN)
    assert r.json()["contracts"][0]["remainingCredits"] == -150


async def test_ledger_invariant_matches_client_total(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    con = await make_contract(
        client, c["id"], name="C", credits_amount=1000, dollars_amount=0
    )
    await make_study(client, c["id"], [u["id"]], name="L", cost=300, contract_id=con["id"])
    await make_study(client, c["id"], [u["id"]], name="U", cost=100)
    await client.post(
        "/api/adjustments",
        json={"client_id": c["id"], "credits_delta": -50, "dollars_delta": 0, "note": "corr"},
        headers=ADMIN,
    )
    led = (await client.get(f"/api/clients/{c['id']}/ledger", headers=ADMIN)).json()
    bal = await get_balances(client, c["id"])
    per_contract = sum(x["remainingCredits"] for x in led["contracts"])
    unassigned = sum(float(s["creditsDelta"]) for s in led["unassigned"])
    adj = sum(float(a["creditsDelta"]) for a in led["adjustments"])
    assert per_contract + unassigned + adj == bal["credits"]
    assert led["totals"]["credits"] == bal["credits"]


async def test_ledger_404_for_unknown_client(client):
    r = await client.get("/api/clients/999999/ledger", headers=ADMIN)
    assert r.status_code == 404, r.text
