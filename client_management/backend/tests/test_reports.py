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


async def test_balances_for_unknown_client_returns_404(client):
    # Per-client reads 404 for an unknown (or archived) client rather than
    # silently aggregating over zero rows, so a stale ?id= in the UI fails
    # cleanly (the page catches the 404 and shows the empty state) instead
    # of implying the phantom client exists with an all-zero balance.
    r = await client.get("/api/clients/99999/balances", headers=ADMIN)
    assert r.status_code == 404, r.text


async def test_balances_for_archived_client_returns_404(client):
    made = await make_client(client)
    await client.delete(f"/api/clients/{made['id']}", headers=ADMIN)
    r = await client.get(
        f"/api/clients/{made['id']}/balances", headers=ADMIN
    )
    assert r.status_code == 404, r.text


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


# --- Renewal radar ----------------------------------------------------------


async def test_renewals_bucket_boundaries_and_order(client):
    made = await make_client(client, name="Bucketeer")
    # One contract per boundary-interesting offset, created out of order
    # to prove the endpoint sorts by renewal date.
    offsets = [400, 0, 91, 30, 90, 31, 61, 60]
    for days in offsets:
        await make_contract(
            client,
            made["id"],
            name=f"Deal +{days}",
            occurred_on=_d(TODAY - timedelta(days=10)),
            renewal_on=_d(TODAY + timedelta(days=days)),
            credits_amount=500,
            dollars_amount=125,
        )

    r = await client.get("/api/reports/renewals", headers=ADMIN)
    assert r.status_code == 200
    rows = r.json()
    assert [row["daysUntil"] for row in rows] == [0, 30, 31, 60, 61, 90, 91, 400]
    # <=30 → "30", <=60 → "60", <=90 → "90", else "later" (inclusive edges).
    assert [row["bucket"] for row in rows] == [
        "30", "30", "60", "60", "90", "90", "later", "later",
    ]

    first = rows[0]
    assert first["client"]["id"] == made["id"]
    assert first["client"]["name"] == "Bucketeer"
    assert first["contractName"] == "Deal +0"
    assert isinstance(first["contractId"], int)
    assert first["renewalOn"] == _iso_z(TODAY)
    assert first["creditsAmount"] == 500.0
    assert first["dollarsAmount"] == 125.0


async def test_renewals_exclude_past_deleted_and_archived(client):
    keep = await make_client(client, name="Keeper")
    await make_contract(
        client,
        keep["id"],
        name="Upcoming",
        occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=45)),
    )
    # Renewed yesterday: no longer upcoming.
    await make_contract(
        client,
        keep["id"],
        name="Lapsed",
        occurred_on=_d(TODAY - timedelta(days=400)),
        renewal_on=_d(TODAY - timedelta(days=1)),
    )
    # Soft-deleted contract: excluded even though its renewal is soon.
    zombie = await make_contract(
        client,
        keep["id"],
        name="Zombie",
        occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=10)),
    )
    await client.delete(f"/api/contracts/{zombie['id']}", headers=ADMIN)
    # Archived client: its upcoming contract must not surface.
    gone = await make_client(client, name="Archived Co")
    await make_contract(
        client,
        gone["id"],
        name="Orphaned",
        occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=5)),
    )
    await client.delete(f"/api/clients/{gone['id']}", headers=ADMIN)

    rows = (await client.get("/api/reports/renewals", headers=ADMIN)).json()
    assert [row["contractName"] for row in rows] == ["Upcoming"]


async def test_renewals_expose_remaining_and_overdrawn(client):
    # Each renewing contract carries its own remaining balance (funding minus
    # the studies rolled up to it) and an over-drawn flag, so an approaching
    # renewal on a depleted contract is visible without opening the ledger.
    made = await make_client(client, name="Remainder Co")
    user = await make_user(client, made["id"], name="Ann")
    # Healthy: 1000 funded, 300 drawn -> 700 remaining, not over-drawn.
    healthy = await make_contract(
        client, made["id"], name="Healthy",
        occurred_on=_d(TODAY - timedelta(days=10)),
        renewal_on=_d(TODAY + timedelta(days=45)),
        credits_amount=1000, dollars_amount=0,
    )
    await make_study(
        client, made["id"], [user["id"]], name="Draw 300",
        occurred_on=_d(TODAY - timedelta(days=5)),
        cost_type="credits", cost=300, contract_id=healthy["id"],
    )
    # Over-drawn: 200 funded, 500 drawn -> -300 remaining, over-drawn.
    over = await make_contract(
        client, made["id"], name="Overdrawn",
        occurred_on=_d(TODAY - timedelta(days=10)),
        renewal_on=_d(TODAY + timedelta(days=20)),
        credits_amount=200, dollars_amount=0,
    )
    await make_study(
        client, made["id"], [user["id"]], name="Draw 500",
        occurred_on=_d(TODAY - timedelta(days=5)),
        cost_type="credits", cost=500, contract_id=over["id"],
    )
    # A contract with no linked studies keeps its full funding as remaining.
    await make_contract(
        client, made["id"], name="Untouched",
        occurred_on=_d(TODAY - timedelta(days=10)),
        renewal_on=_d(TODAY + timedelta(days=60)),
        credits_amount=400, dollars_amount=250,
    )

    rows = (await client.get("/api/reports/renewals", headers=ADMIN)).json()
    by_name = {r["contractName"]: r for r in rows}
    assert by_name["Healthy"]["remainingCredits"] == 700.0
    assert by_name["Healthy"]["remainingDollars"] == 0.0
    assert by_name["Healthy"]["overDrawn"] is False
    assert by_name["Overdrawn"]["remainingCredits"] == -300.0
    assert by_name["Overdrawn"]["overDrawn"] is True
    assert by_name["Untouched"]["remainingCredits"] == 400.0
    assert by_name["Untouched"]["remainingDollars"] == 250.0
    assert by_name["Untouched"]["overDrawn"] is False


