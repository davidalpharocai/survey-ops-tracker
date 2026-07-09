"""Balances and reports: lifetime sums, current-year contract figures,
renewal pickup, and cross-endpoint parity.

Dates are built relative to the app's own ``utc_today`` so the tests
stay valid whatever the calendar says.
"""

from datetime import datetime, timedelta

from app.helpers import utc_today

from conftest import ADMIN, get_balances, make_client, make_contract, make_study, make_user

TODAY = utc_today()
CY = TODAY.year


def _d(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


def _iso_z(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT00:00:00Z")


async def test_cy_figures_count_only_current_year_contracts(client):
    made = await make_client(client)
    user = await make_user(client, made["id"])
    # Current-year contract: counted in cyCredits / cyValue.
    await make_contract(
        client,
        made["id"],
        name="CY deal",
        occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=200)),
        credits_amount=1000,
        dollars_amount=300,
    )
    # Last-year contract: lifetime only, not in the CY figures.
    await make_contract(
        client,
        made["id"],
        name="Old deal",
        occurred_on=_d(datetime(CY - 1, 6, 1)),
        renewal_on=_d(datetime(CY - 1, 12, 1)),
        credits_amount=500,
        dollars_amount=250,
    )
    # Studies never contribute to the CY contract figures.
    await make_study(
        client, made["id"], [user["id"]], occurred_on=_d(TODAY), cost=100
    )

    bal = await get_balances(client, made["id"])
    assert bal["credits"] == 1000.0 + 500.0 - 100.0
    assert bal["dollars"] == 300.0 + 250.0
    assert bal["cyCredits"] == 1000.0
    assert bal["cyValue"] == 300.0


async def test_cy_renewal_picks_earliest_upcoming_across_years(client):
    made = await make_client(client)
    # Cross-year contract: dated LAST year but renewing soon — it must
    # be picked up (renewal scan covers all contracts, not just CY ones).
    await make_contract(
        client,
        made["id"],
        name="Cross-year",
        occurred_on=_d(datetime(CY - 1, 12, 1)),
        renewal_on=_d(TODAY + timedelta(days=30)),
    )
    await make_contract(
        client,
        made["id"],
        name="This year",
        occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=200)),
    )
    bal = await get_balances(client, made["id"])
    assert bal["cyRenewal"] == _iso_z(TODAY + timedelta(days=30))


async def test_cy_renewal_null_when_all_renewals_past(client):
    made = await make_client(client)
    await make_contract(
        client,
        made["id"],
        occurred_on=_d(datetime(CY - 1, 1, 15)),
        renewal_on=_d(datetime(CY - 1, 7, 15)),
    )
    bal = await get_balances(client, made["id"])
    assert bal["cyRenewal"] is None


async def test_cy_renewal_today_counts_as_upcoming(client):
    # Boundary: renewal_on >= today, so a renewal due today still shows.
    made = await make_client(client)
    await make_contract(
        client,
        made["id"],
        occurred_on=_d(TODAY - timedelta(days=365)),
        renewal_on=_d(TODAY),
    )
    bal = await get_balances(client, made["id"])
    assert bal["cyRenewal"] == _iso_z(TODAY)


async def test_deleted_contract_excluded_from_balances_and_renewal(client):
    made = await make_client(client)
    body = await make_contract(
        client,
        made["id"],
        occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=90)),
        credits_amount=800,
    )
    await client.delete(f"/api/contracts/{body['id']}", headers=ADMIN)
    bal = await get_balances(client, made["id"])
    assert bal == {
        "credits": 0.0,
        "dollars": 0.0,
        "cyCredits": 0.0,
        "cyValue": 0.0,
        "cyRenewal": None,
    }


async def test_reports_balances_row_parity(client):
    a = await make_client(client, name="Alpha Fund")
    b = await make_client(client, name="Beta Fund")
    ua = await make_user(client, a["id"])
    await make_contract(
        client,
        a["id"],
        occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=60)),
        credits_amount=2000,
        dollars_amount=100,
    )
    await make_study(
        client, a["id"], [ua["id"]], occurred_on=_d(TODAY),
        cadence="monthly", cost=10, setup_cost=20,
    )
    await make_contract(
        client,
        b["id"],
        occurred_on=_d(datetime(CY - 1, 3, 1)),
        renewal_on=_d(datetime(CY - 1, 9, 1)),
        credits_amount=750,
    )

    r = await client.get("/api/reports/balances", headers=ADMIN)
    assert r.status_code == 200
    rows = r.json()
    assert [row["client"]["name"] for row in rows] == ["Alpha Fund", "Beta Fund"]

    for row in rows:
        single = await get_balances(client, row["client"]["id"])
        assert row["credits"] == single["credits"]
        assert row["dollars"] == single["dollars"]
        assert row["cyCredits"] == single["cyCredits"]
        assert row["cyValue"] == single["cyValue"]
        assert row["cyRenewal"] == single["cyRenewal"]

    by_name = {row["client"]["name"]: row for row in rows}
    assert by_name["Alpha Fund"]["credits"] == 2000.0 - 140.0
    assert by_name["Beta Fund"]["credits"] == 750.0
    assert by_name["Beta Fund"]["cyCredits"] == 0.0


async def test_reports_include_zero_activity_clients(client):
    made = await make_client(client, name="Quiet Co")
    rows = (await client.get("/api/reports/balances", headers=ADMIN)).json()
    assert rows == [
        {
            "client": rows[0]["client"],
            "credits": 0.0,
            "dollars": 0.0,
            "cyCredits": 0.0,
            "cyValue": 0.0,
            "cyRenewal": None,
        }
    ]
    assert rows[0]["client"]["id"] == made["id"]


async def test_balances_for_unknown_client_returns_zeros(client):
    # Current behaviour: /balances does not 404 on unknown ids — it
    # aggregates over zero rows and returns an all-zero summary.
    bal = await get_balances(client, 99999)
    assert bal["credits"] == 0.0
    assert bal["cyRenewal"] is None


async def test_transaction_log_newest_first_excluding_deleted(client):
    made = await make_client(client)
    user = await make_user(client, made["id"])
    await make_contract(client, made["id"], name="Older", occurred_on="2024-02-01")
    study = await make_study(
        client, made["id"], [user["id"]], name="Newer", occurred_on="2024-03-01"
    )
    zombie = await make_contract(
        client, made["id"], name="Zombie", occurred_on="2024-04-01"
    )
    await client.delete(f"/api/contracts/{zombie['id']}", headers=ADMIN)

    r = await client.get(f"/api/clients/{made['id']}/transactions", headers=ADMIN)
    assert r.status_code == 200
    rows = r.json()
    assert [t["name"] for t in rows] == ["Newer", "Older"]
    # The study row carries the legacy clientUser join.
    assert rows[0]["clientUser"]["id"] == user["id"]
    assert study["clientUserId"] == user["id"]


async def test_transaction_log_unknown_client_404(client):
    r = await client.get("/api/clients/424242/transactions", headers=ADMIN)
    assert r.status_code == 404
