"""Credit-request approval queue (permissions Phase 3)."""

from tests.conftest import (
    ADMIN,
    APPROVER,
    USER,
    get_balances,
    make_client,
)

SARAH = "sarah@alpharoc.ai"


async def _sp(client, name, email):
    r = await client.post("/api/salespeople", json={"name": name, "email": email}, headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


async def _mine(client):
    sarah = await _sp(client, "Sarah", SARAH)
    return await make_client(client, name="Mine Co", salesperson_id=sarah["id"])


async def _submit(client, client_id, headers=USER, credits=500):
    return await client.post(
        "/api/credit-requests",
        json={"client_id": client_id, "credits_delta": credits, "note": "Need a top-up"},
        headers=headers,
    )


async def test_restricted_submits_for_own_client(client):
    mine = await _mine(client)
    r = await _submit(client, mine["id"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["requestedByEmail"] == SARAH
    assert body["creditsDelta"] == 500


async def test_cannot_submit_for_unowned_client(client):
    await _mine(client)
    theirs = await make_client(client, name="Theirs Co")
    r = await _submit(client, theirs["id"])
    assert r.status_code == 404, r.text


async def test_submit_rejects_negative_or_zero(client):
    mine = await _mine(client)
    neg = await client.post("/api/credit-requests", json={"client_id": mine["id"], "credits_delta": -5, "note": "x"}, headers=USER)
    assert neg.status_code == 400
    zero = await client.post("/api/credit-requests", json={"client_id": mine["id"], "credits_delta": 0, "dollars_delta": 0, "note": "x"}, headers=USER)
    assert zero.status_code == 400


async def test_approve_creates_adjustment_and_moves_balance(client):
    mine = await _mine(client)
    req = (await _submit(client, mine["id"], credits=500)).json()
    before = await get_balances(client, mine["id"])
    assert before["credits"] == 0

    r = await client.post(f"/api/credit-requests/{req['id']}/approve", headers=APPROVER)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "approved"
    assert body["decidedByEmail"] == "vineet@alpharoc.ai"
    assert body["resultingTransactionId"] is not None

    after = await get_balances(client, mine["id"])
    assert after["credits"] == 500


async def test_double_approve_is_idempotent(client):
    mine = await _mine(client)
    req = (await _submit(client, mine["id"], credits=300)).json()
    first = await client.post(f"/api/credit-requests/{req['id']}/approve", headers=APPROVER)
    assert first.status_code == 200
    second = await client.post(f"/api/credit-requests/{req['id']}/approve", headers=APPROVER)
    assert second.status_code == 409, second.text
    # Balance moved exactly once.
    bal = await get_balances(client, mine["id"])
    assert bal["credits"] == 300


async def test_restricted_cannot_approve(client):
    mine = await _mine(client)
    req = (await _submit(client, mine["id"])).json()
    r = await client.post(f"/api/credit-requests/{req['id']}/approve", headers=USER)
    assert r.status_code == 403, r.text


async def test_reject_creates_no_adjustment(client):
    mine = await _mine(client)
    req = (await _submit(client, mine["id"], credits=400)).json()
    r = await client.post(
        f"/api/credit-requests/{req['id']}/reject",
        json={"decision_note": "not this quarter"},
        headers=APPROVER,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"
    bal = await get_balances(client, mine["id"])
    assert bal["credits"] == 0


async def test_cancel_own_but_not_others(client):
    mine = await _mine(client)
    req = (await _submit(client, mine["id"])).json()
    # Someone else can't cancel it.
    other = await client.post(f"/api/credit-requests/{req['id']}/cancel", headers={"X-User-Email": "mallory@alpharoc.ai"})
    assert other.status_code in (403, 404)
    # The requester can.
    r = await client.post(f"/api/credit-requests/{req['id']}/cancel", headers=USER)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "canceled"


async def test_list_scoping(client):
    mine = await _mine(client)
    await _submit(client, mine["id"])
    # Requester sees own.
    own = await client.get("/api/credit-requests", headers=USER)
    assert len(own.json()) == 1
    # Approver sees the full queue.
    q = await client.get("/api/credit-requests?status=pending", headers=APPROVER)
    assert len(q.json()) == 1
    assert q.json()[0]["client"]["name"] == "Mine Co"