async def test_renewals_remaining_ignores_deleted_and_unlinked_studies(client):
    # Remaining reflects only ACTIVE studies linked to that contract: a
    # soft-deleted linked study and an unlinked study both leave it untouched.
    made = await make_client(client, name="Cleanroom Co")
    user = await make_user(client, made["id"], name="Bo")
    con = await make_contract(
        client, made["id"], name="Solo",
        occurred_on=_d(TODAY - timedelta(days=10)),
        renewal_on=_d(TODAY + timedelta(days=30)),
        credits_amount=1000, dollars_amount=0,
    )
    # Linked but soft-deleted: must not count.
    zombie = await make_study(
        client, made["id"], [user["id"]], name="Zombie draw",
        occurred_on=_d(TODAY - timedelta(days=5)),
        cost_type="credits", cost=250, contract_id=con["id"],
    )
    await client.delete(f"/api/studies/{zombie['id']}", headers=ADMIN)
    # Active but unlinked (Unassigned): must not count toward this contract.
    await make_study(
        client, made["id"], [user["id"]], name="Unlinked draw",
        occurred_on=_d(TODAY - timedelta(days=5)),
        cost_type="credits", cost=400,
    )

    rows = (await client.get("/api/reports/renewals", headers=ADMIN)).json()
    solo = next(r for r in rows if r["contractName"] == "Solo")
    assert solo["remainingCredits"] == 1000.0
    assert solo["overDrawn"] is False


# --- Balance health ---------------------------------------------------------


async def test_balance_health_burn_window_and_projection(client):
    made = await make_client(client, name="Burner")
    user = await make_user(client, made["id"])
    await make_contract(
        client,
        made["id"],
        occurred_on=_d(TODAY - timedelta(days=100)),
        renewal_on=_d(TODAY + timedelta(days=265)),
        credits_amount=2000,
    )
    # In window: today, and exactly 90 days ago (inclusive boundary).
    await make_study(
        client, made["id"], [user["id"]], name="Recent",
        occurred_on=_d(TODAY), cost=300,
    )
    await make_study(
        client, made["id"], [user["id"]], name="Edge",
        occurred_on=_d(TODAY - timedelta(days=90)), cost=150,
    )
    # Out of window: 91 days ago — hits the balance, not the burn.
    await make_study(
        client, made["id"], [user["id"]], name="Old",
        occurred_on=_d(TODAY - timedelta(days=91)), cost=600,
    )

    r = await client.get("/api/reports/balance-health", headers=ADMIN)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["client"]["id"] == made["id"]
    assert row["credits"] == 2000.0 - 300.0 - 150.0 - 600.0
    assert row["dollars"] == 0.0
    assert row["monthlyCreditBurn"] == (300.0 + 150.0) / 3
    assert row["monthlyDollarBurn"] == 0.0
    # 950 credits at 150/month ≈ 6.33 months ≈ 193 days out → "ok".
    expected = (TODAY + timedelta(days=(950 / 150) * 30.44)).strftime("%Y-%m-%d")
    assert row["creditsRunOutOn"] == expected
    assert row["dollarsRunOutOn"] is None  # zero dollar balance
    assert row["status"] == "ok"


