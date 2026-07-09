"""Contract transaction endpoints.

Contracts add positive deltas to a client's balances. All the form
validation that used to live in the Express routes (name required,
non-negative amounts, at least one of credits/dollars, renewal strictly
after the contract date) is authoritative here.
"""

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_session
from app.helpers import add_year, parse_date, parse_money, utc_now
from app.models import Client, Transaction
from app.schemas import ContractIn
from app.serializers import transaction_dict

router = APIRouter(
    prefix="/api",
    tags=["contracts"],
    dependencies=[Depends(require_user)],
)


def _contract_dict(t: Transaction) -> dict:
    """Serialise a contract, adding the decorated amount fields.

    Parameters
    ----------
    t : Transaction
        Contract row.

    Returns
    -------
    dict
        Serialised transaction plus ``creditsAmount`` / ``dollarsAmount``
        (matching the frontend ``decorateContract``).
    """
    d = transaction_dict(t)
    d["creditsAmount"] = float(t.credits_delta or 0)
    d["dollarsAmount"] = float(t.dollars_delta or 0)
    return d


def _validate(
    name: str,
    credits_amount: float,
    dollars_amount: float,
    occurred_on,
    renewal_on,
) -> None:
    """Enforce the contract business rules.

    Parameters
    ----------
    name : str
        Trimmed contract name.
    credits_amount, dollars_amount : float
        Parsed positive amounts.
    occurred_on : datetime or None
        Contract start date (``None`` when missing/unparseable).
    renewal_on : datetime or None
        Renewal date (``None`` when the given value was unparseable).

    Raises
    ------
    HTTPException
        ``400`` with a human message when any rule fails.
    """
    if not name:
        raise HTTPException(400, "Contract name is required.")
    if occurred_on is None:
        raise HTTPException(400, "Contract date is required.")
    if renewal_on is None:
        raise HTTPException(400, "Renewal date must be a valid date.")
    if credits_amount < 0 or dollars_amount < 0:
        raise HTTPException(400, "Contract amounts must be non-negative.")
    if credits_amount == 0 and dollars_amount == 0:
        raise HTTPException(400, "Enter at least one of credits or dollars.")
    if renewal_on <= occurred_on:
        raise HTTPException(
            400, "Renewal date must be after the contract date."
        )


async def _existing_by_idem_key(
    session: AsyncSession, key: str | None
) -> Transaction | None:
    """Return the transaction already created under an idempotency key.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    key : str or None
        The ``Idempotency-Key`` header value, if any.

    Returns
    -------
    Transaction or None
        The previously created row, or ``None``.
    """
    if not key:
        return None
    result = await session.execute(
        select(Transaction).where(Transaction.idem_key == key)
    )
    return result.scalar_one_or_none()


async def _contract_or_404(
    session: AsyncSession, txn_id: int
) -> Transaction:
    """Fetch a contract transaction by id or raise ``404``.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    txn_id : int
        Transaction primary key.

    Returns
    -------
    Transaction
        The matching contract.

    Raises
    ------
    HTTPException
        ``404`` if absent or not of kind ``contract``.
    """
    t = await session.get(Transaction, txn_id)
    if t is None or t.kind != "contract" or t.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found",
        )
    return t


