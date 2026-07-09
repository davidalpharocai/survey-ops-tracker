"""Global search endpoint (omnibox)."""

from tests.conftest import (
    ADMIN,
    make_client,
    make_contract,
    make_study,
    make_user,
)


async def test_search_empty_query_returns_empty_groups(client):
    r = await client.get("/api/search", params={"q": "  "}, headers=ADMIN)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d == {"clients": [], "contracts": [], "studies": [], "contacts": []}


async def test_search_matches_across_entities(client):
    c = await make_client(client, name="Acme Insights")
    u = await make_user(client, c["id"], name="Acme Contact")
    await make_contract(client, c["id"], name="Acme Retainer")
    await make_study(client, c["id"], [u["id"]], name="Acme Tracker")
    r = await client.get("/api/search", params={"q": "acme"}, headers=ADMIN)
    d = r.json()
    assert [x["name"] for x in d["clients"]] == ["Acme Insights"]
    assert [x["name"] for x in d["contracts"]] == ["Acme Retainer"]
    assert [x["name"] for x in d["studies"]] == ["Acme Tracker"]
    assert [x["name"] for x in d["contacts"]] == ["Acme Contact"]
    # contracts/studies/contacts carry client context for the link
    assert d["contracts"][0]["clientId"] == c["id"]
    assert d["contracts"][0]["clientName"] == "Acme Insights"


async def test_search_is_case_insensitive(client):
    await make_client(client, name="Zebra Corp")
    r = await client.get("/api/search", params={"q": "ZEBRA"}, headers=ADMIN)
    assert [x["name"] for x in r.json()["clients"]] == ["Zebra Corp"]


async def test_search_matches_socc_code(client):
    await make_client(client, name="CodeCo", socc_code="Cl09999")
    r = await client.get("/api/search", params={"q": "cl09999"}, headers=ADMIN)
    assert [x["name"] for x in r.json()["clients"]] == ["CodeCo"]


async def test_search_excludes_archived(client):
    c = await make_client(client, name="Ghosty")
    await client.delete(f"/api/clients/{c['id']}", headers=ADMIN)
    r = await client.get("/api/search", params={"q": "ghosty"}, headers=ADMIN)
    assert r.json()["clients"] == []


async def test_search_escapes_like_metacharacters(client):
    await make_client(client, name="Normal Co")
    await make_client(client, name="Ten % Off")
    r = await client.get("/api/search", params={"q": "%"}, headers=ADMIN)
    names = [x["name"] for x in r.json()["clients"]]
    assert names == ["Ten % Off"]  # literal %, not a wildcard matching all


async def test_search_respects_limit(client):
    for i in range(5):
        await make_client(client, name=f"Limtest {i}")
    r = await client.get("/api/search", params={"q": "limtest", "limit": 2}, headers=ADMIN)
    assert len(r.json()["clients"]) == 2