async def test_balance_health_tracker_contributes_annualized_burn(client):
    # A recurring tracker books its FULL ANNUAL cost as one transaction. That
    # lump must NOT be counted as trailing-window burn (it would 4x the rate),
    # but the tracker IS an ongoing commitment, so its annual/12 is added to
    # the monthly burn alongside recent single-study spend.
    made = await make_client(client, name="Tracker Co")
    user = await make_user(client, made["id"])
    await make_contract(
        client,
        made["id"],
        occurred_on=_d(TODAY - timedelta(days=10)),
        renewal_on=_d(TODAY + timedelta(days=355)),
        credits_amount=20000,
    )
    # Recent MONTHLY tracker: 300/run × 12 = 3600/yr booked now.
    await make_study(
        client, made["id"], [user["id"]], name="Tracker",
        occurred_on=_d(TODAY), cost=300, cadence="monthly",
    )
    # Recent single study: drives trailing burn (450 / 3).
    await make_study(
        client, made["id"], [user["id"]], name="OneShot",
        occurred_on=_d(TODAY), cost=450,
    )

    r = await client.get("/api/reports/balance-health", headers=ADMIN)
    assert r.status_code == 200
    row = next(x for x in r.json() if x["client"]["id"] == made["id"])
    # Burn = single (450/3=150) + tracker annualized (3600/12=300) = 450.
    assert row["monthlyCreditBurn"] == 450.0 / 3 + 3600.0 / 12
    # Balance still reflects the tracker's full-year deduction.
    assert row["credits"] == 20000.0 - 3600.0 - 450.0


async def test_balance_health_tracker_only_client_gets_runout(client):
    # A client whose only spend is a recurring tracker used to show zero burn
    # and NO run-out (trackers were excluded entirely) — invisible despite
    # steadily draining. Now the tracker's annual/12 drives a real projection.
    made = await make_client(client, name="Tracker Only Co")
    user = await make_user(client, made["id"])
    # Fund 4000 credits; a monthly tracker of 3600/yr leaves 400 remaining.
    await make_contract(
        client, made["id"],
        occurred_on=_d(TODAY - timedelta(days=40)),
        renewal_on=_d(TODAY + timedelta(days=325)),
        credits_amount=4000,
    )
    await make_study(
        client, made["id"], [user["id"]], name="Monthly tracker",
        occurred_on=_d(TODAY - timedelta(days=30)), cost=300, cadence="monthly",
    )
    r = await client.get("/api/reports/balance-health", headers=ADMIN)
    row = next(x for x in r.json() if x["client"]["id"] == made["id"])
    assert row["monthlyCreditBurn"] == 3600.0 / 12  # 300/mo from the tracker
    assert row["credits"] == 400.0
    # 400 / 300 ≈ 1.3 months ≈ 40 days < 60 → flagged low, with a run-out date.
    assert row["creditsRunOutOn"] is not None
    assert row["status"] == "low"


async def test_balance_health_tracker_setup_excluded_from_burn(client):
    # A tracker's one-time setup cost is bundled into its credits_delta but is
    # NOT recurring, so it must not be annualized into monthly burn.
    made = await make_client(client, name="Setup Tracker Co")
    user = await make_user(client, made["id"])
    await make_contract(
        client, made["id"],
        occurred_on=_d(TODAY - timedelta(days=10)),
        renewal_on=_d(TODAY + timedelta(days=355)),
        credits_amount=10000,
    )
    # Monthly tracker: 300/run × 12 = 3600/yr recurring, plus a 600 one-time setup.
    await make_study(
        client, made["id"], [user["id"]], name="Tracker w/ setup",
        occurred_on=_d(TODAY - timedelta(days=5)), cost=300, cadence="monthly",
        setup_cost=600,
    )
    r = await client.get("/api/reports/balance-health", headers=ADMIN)
    row = next(x for x in r.json() if x["client"]["id"] == made["id"])
    # Burn = recurring only (3600/12=300); the 600 setup is excluded.
    assert row["monthlyCreditBurn"] == 3600.0 / 12
    # Balance reflects BOTH the recurring year and the one-time setup.
    assert row["credits"] == 10000.0 - 3600.0 - 600.0


async def test_balance_health_expired_tracker_excluded_from_burn(client):
    # A tracker booked more than a year ago is past its booked year — no longer
    # an ongoing commitment, so it drops out of burn (balance still reflects it).
    made = await make_client(client, name="Lapsed Tracker Co")
    user = await make_user(client, made["id"])
    await make_contract(
        client, made["id"],
        occurred_on=_d(TODAY - timedelta(days=400)),
        renewal_on=_d(TODAY - timedelta(days=35)),
        credits_amount=5000,
    )
    await make_study(
        client, made["id"], [user["id"]], name="Old tracker",
        occurred_on=_d(TODAY - timedelta(days=400)), cost=300, cadence="monthly",
    )
    r = await client.get("/api/reports/balance-health", headers=ADMIN)
    row = next(x for x in r.json() if x["client"]["id"] == made["id"])
    assert row["monthlyCreditBurn"] == 0  # expired tracker adds nothing
    assert row["creditsRunOutOn"] is None
    assert row["credits"] == 5000.0 - 3600.0  # balance still reflects it


