"""Global GET /api/studies and GET /api/contracts (across all clients)."""

from tests.conftest import ADMIN, make_client, make_contract, make_study, make_user


async def _mk_sp(client, name, email):
    r = await client.post("/api/salespeople", json={"name": name, "email": email}, headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


async def test_all_studies_across_clients_with_salesperson(client):
    jenna = await _mk_sp(client, "Jenna", "jenna@alpharoc.ai")
    a = await make_client(client, name="Client A", salesperson_id=jenna["id"])
    b = await make_client(client, name="Client B")  # no salesperson
    ua = await make_user(client, a["id"])
    ub = await make_user(client, b["id"])
    await make_study(client, a["id"], [ua["id"]], name="A study")
    await make_study(client, b["id"], [ub["id"]], name="B study")

    r = await client.get("/api/studies", headers=ADMIN)
    assert r.status_code == 200, r.text
    rows = r.json()
    names = {s["name"] for s in rows}
    assert {"A study", "B study"} <= names
    a_row = next(s for s in rows if s["name"] == "A study")
    assert a_row["client"]["name"] == "Client A"
    assert a_row["client"]["salespersonEmail"] == "jenna@alpharoc.ai"


async def test_all_contracts_across_clients_with_salesperson(client):
    alex = await _mk_sp(client, "Alex", "alex@alpharoc.ai")
    a = await make_client(client, name="Con A", salesperson_id=alex["id"])
    b = await make_client(client, name="Con B")
    await make_contract(client, a["id"], name="A contract", credits_amount=500)
    await make_contract(client, b["id"], name="B contract", dollars_amount=1000)

    r = await client.get("/api/contracts", headers=ADMIN)
    assert r.status_code == 200, r.text
    rows = r.json()
    names = {t["name"] for t in rows}
    assert {"A contract", "B contract"} <= names
    a_row = next(t for t in rows if t["name"] == "A contract")
    assert a_row["client"]["salespersonEmail"] == "alex@alpharoc.ai"
    assert a_row["creditsAmount"] == 500


async def test_global_lists_exclude_archived(client):
    c = await make_client(client, name="Arch Co")
    u = await make_user(client, c["id"])
    s = await make_study(client, c["id"], [u["id"]], name="Doomed study")
    con = await make_contract(client, c["id"], name="Doomed contract")
    await client.delete(f"/api/studies/{s['id']}", headers=ADMIN)
    await client.delete(f"/api/contracts/{con['id']}", headers=ADMIN)

    studies = (await client.get("/api/studies", headers=ADMIN)).json()
    contracts = (await client.get("/api/contracts", headers=ADMIN)).json()
    assert "Doomed study" not in {s["name"] for s in studies}
    assert "Doomed contract" not in {t["name"] for t in contracts}
