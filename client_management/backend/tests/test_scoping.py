"""Sales role read-scoping + escalation lockdown (permissions Phase 1+2).

USER (sarah@) is a plain member = a RESTRICTED salesperson under the new
model. ADMIN (david@) is unrestricted. A client is assigned to sarah; she
must see only that one, everywhere, and must not be able to self-grant.
"""

from tests.conftest import ADMIN, USER, make_client, make_contract, make_study, make_user

SARAH = "sarah@alpharoc.ai"


async def _sp(client, name, email):
    r = await client.post("/api/salespeople", json={"name": name, "email": email}, headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


async def _setup(client):
    sarah = await _sp(client, "Sarah", SARAH)
    mine = await make_client(client, name="Mine Co", salesperson_id=sarah["id"])
    theirs = await make_client(client, name="Theirs Co")  # no salesperson
    um = await make_user(client, mine["id"], name="M Contact")
    ut = await make_user(client, theirs["id"], name="T Contact")
    await make_contract(client, mine["id"], name="Mine contract", credits_amount=1000)
    await make_contract(client, theirs["id"], name="Theirs contract", credits_amount=1000)
    await make_study(client, mine["id"], [um["id"]], name="Mine study")
    await make_study(client, theirs["id"], [ut["id"]], name="Theirs study")
    return mine, theirs


async def test_restricted_list_clients_only_own(client):
    mine, theirs = await _setup(client)
    r = await client.get("/api/clients", headers=USER)
    names = {c["name"] for c in r.json()}
    assert names == {"Mine Co"}
    # Admin sees both.
    ra = await client.get("/api/clients", headers=ADMIN)
    assert {"Mine Co", "Theirs Co"} <= {c["name"] for c in ra.json()}


async def test_restricted_get_client_404_for_unowned(client):
    mine, theirs = await _setup(client)
    assert (await client.get(f"/api/clients/{mine['id']}", headers=USER)).status_code == 200
    assert (await client.get(f"/api/clients/{theirs['id']}", headers=USER)).status_code == 404


async def test_restricted_global_lists_filtered(client):
    await _setup(client)
    for path in ["/api/studies", "/api/contracts", "/api/reports/balances",
                 "/api/reports/renewals", "/api/reports/balance-health", "/api/users"]:
        rows = (await client.get(path, headers=USER)).json()
        # every row's client must be Mine Co
        for row in rows:
            c = row.get("client") or row
            name = c.get("name") or c.get("clientName")
            assert name in (None, "Mine Co"), f"{path} leaked {name}"
        # admin sees more
        admin_rows = (await client.get(path, headers=ADMIN)).json()
        assert len(admin_rows) >= len(rows)


async def test_restricted_search_filtered(client):
    await _setup(client)
    r = await client.get("/api/search?q=Co", headers=USER)
    d = r.json()
    assert {c["name"] for c in d["clients"]} == {"Mine Co"}
    r2 = await client.get("/api/search?q=study", headers=USER)
    assert all(s["clientName"] == "Mine Co" for s in r2.json()["studies"])


async def test_restricted_write_lockdown(client):
    mine, theirs = await _setup(client)
    # Can't create clients.
    assert (await client.post("/api/clients", json={"name": "X", "became_on": "2024-01-01"}, headers=USER)).status_code == 403
    # Can't create salespeople (the scope key).
    assert (await client.post("/api/salespeople", json={"name": "Y"}, headers=USER)).status_code == 403
    # Can't add credits (contracts / adjustments).
    assert (await client.post("/api/contracts", json={"client_id": mine["id"], "name": "c", "occurred_on": "2024-01-01", "renewal_on": "2025-01-01", "credits_amount": 100}, headers=USER)).status_code == 403
    assert (await client.post("/api/adjustments", json={"client_id": mine["id"], "credits_delta": 10, "note": "x"}, headers=USER)).status_code == 403
    # Can't reassign their client's salesperson.
    other = await _sp(client, "Other", "other@alpharoc.ai")
    r = await client.patch(f"/api/clients/{mine['id']}", json={"name": "Mine Co", "became_on": "2024-01-01", "salesperson_id": other["id"]}, headers=USER)
    assert r.status_code == 403


async def test_restricted_can_record_study_on_own_but_not_others(client):
    mine, theirs = await _setup(client)
    um = (await client.get(f"/api/clients/{mine['id']}/users", headers=ADMIN)).json()[0]
    ok = await client.post("/api/studies", json={"client_id": mine["id"], "name": "sarah study", "occurred_on": "2024-03-01", "cost_type": "credits", "cost": 50, "client_user_ids": [um["id"]]}, headers=USER)
    assert ok.status_code == 201, ok.text
    # On a non-owned client -> 404 (can't even see it).
    bad = await client.post("/api/studies", json={"client_id": theirs["id"], "name": "no", "occurred_on": "2024-03-01", "cost_type": "credits", "cost": 50, "client_user_ids": []}, headers=USER)
    assert bad.status_code == 404, bad.text
