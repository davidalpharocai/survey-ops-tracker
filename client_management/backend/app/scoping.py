"""Per-user data access scoping — the one place read access is narrowed.

A restricted salesperson may see ONLY clients whose ``salesperson_email``
matches their login email; everyone unrestricted (admin / full-access /
approver) sees everything. This is enforced by:

- ``require_scope`` — a dependency (downstream of :func:`require_user`) that
  classifies the caller into an :class:`AccessScope`.
- ``AccessScope.client_filter()`` — a SQLAlchemy clause AND-ed into every
  global list/report/search query so rows (not just columns) are filtered.
- ``scoped_client_or_404`` — the drop-in replacement for every per-client
  ``_get_or_404`` guard; it returns 404 (never 403) so a restricted user
  can't even confirm a client exists.

Scope is always derived from the server-verified identity, never a
client-supplied value, so it can't be widened by a crafted request (subject
to the identity-trust caveat: under Basic Auth the email is self-asserted;
Cognito makes it un-bypassable — see the permissions design spec).
"""

from dataclasses import dataclass

import sqlalchemy as sa
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.config import get_settings
from app.models import Client

settings = get_settings()


@dataclass
class AccessScope:
    """The resolved data-access scope for one request."""

    email: str
    role: str  # admin | approver | full_access | restricted
    restricted: bool

    def client_filter(self):
        """SQLAlchemy clause selecting the clients this caller may see.

        ``sa.true()`` for unrestricted callers; otherwise the caller's own
        clients (case-insensitive salesperson-email match). AND this into
        any query that selects or joins :class:`~app.models.Client`.
        """
        if not self.restricted:
            return sa.true()
        return sa.func.lower(Client.salesperson_email) == self.email

    def owns(self, client: Client) -> bool:
        """Whether the caller may see a specific already-fetched client."""
        if not self.restricted:
            return True
        owner = (client.salesperson_email or "").strip().lower()
        return owner != "" and owner == self.email

    def owned_client_ids_subq(self):
        """Scalar subquery of client ids this caller may see.

        For tables filtered by ``client_id`` without joining Client
        (e.g. transactions, client_users).
        """
        return select(Client.id).where(self.client_filter())


async def require_scope(
    request: Request, email: str = Depends(require_user)
) -> AccessScope:
    """Resolve the caller's :class:`AccessScope` from the verified identity.

    Reads the groups stashed by :func:`require_user`; no database hit.
    """
    groups = getattr(request.state, "actor_groups", []) or []
    role = settings.resolve_role(email, groups)
    return AccessScope(email=email, role=role, restricted=(role == "restricted"))


async def require_unrestricted(
    scope: AccessScope = Depends(require_scope),
) -> AccessScope:
    """Gate credit-adding writes (contracts, positive adjustments).

    A restricted salesperson may not add credits directly — they submit a
    credit request to the approval queue instead. Admin / full-access /
    approver pass through.
    """
    if scope.restricted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Adding credits requires approval — submit a credit request instead.",
        )
    return scope


async def require_credit_approver(
    request: Request, email: str = Depends(require_user)
) -> str:
    """Authorize the caller to approve/reject credit requests.

    Admins and configured credit approvers (Vineet / Shanu / David) only.
    """
    groups = getattr(request.state, "actor_groups", []) or []
    if not (
        settings.is_admin(email, groups)
        or settings.is_credit_approver(email, groups)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a credit approver can decide requests.",
        )
    return email


async def scoped_client_or_404(
    session: AsyncSession, client_id: int, scope: AccessScope
) -> Client:
    """Fetch an active client the caller is allowed to see, or raise 404.

    Returns 404 (not 403) for both nonexistent/archived clients and clients
    the restricted caller doesn't own, so existence is never disclosed.
    """
    client = await session.get(Client, client_id)
    if client is None or client.deleted_at is not None or not scope.owns(client):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Client not found"
        )
    return client
