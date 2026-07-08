"""Read endpoints for balances and the per-client transaction log.

Balances are computed by aggregation, never stored — a faithful port of
the frontend ``lib/balances.js`` plus the ``repo.js`` sum/contract
queries.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_user
from app.db import get_session
from app.helpers import current_year_window
from app.models import Client, Transaction
from app.serializers import client_dict, transaction_dict

router = APIRouter(
    prefix="/api",
    tags=["reports"],
    dependencies=[Depends(require_user)],
)


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
    client_id: int, session: AsyncSession = Depends(get_session)
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
        ``{"credits", "dollars", "cyValue", "cyRenewal"}``.
    """
    soy, eoy, _ = current_year_window()
    is_cy_contract = (
        (Transaction.kind == "contract")
        & (Transaction.occurred_on >= soy)
        & (Transaction.occurred_on < eoy)
    )
    row = (
        await session.execute(
            select(
                func.coalesce(func.sum(Transaction.credits_delta), 0),
                func.coalesce(func.sum(Transaction.dollars_delta), 0),
                func.coalesce(func.sum(case((is_cy_contract, Transaction.dollars_delta), else_=0)), 0),
                func.min(case((is_cy_contract, Transaction.renewal_on))),
            ).where(Transaction.client_id == client_id)
        )
    ).one()
    return {
        "credits": float(row[0]),
        "dollars": float(row[1]),
        "cyValue": float(row[2]),
        "cyRenewal": _iso(row[3]),
    }


@router.get("/reports/balances")
async def all_balances(
    session: AsyncSession = Depends(get_session),
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
        "cyValue", "cyRenewal"}``.
    """
    soy, eoy, _ = current_year_window()
    is_cy_contract = (
        (Transaction.kind == "contract")
        & (Transaction.occurred_on >= soy)
        & (Transaction.occurred_on < eoy)
    )
    clients = (
        await session.execute(select(Client).order_by(Client.name.asc()))
    ).scalars().all()
    agg = {
        row.client_id: (float(row.credits), float(row.dollars), float(row.cy_value), row.cy_renewal)
        for row in await session.execute(
            select(
                Transaction.client_id.label("client_id"),
                func.coalesce(func.sum(Transaction.credits_delta), 0).label("credits"),
                func.coalesce(func.sum(Transaction.dollars_delta), 0).label("dollars"),
                func.coalesce(func.sum(case((is_cy_contract, Transaction.dollars_delta), else_=0)), 0).label("cy_value"),
                func.min(case((is_cy_contract, Transaction.renewal_on))).label("cy_renewal"),
            ).group_by(Transaction.client_id)
        )
    }
    out = []
    for c in clients:
        credits, dollars, cy_value, cy_renewal = agg.get(c.id, (0.0, 0.0, 0.0, None))
        out.append(
            {
                "client": client_dict(c),
                "credits": credits,
                "dollars": dollars,
                "cyValue": cy_value,
                "cyRenewal": _iso(cy_renewal),
            }
        )
    return out


@router.get("/clients/{client_id}/transactions")
async def client_transactions(
    client_id: int, session: AsyncSession = Depends(get_session)
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
    if await session.get(Client, client_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Client not found"
        )
    result = await session.execute(
        select(Transaction)
        .where(Transaction.client_id == client_id)
        .order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
        .options(selectinload(Transaction.client_user))
    )
    return [
        transaction_dict(t, with_client_user=True)
        for t in result.scalars().all()
    ]
