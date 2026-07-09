"""CCM <- SOCC manual status sync."""

from tests.conftest import (
    ADMIN,
    USER,
    get_balances,
    make_client,
    make_study,
    make_user,
)


async def test_sync_sets_board_column_on_matching_survey(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    s = await make_study(
        client, c["id"], [u["id"]], name="Wave 1", socc_project_code="PR00222"
    )
    r = await client.post(
        "/api/admin/socc-sync",
        json={"updates": [{"pr_code": "PR00222", "board_column": "Fielding"}]},
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["matchedCount"] == 1
    assert d["matched"][0]["studyId"] == s["id"]
    assert d["matched"][0]["clientName"] == c["name"]
    # reflected on the study
    t = (await client.get(f"/api/transactions/{s['id']}", headers=ADMIN)).json()
    assert t["soccBoardColumn"] == "Fielding"
    assert t["soccSyncedAt"] is not None


async def test_sync_reports_unmatched(client):
    r = await client.post(
        "/api/admin/socc-sync",
        json={"updates": [{"pr_code": "PR09999", "board_column": "Fielding", "project_name": "Ghost", "client_name": "Nobody"}]},
        headers=ADMIN,
    )
    d = r.json()
    assert d["matchedCount"] == 0
    assert d["unmatchedCount"] == 1
    assert d["unmatched"][0]["prCode"] == "PR09999"
    assert d["unmatched"][0]["projectName"] == "Ghost"


async def test_sync_never_changes_money(client):
    c = await make_client(client)
    u = await make_user(client, c["id"])
    await make_study(
        client, c["id"], [u["id"]], name="S", cost=100, socc_project_code="PR00050"
    )
    before = await get_balances(client, c["id"])
    await client.post(
        "/api/admin/socc-sync",
        json={"updates": [{"pr_code": "PR00050", "board_column": "Data QA"}]},
        headers=ADMIN,
    )
    after = await get_balances(client, c["id"])
    assert after["credits"] == before["credits"]
    assert after["dollars"] == before["dollars"]


async def test_sync_is_admin_only(client):
    r = await client.post(
        "/api/admin/socc-sync",
        json={"updates": [{"pr_code": "PR00001", "board_column": "Fielding"}]},
        headers=USER,
    )
    assert r.status_code == 403, r.text
