"""Read endpoints for balances and the per-client transaction log.

Balances are computed by aggregation, never stored — a faithful port of
the frontend ``lib/balances.js`` plus the ``repo.js`` sum/contract
queries.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_user
from app.db import get_session
from app.helpers import current_year_window, utc_today
from app.models import Client, Transaction
from app.scoping import AccessScope, require_scope, scoped_client_or_404
from app.serializers import client_dict, transaction_dict

# Balance-health tuning: burn is averaged over the trailing 90 days, a
# month is 30.44 days (365.25 / 12), and a projected run-out within 60
# days flags the client as "low".
BURN_WINDOW_DAYS = 90
DAYS_PER_MONTH = 30.44
LOW_RUNWAY_DAYS = 60

router = APIRouter(
    prefix="/api",
    tags=["reports"],
    dependencies=[Depends(require_user)],
)


async def _active_client_or_404(session: AsyncSession, client_id: int) -> Client:
    """Fetch a non-archived client by id, or raise 404.

    Per-client read endpoints are directly reachable on the public API,
    so they must agree with ``GET /api/clients/{id}`` and hide archived
    or nonexistent clients rather than serving zeros/real data.
    """
    c = await session.get(Client, client_id)
    if c is None or c.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Client not found"
        )
    return c


def _iso(dt: datetime | None) -> str | None:
    """Render a renewal datetime as a UTC ISO string.

    Parameters
    ----------
    dt : datetime or None
        Earliest renewal date, if any.

    Returns
    -------
    str or None
        ISO-8601 string ending in ``Z``, or ``None``.
    """
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "") + "Z"


@router.get("/clients/{client_id}/balances")
async def client_balances(
    client_id: int,
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> dict:
    """Lifetime balances + current-year contract figures for one client.

    Parameters
    ----------
    client_id : int
        Target client.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"credits", "dollars", "cyCredits", "cyValue", "cyRenewal"}`` —
        lifetime credit/dollar balances, the current-year contracted
        credits and dollar value, and the next upcoming renewal date.
    """
    await scoped_client_or_404(session, client_id, scope)
    soy, eoy, _ = current_year_window()
    is_cy_contract = (
        (Transaction.kind == "contract")
        & (Transaction.occurred_on >= soy)
        & (Transaction.occurred_on < eoy)
    )
    # "Next renewal" = the earliest renewal date still in the future,
    # across ALL of the client's contracts — not only ones dated this
    # calendar year (a Dec-2025 contract renewing in 2026 must surface).
    is_upcoming_renewal = (
        (Transaction.kind == "contract")
        & (Transaction.renewal_on.is_not(None))
        & (Transaction.renewal_on >= utc_today())
    )
    row = (
        await session.execute(
            select(
                func.coalesce(func.sum(Transaction.credits_delta), 0),
                func.coalesce(func.sum(Transaction.dollars_delta), 0),
                func.coalesce(func.sum(case((is_cy_contract, Transaction.credits_delta), else_=0)), 0),
                func.coalesce(func.sum(case((is_cy_contract, Transaction.dollars_delta), else_=0)), 0),
                func.min(case((is_upcoming_renewal, Transaction.renewal_on))),
            ).where(
                Transaction.client_id == client_id,
                Transaction.deleted_at.is_(None),
            )
        )
    ).one()
    return {
        "credits": float(row[0]),
        "dollars": float(row[1]),
        "cyCredits": float(row[2]),
        "cyValue": float(row[3]),
        "cyRenewal": _iso(row[4]),
    }


@router.get("/clients/{client_id}/family")
async def client_family(
    client_id: int,
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> dict:
    """Parent/children rollup for a client (flat macro/micro view).

    Returns the client, its parent (if any, and visible to the caller), its
    visible children with balances, and a rollup summing the client's own
    balance plus every visible child. ``partial`` is true when scoping hides
    some children, so the UI can label the total "your clients in this family".
    """
    client = await scoped_client_or_404(session, client_id, scope)

    parent = None
    if client.parent_id is not None:
        p = (
            await session.execute(
                select(Client).where(
                    Client.id == client.parent_id,
                    Client.deleted_at.is_(None),
                    scope.client_filter(),
                )
            )
        ).scalar_one_or_none()
        if p is not None:
            parent = {"id": p.id, "name": p.name}

    total_children = (
        await session.execute(
            select(func.count()).select_from(Client).where(
                Client.parent_id == client_id, Client.deleted_at.is_(None)
            )
        )
    ).scalar_one()
    visible_children = (
        await session.execute(
            select(Client)
            .where(
                Client.parent_id == client_id,
                Client.deleted_at.is_(None),
                scope.client_filter(),
            )
            .order_by(Client.name.asc())
        )
    ).scalars().all()
    partial = total_children > len(visible_children)

    soy, eoy, _ = current_year_window()
    is_cy_contract = (
        (Transaction.kind == "contract")
        & (Transaction.occurred_on >= soy)
        & (Transaction.occurred_on < eoy)
    )
    is_upcoming_renewal = (
        (Transaction.kind == "contract")
        & (Transaction.renewal_on.is_not(None))
        & (Transaction.renewal_on >= utc_today())
    )
    ids = [client.id] + [c.id for c in visible_children]
    agg = {
        row.client_id: row
        for row in await session.execute(
            select(
                Transaction.client_id.label("client_id"),
                func.coalesce(func.sum(Transaction.credits_delta), 0).label("credits"),
                func.coalesce(func.sum(Transaction.dollars_delta), 0).label("dollars"),
                func.coalesce(func.sum(case((is_cy_contract, Transaction.credits_delta), else_=0)), 0).label("cy_credits"),
                func.coalesce(func.sum(case((is_cy_contract, Transaction.dollars_delta), else_=0)), 0).label("cy_value"),
                func.min(case((is_upcoming_renewal, Transaction.renewal_on))).label("cy_renewal"),
            )
            .where(Transaction.client_id.in_(ids), Transaction.deleted_at.is_(None))
            .group_by(Transaction.client_id)
        )
    }

    def _bal(cid: int):
        r = agg.get(cid)
        if r is None:
            return (0.0, 0.0, 0.0, 0.0, None)
        return (float(r.credits), float(r.dollars), float(r.cy_credits), float(r.cy_value), r.cy_renewal)

    roll = {"credits": 0.0, "dollars": 0.0, "cyCredits": 0.0, "cyValue": 0.0}
    renewals = []

    def _add(cid: int):
        cr, dl, cyc, cyv, ren = _bal(cid)
        roll["credits"] += cr
        roll["dollars"] += dl
        roll["cyCredits"] += cyc
        roll["cyValue"] += cyv
        if ren is not None:
            renewals.append(ren)
        return cr, dl, cyv, ren

    _add(client.id)  # the client's own balance seeds the rollup
    children = []
    for c in visible_children:
        cr, dl, cyv, ren = _add(c.id)
        children.append({
            "id": c.id,
            "name": c.name,
            "credits": cr,
            "dollars": dl,
            "cyValue": cyv,
            "cyRenewal": _iso(ren),
        })

    roll["nextRenewal"] = _iso(min(renewals)) if renewals else None
    return {
        "client": {"id": client.id, "name": client.name},
        "parent": parent,
        "children": children,
        "rollup": roll,
        "partial": partial,
    }


@router.get("/reports/balances")
async def all_balances(
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> list[dict]:
    """Balance summary across every client (ascending by name).

    Parameters
    ----------
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    list of dict
        One row per client: ``{"client", "credits", "dollars",
        "cyCredits", "cyValue", "cyRenewal"}``.
    """
    soy, eoy, _ = current_year_window()
    is_cy_contract = (
        (Transaction.kind == "contract")
        & (Transaction.occurred_on >= soy)
        & (Transaction.occurred_on < eoy)
    )
    is_upcoming_renewal = (
        (Transaction.kind == "contract")
        & (Transaction.renewal_on.is_not(None))
        & (Transaction.renewal_on >= utc_today())
    )
    clients = (
        await session.execute(
            select(Client)
            .where(Client.deleted_at.is_(None), scope.client_filter())
            .order_by(Client.name.asc())
        )
    ).scalars().all()
    agg = {
        row.client_id: (
            float(row.credits),
            float(row.dollars),
            float(row.cy_credits),
            float(row.cy_value),
            row.cy_renewal,
        )
        for row in await session.execute(
            select(
                Transaction.client_id.label("client_id"),
                func.coalesce(func.sum(Transaction.credits_delta), 0).label("credits"),
                func.coalesce(func.sum(Transaction.dollars_delta), 0).label("dollars"),
                func.coalesce(func.sum(case((is_cy_contract, Transaction.credits_delta), else_=0)), 0).label("cy_credits"),
                func.coalesce(func.sum(case((is_cy_contract, Transaction.dollars_delta), else_=0)), 0).label("cy_value"),
                func.min(case((is_upcoming_renewal, Transaction.renewal_on))).label("cy_renewal"),
            )
            .where(Transaction.deleted_at.is_(None))
            .group_by(Transaction.client_id)
        )
    }
    out = []
    for c in clients:
        credits, dollars, cy_credits, cy_value, cy_renewal = agg.get(
            c.id, (0.0, 0.0, 0.0, 0.0, None)
        )
        out.append(
            {
                "client": client_dict(c),
                "credits": credits,
                "dollars": dollars,
                "cyCredits": cy_credits,
                "cyValue": cy_value,
                "cyRenewal": _iso(cy_renewal),
            }
        )
    return out


@router.get("/clients/{client_id}/transactions")
async def client_transactions(
    client_id: int,
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> list[dict]:
    """Full transaction log for a client, newest first.

    Parameters
    ----------
    client_id : int
        Target client.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    list of dict
        Transactions with the legacy ``clientUser`` joined.

    Raises
    ------
    HTTPException
        ``404`` if the client does not exist.
    """
    await scoped_client_or_404(session, client_id, scope)
    result = await session.execute(
        select(Transaction)
        .where(
            Transaction.client_id == client_id,
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
        .options(selectinload(Transaction.client_user))
    )
    return [
        transaction_dict(t, with_client_user=True)
        for t in result.scalars().all()
    ]


@router.get("/clients/{client_id}/ledger")
async def client_ledger(
    client_id: int,
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> dict:
    """Contract-grouped ledger for a client.

    Groups a client's active transactions so studies nest under the
    contract they roll up to, each contract carrying its own remaining
    balance (funding minus its linked studies). Studies with no contract
    fall to ``unassigned``; adjustments stay client-level. This is an
    additive read — it never changes the pooled client balance, which is
    still ``totals`` here and identical to ``/balances``.

    Parameters
    ----------
    client_id : int
        Target client.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"contracts": [...], "unassigned": [...], "adjustments": [...],
        "totals": {"credits", "dollars"}}``. Each contract carries
        ``remainingCredits``/``remainingDollars`` and a nested ``studies``
        list.

    Raises
    ------
    HTTPException
        ``404`` if the client is absent or archived.
    """
    await scoped_client_or_404(session, client_id, scope)
    result = await session.execute(
        select(Transaction)
        .where(
            Transaction.client_id == client_id,
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
        .options(selectinload(Transaction.client_user))
    )
    txns = list(result.scalars().all())
    contract_ids = {t.id for t in txns if t.kind == "contract"}

    studies_by_contract: dict[int, list[Transaction]] = {}
    unassigned: list[Transaction] = []
    for s in (t for t in txns if t.kind == "study"):
        # A link to a soft-deleted/absent contract falls back to Unassigned.
        if s.contract_id is not None and s.contract_id in contract_ids:
            studies_by_contract.setdefault(s.contract_id, []).append(s)
        else:
            unassigned.append(s)

    contract_rows = []
    for c in (t for t in txns if t.kind == "contract"):
        linked = studies_by_contract.get(c.id, [])
        row = transaction_dict(c)
        row["remainingCredits"] = float(c.credits_delta) + sum(
            float(s.credits_delta) for s in linked
        )
        row["remainingDollars"] = float(c.dollars_delta) + sum(
            float(s.dollars_delta) for s in linked
        )
        row["studies"] = [
            transaction_dict(s, with_client_user=True) for s in linked
        ]
        contract_rows.append(row)

    return {
        "contracts": contract_rows,
        "unassigned": [
            transaction_dict(s, with_client_user=True) for s in unassigned
        ],
        "adjustments": [
            transaction_dict(a) for a in txns if a.kind == "adjustment"
        ],
        "totals": {
            "credits": sum(float(t.credits_delta) for t in txns),
            "dollars": sum(float(t.dollars_delta) for t in txns),
        },
    }


def _bucket(days_until: int) -> str:
    """Classify a renewal by how far out it is.

    Parameters
    ----------
    days_until : int
        Whole days from today until the renewal date (0 = due today).

    Returns
    -------
    str
        ``"30"`` (due within 30 days), ``"60"`` (31–60), ``"90"``
        (61–90) or ``"later"``.
    """
    if days_until <= 30:
        return "30"
    if days_until <= 60:
        return "60"
    if days_until <= 90:
        return "90"
    return "later"


@router.get("/reports/renewals")
async def renewal_radar(
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> list[dict]:
    """Every upcoming contract renewal, soonest first.

    Scans all ACTIVE contracts of ACTIVE (non-archived) clients whose
    ``renewal_on`` is today or later, ascending by renewal date.

    Parameters
    ----------
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    list of dict
        One row per contract: ``{"client", "contractId", "contractName",
        "renewalOn", "daysUntil", "creditsAmount", "dollarsAmount",
        "remainingCredits", "remainingDollars", "overDrawn", "bucket"}``
        where ``bucket`` is ``"30"``/``"60"``/``"90"``/``"later"`` by days
        until renewal. ``remaining*`` is the contract's funding minus the
        active studies rolled up to it (matching the ledger); ``overDrawn``
        is true when either remaining balance is negative.
    """
    today = utc_today()
    result = await session.execute(
        select(Transaction, Client)
        .join(Client, Client.id == Transaction.client_id)
        .where(
            Transaction.kind == "contract",
            Transaction.deleted_at.is_(None),
            Transaction.renewal_on.is_not(None),
            Transaction.renewal_on >= today,
            Client.deleted_at.is_(None),
            scope.client_filter(),
        )
        .order_by(Transaction.renewal_on.asc(), Transaction.id.asc())
    )
    rows = result.all()

    # Roll up each renewing contract's active linked studies in one grouped
    # query (studies carry negative deltas), then remaining = funding + drawn.
    contract_ids = [t.id for t, _ in rows]
    drawn: dict[int, tuple[float, float]] = {}
    if contract_ids:
        for r in await session.execute(
            select(
                Transaction.contract_id.label("contract_id"),
                func.coalesce(func.sum(Transaction.credits_delta), 0).label("credits"),
                func.coalesce(func.sum(Transaction.dollars_delta), 0).label("dollars"),
            )
            .where(
                Transaction.kind == "study",
                Transaction.deleted_at.is_(None),
                Transaction.contract_id.in_(contract_ids),
            )
            .group_by(Transaction.contract_id)
        ):
            drawn[r.contract_id] = (float(r.credits), float(r.dollars))

    out = []
    for t, c in rows:
        days_until = (t.renewal_on - today).days
        d_credits, d_dollars = drawn.get(t.id, (0.0, 0.0))
        remaining_credits = float(t.credits_delta or 0) + d_credits
        remaining_dollars = float(t.dollars_delta or 0) + d_dollars
        out.append(
            {
                "client": client_dict(c),
                "contractId": t.id,
                "contractName": t.name,
                "renewalOn": _iso(t.renewal_on),
                "daysUntil": days_until,
                "creditsAmount": float(t.credits_delta or 0),
                "dollarsAmount": float(t.dollars_delta or 0),
                "remainingCredits": remaining_credits,
                "remainingDollars": remaining_dollars,
                "overDrawn": remaining_credits < 0 or remaining_dollars < 0,
                "bucket": _bucket(days_until),
            }
        )
    return out


def _run_out(today: datetime, balance: float, monthly_burn: float) -> datetime | None:
    """Project when a balance depletes at a given monthly burn.

    Parameters
    ----------
    today : datetime
        UTC midnight of the current date.
    balance : float
        Current balance (credits or dollars).
    monthly_burn : float
        Average consumption per month.

    Returns
    -------
    datetime or None
        ``today + (balance / monthly_burn)`` months (at
        :data:`DAYS_PER_MONTH` days each), or ``None`` when there is no
        burn, no positive balance to deplete, or the runway is so long
        (huge balance / tiny recent burn) that it is effectively "never".
    """
    if monthly_burn <= 0 or balance <= 0:
        return None
    days = (balance / monthly_burn) * DAYS_PER_MONTH
    # A runway beyond ~27 years is "not a concern" — and, crucially,
    # datetime + timedelta OverflowErrors past year 9999, which would
    # 500 the whole balance-health report for every client.
    if days > 10_000:
        return None
    return today + timedelta(days=days)


@router.get("/reports/balance-health")
async def balance_health(
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> list[dict]:
    """Burn rate and projected run-out for every client with activity.

    One row per ACTIVE client that has at least one ACTIVE transaction.
    Monthly burn is the credits/dollars consumed by SINGLE (non-tracker)
    studies over the trailing :data:`BURN_WINDOW_DAYS` days divided by 3;
    the run-out date projects the current balance forward at that pace.
    Recurring trackers book their full year as one lump at creation, so
    they are excluded from burn (they still reduce the balance).

    Parameters
    ----------
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    list of dict
        Rows shaped ``{"client", "credits", "dollars",
        "monthlyCreditBurn", "monthlyDollarBurn", "creditsRunOutOn",
        "dollarsRunOutOn", "status"}``. ``status`` is ``"negative"``
        (either balance below zero), ``"low"`` (a run-out within
        :data:`LOW_RUNWAY_DAYS` days) or ``"ok"``. Sorted negative
        first, then low by soonest run-out, then ok by client name.
    """
    today = utc_today()
    # Burn = trailing-window consumption by SINGLE studies only. Recurring
    # trackers book their whole year as one lump at creation, so counting that
    # lump would massively overstate burn (a monthly tracker booked this week
    # would read as ~4x its true monthly rate) and project run-out far too
    # soon. Trackers still reduce the balance; they just aren't ongoing burn.
    is_recent_study = (
        (Transaction.kind == "study")
        & (Transaction.cadence.is_(None))
        & (Transaction.occurred_on >= today - timedelta(days=BURN_WINDOW_DAYS))
    )
    agg = {
        row.client_id: row
        for row in await session.execute(
            select(
                Transaction.client_id.label("client_id"),
                func.coalesce(func.sum(Transaction.credits_delta), 0).label("credits"),
                func.coalesce(func.sum(Transaction.dollars_delta), 0).label("dollars"),
                func.coalesce(func.sum(case((is_recent_study, -Transaction.credits_delta), else_=0)), 0).label("credit_burn"),
                func.coalesce(func.sum(case((is_recent_study, -Transaction.dollars_delta), else_=0)), 0).label("dollar_burn"),
                func.coalesce(func.sum(case((Transaction.occurred_on >= today - timedelta(days=BURN_WINDOW_DAYS), 1), else_=0)), 0).label("recent_any"),
            )
            .where(Transaction.deleted_at.is_(None))
            .group_by(Transaction.client_id)
        )
    }
    if not agg:
        return []
    clients = (
        await session.execute(
            select(Client).where(
                Client.deleted_at.is_(None),
                Client.id.in_(agg.keys()),
                scope.client_filter(),
            )
        )
    ).scalars().all()
    low_cutoff = today + timedelta(days=LOW_RUNWAY_DAYS)
    out = []
    for c in clients:
        row = agg[c.id]
        credits = float(row.credits)
        dollars = float(row.dollars)
        credit_burn = float(row.credit_burn) / 3
        dollar_burn = float(row.dollar_burn) / 3
        credits_out = _run_out(today, credits, credit_burn)
        dollars_out = _run_out(today, dollars, dollar_burn)
        if credits < 0 or dollars < 0:
            health = "negative"
        elif any(
            d is not None and d <= low_cutoff for d in (credits_out, dollars_out)
        ):
            health = "low"
        elif (
            int(row.recent_any) == 0
            and (credits > 0 or dollars > 0)
            and c.became_client_on < today - timedelta(days=BURN_WINDOW_DAYS)
        ):
            # Established client with money on the books but no transaction of
            # any kind in the trailing window — funded but dormant, a
            # re-engagement/churn signal rather than a healthy "ok".
            health = "idle"
        else:
            health = "ok"
        out.append(
            {
                "client": client_dict(c),
                "credits": credits,
                "dollars": dollars,
                "monthlyCreditBurn": credit_burn,
                "monthlyDollarBurn": dollar_burn,
                "creditsRunOutOn": credits_out.strftime("%Y-%m-%d") if credits_out else None,
                "dollarsRunOutOn": dollars_out.strftime("%Y-%m-%d") if dollars_out else None,
                "status": health,
            }
        )

    rank = {"negative": 0, "low": 1, "idle": 2, "ok": 3}

    def _key(r: dict) -> tuple:
        soonest = ""
        if r["status"] == "low":
            soonest = min(
                d
                for d in (r["creditsRunOutOn"], r["dollarsRunOutOn"])
                if d is not None
            )
        return (rank[r["status"]], soonest, r["client"]["name"].lower())

    out.sort(key=_key)
    return out
