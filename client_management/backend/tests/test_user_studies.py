"""GET /api/users/{id}/studies — surveys attributed to a contact."""

from tests.conftest import ADMIN, make_client, make_study, make_user


async def test_lists_studies_attributed_to_contact(client):
    c = await make_client(client)
    nick = await make_user(client, c["id"], name="Nick")
    other = await make_user(client, c["id"], name="Pat")
    await make_study(client, c["id"], [nick["id"]], name="Nick survey A")
    await make_study(client, c["id"], [nick["id"], other["id"]], name="Shared survey")
    await make_study(client, c["id"], [other["id"]], name="Pat only")

    r = await client.get(f"/api/users/{nick['id']}/studies", headers=ADMIN)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["contact"]["name"] == "Nick"
    assert body["client"]["id"] == c["id"]
    names = {s["name"] for s in body["studies"]}
    assert names == {"Nick survey A", "Shared survey"}


async def test_contact_with_no_studies_returns_empty(client):
    c = await make_client(client)
    lonely = await make_user(client, c["id"], name="Lonely")
    r = await client.get(f"/api/users/{lonely['id']}/studies", headers=ADMIN)
    assert r.status_code == 200, r.text
    assert r.json()["studies"] == []


async def test_unknown_contact_404(client):
    r = await client.get("/api/users/999999/studies", headers=ADMIN)
    assert r.status_code == 404, r.text
