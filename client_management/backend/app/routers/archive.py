"""Admin endpoints for listing and restoring archived (soft-deleted) rows.

Nothing in this app is ever destroyed: DELETE endpoints only stamp
``deleted_at``. This router gives admins the other half of that promise —
a view of everything archived, and a way to bring records back.

Restore semantics
-----------------
Archiving a client stamps ``deleted_at`` on the *client row only* — its
contacts and transactions are never individually stamped (see
``clients.delete_client``); they merely become invisible because every
read path either joins on the active parent or is reached through the
client's now-404 pages. Restoring a client therefore makes those children
visible again automatically. Children that were archived *individually*
(their own ``deleted_at`` set) stay archived until restored one by one.

Conversely, a contact or transaction cannot be restored while its owning
client is still archived — that would "restore" it into an invisible
state — so those requests are rejected with a 409 telling the admin to
restore the client first.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.db import get_session
from app.helpers import utc_now
from app.models import Client, ClientUser, Transaction

router = APIRouter(
    prefix="/api/admin/archive",
    tags=["archive"],
    dependencies=[Depends(require_admin)],
)

# Cap each archived list; the page is a recovery tool, not a browser.
_LIST_CAP = 200

_TYPES = ("client", "user", "transaction")


class RestoreIn(BaseModel):
    """Restore payload: which kind of record, and its id."""

    type: str = ""
    id: int = 0


def _iso(dt: datetime | None) -> str | None:
    """Render a datetime as a UTC ISO-8601 string.

    Parameters
    ----------
    dt : datetime or None
        Value to render.

    Returns
    -------
    str or None
        ISO-8601 string ending in ``Z``, or ``None``.
    """
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "") + "Z"


@router.get("")
async def list_archived(
    session: AsyncSession = Depends(get_session),
) -> dict:
    """List every archived client, contact, and transaction.

    Newest-archived first, capped at 200 rows per list. Contacts and
    transactions carry ``clientName`` (joined through the owning client,
    archived or not) so the admin can tell whose they were.

    Parameters
    ----------
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"clients": [...], "users": [...], "transactions": [...]}`` —
        each row has ``id``, ``name``, ``deletedAt`` and
        ``updatedByEmail`` (who archived it); the latter two lists add
        ``clientName``.
    """
    clients = (
        await session.execute(
            select(Client)
            .where(Client.deleted_at.is_not(None))
            .order_by(Client.deleted_at.desc(), Client.id.desc())
            .limit(_LIST_CAP)
        )
    ).scalars().all()

    users = (
        await session.execute(
            select(ClientUser, Client.name)
            .join(Client, Client.id == ClientUser.client_id)
            .where(ClientUser.deleted_at.is_not(None))
            .order_by(ClientUser.deleted_at.desc(), ClientUser.id.desc())
            .limit(_LIST_CAP)
        )
    ).all()

    transactions = (
        await session.execute(
            select(Transaction, Client.name)
            .join(Client, Client.id == Transaction.client_id)
            .where(Transaction.deleted_at.is_not(None))
            .order_by(Transaction.deleted_at.desc(), Transaction.id.desc())
            .limit(_LIST_CAP)
        )
    ).all()

    return {
        "clients": [
            {
                "id": c.id,
                "name": c.name,
                "deletedAt": _iso(c.deleted_at),
                "updatedByEmail": c.updated_by_email,
            }
            for c in clients
        ],
        "users": [
            {
                "id": u.id,
                "name": u.name,
                "deletedAt": _iso(u.deleted_at),
                "updatedByEmail": u.updated_by_email,
                "clientName": client_name,
            }
            for u, client_name in users
        ],
        "transactions": [
            {
                "id": t.id,
                "name": t.name,
                "kind": t.kind,
                "deletedAt": _iso(t.deleted_at),
                "updatedByEmail": t.updated_by_email,
                "clientName": client_name,
            }
            for t, client_name in transactions
        ],
    }


@router.post("/restore")
async def restore_archived(
    body: RestoreIn,
    session: AsyncSession = Depends(get_session),
    admin: str = Depends(require_admin),
) -> dict:
    """Un-archive a client, contact, or transaction.

    Clears ``deleted_at`` and stamps the caller as the editor. A contact
    or transaction whose owning client is still archived cannot be
    restored (409) — restore the client first. Restoring a client does
    NOT touch its children's ``deleted_at``: children hidden by the
    client's archive were never individually stamped, so they become
    visible again on their own; individually-archived children stay
    archived until restored here themselves.

    Parameters
    ----------
    body : RestoreIn
        ``{"type": "client"|"user"|"transaction", "id": int}``.
    session : AsyncSession
        Injected request-scoped database session.
    admin : str
        Authenticated admin (recorded as ``updated_by_email``).

    Returns
    -------
    dict
        ``{"type": str, "id": int, "name": str}`` for the caller's flash.

    Raises
    ------
    HTTPException
        ``400`` for an unknown type, ``404`` when the record does not
        exist or is not archived, ``409`` when the owning client is still
        archived (or an active client already uses a restored client's
        name).
    """
    kind = (body.type or "").strip().lower()
    if kind not in _TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="type must be one of: client, user, transaction.",
        )

    model = {"client": Client, "user": ClientUser, "transaction": Transaction}[
        kind
    ]
    row = await session.get(model, body.id)
    if row is None or row.deleted_at is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No archived {kind} with id {body.id}.",
        )

    if kind == "client":
        # The active-name partial unique index would reject the restore if
        # the name was reused; surface that as a clear 409 instead.
        clash = await session.execute(
            select(Client).where(
                Client.name == row.name,
                Client.deleted_at.is_(None),
                Client.id != row.id,
            )
        )
        if clash.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"An active client named '{row.name}' already exists. "
                    "Rename it before restoring this one."
                ),
            )
    else:
        owner = await session.get(Client, row.client_id)
        if owner is None or owner.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"This {kind}'s client "
                    f"{'(' + owner.name + ') ' if owner else ''}"
                    "is archived. Restore the client first."
                ),
            )

    row.deleted_at = None
    row.updated_by_email = admin
    row.updated_at = utc_now()
    await session.commit()
    return {"type": kind, "id": row.id, "name": row.name}
