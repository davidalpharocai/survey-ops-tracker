"""Adjustment transaction endpoint.

Corrections are recorded as NEW ledger rows (kind ``"adjustment"``) with
signed deltas, never by editing or deleting history. Because the balance
reports (``reports.py``) sum every non-archived transaction of a client
regardless of kind, adjustments flow into balances automatically, and the
per-client transaction log lists them like any other entry.

An adjustment may optionally point at the transaction it reverses via
``reverses_transaction_id`` (recorded, and reflected in the row's name).
"""

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_session
from app.helpers import parse_money, utc_today
from app.models import Client, Transaction
from app.scoping import AccessScope, require_unrestricted
from app.serializers import transaction_dict

router = APIRouter(
    prefix="/api",
    tags=["adjustments"],
    dependencies=[Depends(require_user)],
)


class AdjustmentIn(BaseModel):
    """Create payload for an adjustment (signed correction) entry."""

    client_id: int | None = None
    credits_delta: float | str | None = None
    dollars_delta: float | str | None = None
    note: str | None = None
    reverses_transaction_id: int | None = None


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


@router.post("/adjustments", status_code=status.HTTP_201_CREATED)
async def create_adjustment(
    body: AdjustmentIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
    _scope: AccessScope = Depends(require_unrestricted),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    """Record a signed correction as a new ledger row.

    Parameters
    ----------
    body : AdjustmentIn
        ``client_id``, signed ``credits_delta`` / ``dollars_delta``
        (at least one non-zero), a required ``note`` explaining the
        correction, and an optional ``reverses_transaction_id``.
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
        The created adjustment plus ``clientName`` for the caller's flash.

    Raises
    ------
    HTTPException
        ``404`` if the client (or referenced transaction) is absent or
        archived, ``400`` if the note is missing, both deltas are zero,
        an amount is unparseable, or the referenced transaction belongs
        to another client.
    """
    # Namespace the key per kind so the same Idempotency-Key presented to
    # a different endpoint can never collide or return a wrong-kind row.
    idem = f"adjustment:{idempotency_key}" if idempotency_key else None
    existing = await _existing_by_idem_key(session, idem)
    if existing is not None:
        out = transaction_dict(existing)
        prior_client = await session.get(Client, existing.client_id)
        out["clientName"] = prior_client.name if prior_client else None
        return out

    client = await session.get(Client, body.client_id or 0)
    if client is None or client.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Client not found"
        )

    note = (body.note or "").strip()
    if not note:
        raise HTTPException(
            400, "A note explaining the adjustment is required."
        )

    # Signed corrections: negatives are allowed here (unlike contracts).
    credits_delta = parse_money(body.credits_delta)
    dollars_delta = parse_money(body.dollars_delta)
    if credits_delta == 0 and dollars_delta == 0:
        raise HTTPException(
            400, "Enter a non-zero credits and/or dollars delta."
        )

    name = "Adjustment"
    if body.reverses_transaction_id is not None:
        reversed_txn = await session.get(
            Transaction, body.reverses_transaction_id
        )
        if reversed_txn is None or reversed_txn.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Transaction to reverse not found.",
            )
        if reversed_txn.client_id != client.id:
            raise HTTPException(
                400, "That transaction belongs to a different client."
            )
        name = f"Adjustment of #{reversed_txn.id}"

    t = Transaction(
        client_id=client.id,
        kind="adjustment",
        name=name,
        occurred_on=utc_today(),
        credits_delta=credits_delta,
        dollars_delta=dollars_delta,
        actor_email=user,
        note=note,
        reverses_transaction_id=body.reverses_transaction_id,
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
        out = transaction_dict(existing)
        out["clientName"] = client_name
        return out
    await session.refresh(t)
    out = transaction_dict(t)
    out["clientName"] = client_name
    return out