@router.get("/clients/{client_id}/contracts")
async def list_contracts(
    client_id: int, session: AsyncSession = Depends(get_session)
) -> list[dict]:
    """List a client's contracts, newest first.

    Parameters
    ----------
    client_id : int
        Owning client.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    list of dict
        Decorated contract transactions.
    """
    owner = await session.get(Client, client_id)
    if owner is None or owner.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Client not found"
        )
    result = await session.execute(
        select(Transaction)
        .where(
            Transaction.client_id == client_id,
            Transaction.kind == "contract",
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
    )
    return [_contract_dict(t) for t in result.scalars().all()]


@router.post("/contracts", status_code=status.HTTP_201_CREATED)
async def create_contract(
    body: ContractIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    """Record a contract for a client.

    Parameters
    ----------
    body : ContractIn
        Contract form payload (includes ``client_id``).
    session : AsyncSession
        Injected request-scoped database session.
    user : str
        Authenticated acting user (recorded as ``actor_email``).
    idempotency_key : str or None
        Optional ``Idempotency-Key`` header; a replayed key returns the
        already-created row instead of inserting a duplicate.

    Returns
    -------
    dict
        The created contract.

    Raises
    ------
    HTTPException
        ``404`` if the client is absent, ``400`` if validation fails.
    """
    # Namespace the key per kind so the same Idempotency-Key presented to
    # a different endpoint can never collide or return a wrong-kind row.
    idem = f"contract:{idempotency_key}" if idempotency_key else None
    existing = await _existing_by_idem_key(session, idem)
    if existing is not None:
        out = _contract_dict(existing)
        prior_client = await session.get(Client, existing.client_id)
        out["clientName"] = prior_client.name if prior_client else None
        return out

    client = await session.get(Client, body.client_id or 0)
    if client is None or client.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Client not found"
        )
    name = (body.name or "").strip()
    occurred_on = parse_date(body.occurred_on)
    renewal_raw = (body.renewal_on or "").strip()
    renewal_on = (
        parse_date(renewal_raw)
        if renewal_raw
        else (add_year(occurred_on) if occurred_on else None)
    )
    credits_amount = parse_money(body.credits_amount)
    dollars_amount = parse_money(body.dollars_amount)
    _validate(name, credits_amount, dollars_amount, occurred_on, renewal_on)

    t = Transaction(
        client_id=client.id,
        kind="contract",
        name=name,
        socc_project_code=(body.socc_project_code or "").strip() or None,
        occurred_on=occurred_on,
        renewal_on=renewal_on,
        credits_delta=credits_amount,
        dollars_delta=dollars_amount,
        actor_email=user,
        idem_key=idem,
    )
    client_name = client.name  # read before commit/rollback expires it
    session.add(t)
    try:
        await session.commit()
    except IntegrityError:
        # Race on the idem_key unique index: another request with the same
        # key won; return its row instead of failing.
        await session.rollback()
        existing = await _existing_by_idem_key(session, idem)
        if existing is None:
            raise
        out = _contract_dict(existing)
        out["clientName"] = client_name
        return out
    await session.refresh(t)
    out = _contract_dict(t)
    out["clientName"] = client_name
    return out


@router.patch("/contracts/{txn_id}")
async def update_contract(
    txn_id: int,
    body: ContractIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
) -> dict:
    """Update an existing contract.

    Parameters
    ----------
    txn_id : int
        Contract transaction id.
    body : ContractIn
        Contract form payload.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        The updated contract.

    Raises
    ------
    HTTPException
        ``404`` if absent/not a contract, ``400`` if validation fails.
    """
    t = await _contract_or_404(session, txn_id)
    name = (body.name or "").strip()
    occurred_on = parse_date(body.occurred_on)
    renewal_raw = (body.renewal_on or "").strip()
    renewal_on = (
        parse_date(renewal_raw)
        if renewal_raw
        else (add_year(occurred_on) if occurred_on else None)
    )
    credits_amount = parse_money(body.credits_amount)
    dollars_amount = parse_money(body.dollars_amount)
    _validate(name, credits_amount, dollars_amount, occurred_on, renewal_on)

    t.name = name
    if body.socc_project_code is not None:
        t.socc_project_code = (body.socc_project_code or "").strip() or None
    t.occurred_on = occurred_on
    t.renewal_on = renewal_on
    t.credits_delta = credits_amount
    t.dollars_delta = dollars_amount
    t.updated_by_email = user
    t.updated_at = utc_now()
    await session.commit()
    await session.refresh(t)
    return _contract_dict(t)


@router.delete("/contracts/{txn_id}")
async def delete_contract(
    txn_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
) -> dict:
    """Archive a contract (soft delete) — its history is preserved.

    Parameters
    ----------
    txn_id : int
        Contract transaction id.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"clientId": int, "name": str}`` for the caller's redirect.

    Raises
    ------
    HTTPException
        ``404`` if absent or not a contract.
    """
    t = await _contract_or_404(session, txn_id)
    t.deleted_at = utc_now()
    t.updated_by_email = user
    t.updated_at = utc_now()
    await session.commit()
    return {"clientId": t.client_id, "name": t.name}
