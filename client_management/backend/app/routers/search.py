"""Global search across clients, contracts, studies, and contacts.

Powers the top-bar omnibox. Case-insensitive substring match on names and
the SOCC codes (Cl##### / PR#####) plus contact emails; LIKE metacharacters
are escaped so a literal % or _ matches itself. Archived/soft-deleted rows
are excluded. Results are capped per group.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_session
from app.models import Client, ClientUser, Transaction

router = APIRouter(prefix="/api", tags=["search"], dependencies=[Depends(require_user)])


def _like(q: str) -> str:
    """Build an escaped ``%…%`` LIKE pattern (metacharacters matched literally)."""
    safe = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{safe}%"


@router.get("/search")
async def search(
    q: str = Query(default=""),
    limit: int = Query(default=6),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Grouped search results for the omnibox.

    Parameters
    ----------
    q : str
        Free-text query. Blank yields empty groups.
    limit : int
        Max results per group (clamped to 1..20).
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"clients", "contracts", "studies", "contacts"}`` — each a list
        of light result rows the frontend turns into links.
    """
    query = q.strip()
    if not query:
        return {"clients": [], "contracts": [], "studies": [], "contacts": []}
    like = _like(query)
    lim = max(1, min(limit, 20))

    clients = (
        await session.execute(
            select(Client)
            .where(
                Client.deleted_at.is_(None),
                or_(
                    Client.name.ilike(like, escape="\\"),
                    func.coalesce(Client.socc_code, "").ilike(like, escape="\\"),
                ),
            )
            .order_by(Client.name.asc())
            .limit(lim)
        )
    ).scalars().all()

    async def _txn_group(kind: str) -> list[dict]:
        rows = (
            await session.execute(
                select(Transaction, Client)
                .join(Client, Client.id == Transaction.client_id)
                .where(
                    Transaction.kind == kind,
                    Transaction.deleted_at.is_(None),
                    Client.deleted_at.is_(None),
                    or_(
                        Transaction.name.ilike(like, escape="\\"),
                        func.coalesce(Transaction.socc_project_code, "").ilike(
                            like, escape="\\"
                        ),
                    ),
                )
                .order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
                .limit(lim)
            )
        ).all()
        return [
            {
                "id": t.id,
                "name": t.name,
                "code": t.socc_project_code,
                "clientId": c.id,
                "clientName": c.name,
            }
            for t, c in rows
        ]

    contacts_rows = (
        await session.execute(
            select(ClientUser, Client)
            .join(Client, Client.id == ClientUser.client_id)
            .where(
                ClientUser.deleted_at.is_(None),
                Client.deleted_at.is_(None),
                or_(
                    ClientUser.name.ilike(like, escape="\\"),
                    func.coalesce(ClientUser.email, "").ilike(like, escape="\\"),
                ),
            )
            .order_by(ClientUser.name.asc())
            .limit(lim)
        )
    ).all()

    return {
        "clients": [
            {"id": c.id, "name": c.name, "code": c.socc_code} for c in clients
        ],
        "contracts": await _txn_group("contract"),
        "studies": await _txn_group("study"),
        "contacts": [
            {
                "id": u.id,
                "name": u.name,
                "email": u.email,
                "clientId": c.id,
                "clientName": c.name,
            }
            for u, c in contacts_rows
        ],
    }