async def test_balance_health_flags_idle_funded_but_dormant(client):
    # An established client with a healthy positive balance and NO recent
    # spend is "idle" (funded-but-dormant = re-engagement/churn signal), not
    # "ok" where it would hide among healthy accounts.
    made = await make_client(client, name="Dormant Co")  # became a client 2024
    await make_contract(
        client,
        made["id"],
        occurred_on=_d(TODAY - timedelta(days=180)),
        renewal_on=_d(TODAY + timedelta(days=185)),
        credits_amount=5000,
    )
    r = await client.get("/api/reports/balance-health", headers=ADMIN)
    assert r.status_code == 200
    row = next(x for x in r.json() if x["client"]["id"] == made["id"])
    assert row["status"] == "idle"
    assert row["monthlyCreditBurn"] == 0


async def test_balance_health_zero_burn_null_run_out(client):
    made = await make_client(client, name="Idle Co")
    await make_contract(
        client,
        made["id"],
        occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=365)),
        credits_amount=500,
    )
    rows = (await client.get("/api/reports/balance-health", headers=ADMIN)).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["credits"] == 500.0
    assert row["monthlyCreditBurn"] == 0.0
    assert row["creditsRunOutOn"] is None
    assert row["dollarsRunOutOn"] is None
    assert row["status"] == "ok"


async def test_balance_health_negative_balance_flags_negative(client):
    made = await make_client(client, name="Overdrawn")
    user = await make_user(client, made["id"])
    await make_contract(
        client,
        made["id"],
        occurred_on=_d(TODAY - timedelta(days=30)),
        renewal_on=_d(TODAY + timedelta(days=335)),
        credits_amount=100,
    )
    await make_study(
        client, made["id"], [user["id"]], occurred_on=_d(TODAY), cost=250
    )
    rows = (await client.get("/api/reports/balance-health", headers=ADMIN)).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["credits"] == -150.0
    assert row["status"] == "negative"
    assert row["monthlyCreditBurn"] == 250.0 / 3
    # Nothing positive left to project.
    assert row["creditsRunOutOn"] is None


async def test_balance_health_status_sort_and_exclusions(client):
    # Names chosen so alphabetical order disagrees with status order.
    ok_co = await make_client(client, name="Aaa Ok Co")
    low_late = await make_client(client, name="Alate Low")
    low_soon = await make_client(client, name="Zsoon Low")
    neg = await make_client(client, name="Zz Negative")
    await make_client(client, name="Quiet Co")  # no transactions → absent
    archived = await make_client(client, name="Bygone Co")

    u_late = await make_user(client, low_late["id"])
    u_soon = await make_user(client, low_soon["id"])
    u_neg = await make_user(client, neg["id"])

    # Ok: healthy balance, no burn.
    await make_contract(
        client, ok_co["id"], occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=365)), credits_amount=1000,
    )
    # Low, later run-out (~46 days): 150 left, burning 100/month.
    await make_contract(
        client, low_late["id"], occurred_on=_d(TODAY - timedelta(days=60)),
        renewal_on=_d(TODAY + timedelta(days=305)), credits_amount=450,
    )
    await make_study(
        client, low_late["id"], [u_late["id"]],
        occurred_on=_d(TODAY - timedelta(days=10)), cost=300,
    )
    # Low, soonest run-out (~15 days): 50 left, burning 100/month.
    await make_contract(
        client, low_soon["id"], occurred_on=_d(TODAY - timedelta(days=60)),
        renewal_on=_d(TODAY + timedelta(days=305)), credits_amount=350,
    )
    await make_study(
        client, low_soon["id"], [u_soon["id"]],
        occurred_on=_d(TODAY - timedelta(days=10)), cost=300,
    )
    # Negative on the DOLLAR side only — still flagged "negative".
    await make_contract(
        client, neg["id"], occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=365)), credits_amount=500,
    )
    await make_study(
        client, neg["id"], [u_neg["id"]], occurred_on=_d(TODAY),
        cost_type="dollars", cost=75,
    )
    # Archived client with history must vanish from the report.
    await make_contract(
        client, archived["id"], occurred_on=_d(TODAY),
        renewal_on=_d(TODAY + timedelta(days=365)), credits_amount=800,
    )
    await client.delete(f"/api/clients/{archived['id']}", headers=ADMIN)

    rows = (await client.get("/api/reports/balance-health", headers=ADMIN)).json()
    assert [r["client"]["name"] for r in rows] == [
        "Zz Negative",  # negative first, despite last alphabetically
        "Zsoon Low",    # low: soonest run-out wins over name order
        "Alate Low",
        "Aaa Ok Co",    # ok last, despite first alphabetically
    ]
    assert [r["status"] for r in rows] == ["negative", "low", "low", "ok"]
    assert rows[0]["dollars"] == -75.0
    soonest = rows[1]["creditsRunOutOn"]
    later = rows[2]["creditsRunOutOn"]
    assert soonest is not None and later is not None and soonest < later
