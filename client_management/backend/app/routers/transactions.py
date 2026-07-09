"""Single-transaction read endpoint.

The Express edit/delete handlers used ``repo.getTransaction(id)`` to
resolve a transaction's owning client (for redirects) and kind before
acting. This endpoint preserves that lookup so the frontend stays a thin
pass-through.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_session
from app.models import Transaction
from app.serializers import transaction_dict

router = APIRouter(
    prefix="/api/transactions",
    tags=["transactions"],
    dependencies=[Depends(require_user)],
)


@router.get("/{txn_id}")
async def get_transaction(
    txn_id: int, session: AsyncSession = Depends(get_session)
) -> dict:
    """Fetch a single transaction by id.

    Parameters
    ----------
    txn_id : int
        Transaction primary key.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        The serialised transaction (no nested relations).

    Raises
    ------
    HTTPException
        ``404`` if no transaction has the given id.
    """
    t = await session.get(Transaction, txn_id)
    if t is None or t.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found",
        )
    return transaction_dict(t)
