"""Parent-child (macro/micro) accounts — Phase 1: the flat Parent→Child link
on clients, its invariants, and admin-only assignment."""

from conftest import ADMIN, USER, make_client, make_contract


async def _sp(client, name, email):
    r = await client.post(
        "/api/salespeople", json={"name": name, "email": email}, headers=ADMIN
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _set_parent(client, child, parent_id, headers=ADMIN, **extra):
    # A bare client PATCH clears the salesperson (update_client keeps the
    # snapshot consistent when no salesperson field is sent), so callers that
    # need to preserve ownership pass salesperson_id=... via **extra.
    body = {"name": child["name"], "became_on": "2024-01-15", "parent_id": parent_id}
    body.update(extra)
    return await client.patch(f"/api/clients/{child['id']}", json=body, headers=headers)


async def test_set_and_serialize_parent(client):
    parent = await make_client(client, name="Millennium")
    child = await make_client(client, name="Black Kite")
    r = await _set_parent(client, child, parent["id"])
    assert r.status_code == 200, r.text
    assert r.json()["parentId"] == parent["id"]
    g = await client.get(f"/api/clients/{child['id']}", headers=ADMIN)
    assert g.json()["parentId"] == parent["id"]


async def test_detach_parent(client):
    parent = await make_client(client, name="P")
    child = await make_client(client, name="C")
    await _set_parent(client, child, parent["id"])
    r = await _set_parent(client, child, None)
    assert r.status_code == 200, r.text
    assert r.json()["parentId"] is None


async def test_omitting_parent_id_leaves_it_unchanged(client):
    parent = await make_client(client, name="P")
    child = await make_client(client, name="C")
    await _set_parent(client, child, parent["id"])
    # A PATCH that doesn't carry parent_id must not detach it.
    r = await client.patch(
        f"/api/clients/{child['id']}",
        json={"name": "C renamed", "became_on": "2024-01-15"},
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    assert r.json()["parentId"] == parent["id"]


async def test_self_parent_rejected(client):
    c = await make_client(client, name="Solo")
    r = await _set_parent(client, c, c["id"])
    assert r.status_code == 400


async def test_parent_must_be_top_level(client):
    gp = await make_client(client, name="GP")
    p = await make_client(client, name="P")
    c = await make_client(client, name="C")
    await _set_parent(client, p, gp["id"])  # p is now a child of gp
    r = await _set_parent(client, c, p["id"])  # can't point at a child
    assert r.status_code == 400


async def test_parent_with_children_cannot_become_child(client):
    p = await make_client(client, name="P")
    c = await make_client(client, name="C")
    other = await make_client(client, name="Other")
    await _set_parent(client, c, p["id"])  # p now has a child
    r = await _set_parent(client, p, other["id"])  # p can't become a child
    assert r.status_code == 400


async def test_parent_not_found(client):
    c = await make_client(client, name="C")
    r = await _set_parent(client, c, 999999)
    assert r.status_code == 400


async def test_family_rollup_for_parent(client):
    parent = await make_client(client, name="Millennium")
    a = await make_client(client, name="A Sub")
    b = await make_client(client, name="B Sub")
    await _set_parent(client, a, parent["id"])
    await _set_parent(client, b, parent["id"])
    await make_contract(client, parent["id"], credits_amount=1000, dollars_amount=0)
    await make_contract(client, a["id"], credits_amount=500, dollars_amount=0)
    await make_contract(client, b["id"], credits_amount=0, dollars_amount=2000)

    d = (await client.get(f"/api/clients/{parent['id']}/family", headers=ADMIN)).json()
    assert d["parent"] is None
    assert {c["name"] for c in d["children"]} == {"A Sub", "B Sub"}
    assert d["rollup"]["credits"] == 1500.0  # parent 1000 + A 500
    assert d["rollup"]["dollars"] == 2000.0  # B
    assert d["partial"] is False


async def test_family_child_shows_parent_link(client):
    parent = await make_client(client, name="P")
    child = await make_client(client, name="C")
    await _set_parent(client, child, parent["id"])
    d = (await client.get(f"/api/clients/{child['id']}/family", headers=ADMIN)).json()
    assert d["parent"] == {"id": parent["id"], "name": "P"}
    assert d["children"] == []


async def test_family_scoping_marks_partial(client):
    sarah = await _sp(client, "Sarah", "sarah@alpharoc.ai")
    parent = await make_client(client, name="Fam", salesperson_id=sarah["id"])
    mine = await make_client(client, name="MyChild", salesperson_id=sarah["id"])
    theirs = await make_client(client, name="TheirChild")  # a different owner
    await _set_parent(client, mine, parent["id"], salesperson_id=sarah["id"])
    await _set_parent(client, theirs, parent["id"])

    d = (await client.get(f"/api/clients/{parent['id']}/family", headers=USER)).json()
    assert {c["name"] for c in d["children"]} == {"MyChild"}
    assert d["partial"] is True


async def test_restricted_cannot_set_parent(client):
    sarah = await _sp(client, "Sarah", "sarah@alpharoc.ai")
    mine = await make_client(client, name="Mine", salesperson_id=sarah["id"])
    parent = await make_client(client, name="ParentCo", salesperson_id=sarah["id"])
    r = await client.patch(
        f"/api/clients/{mine['id']}",
        json={"name": mine["name"], "became_on": "2024-01-15", "parent_id": parent["id"]},
        headers=USER,
    )
    assert r.status_code == 403
