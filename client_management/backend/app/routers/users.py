"""Client-user CRUD endpoints.

Covers the inline user management on the Manage Client List page and the
flat, filterable Manage User List. The "can't delete a user still
attributed to transactions" guard is enforced here.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_user
from app.db import get_session
from app.helpers import utc_now
from app.models import Client, ClientUser, Transaction, TransactionUser
from app.schemas import ClientUserIn
from app.scoping import AccessScope, require_scope, scoped_client_or_404
from app.serializers import client_dict, client_user_dict, transaction_dict

router = APIRouter(tags=["users"], dependencies=[Depends(require_user)])


async def _user_or_404(session: AsyncSession, user_id: int) -> ClientUser:
    """Fetch a client user by id or raise ``404``.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    user_id : int
        Primary key to look up.

    Returns
    -------
    ClientUser
        The matching client user.

    Raises
    ------
    HTTPException
        ``404`` when no user has the given id.
    """
    user = await session.get(ClientUser, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


@router.get("/api/clients/{client_id}/users")
async def list_client_users(
    client_id: int,
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> list[dict]:
    """List a client's users ascending by name.

    Parameters
    ----------
    client_id : int
        Owning client.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    list of dict
        Serialised client users.
    """
    await scoped_client_or_404(session, client_id, scope)
    result = await session.execute(
        select(ClientUser)
        .where(
            ClientUser.client_id == client_id,
            ClientUser.deleted_at.is_(None),
        )
        .order_by(ClientUser.name.asc())
    )
    return [client_user_dict(u) for u in result.scalars().all()]


@router.post(
    "/api/clients/{client_id}/users", status_code=status.HTTP_201_CREATED
)
async def create_client_user(
    client_id: int,
    body: ClientUserIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
    scope: AccessScope = Depends(require_scope),
) -> dict:
    """Add a user to a client.

    Parameters
    ----------
    client_id : int
        Owning client.
    body : ClientUserIn
        User form payload.
    session : AsyncSession
        Injected request-scoped database session.
    user : str
        Authenticated acting user (recorded as ``created_by_email``).

    Returns
    -------
    dict
        The created client user.

    Raises
    ------
    HTTPException
        ``404`` if the client is absent, ``400`` if the name is blank.
    """
    await scoped_client_or_404(session, client_id, scope)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User name is required.",
        )
    email = (body.email or "").strip() or None
    cu = ClientUser(
        client_id=client_id,
        name=name,
        email=email,
        created_by_email=user,
    )
    session.add(cu)
    await session.commit()
    await session.refresh(cu)
    return client_user_dict(cu)


@router.get("/api/users")
async def list_users_filtered(
    client_id: int | None = Query(default=None),
    q: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> list[dict]:
    """Flat user list with the parent client embedded as ``client``.

    Parameters
    ----------
    client_id : int or None
        Restrict to one client.
    q : str or None
        Case-insensitive substring matched against name or email
        (LIKE metacharacters are escaped to match literally).
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    list of dict
        Serialised users, each with a nested ``client``.
    """
    stmt = (
        select(ClientUser, Client)
        .join(Client, Client.id == ClientUser.client_id)
        .where(
            ClientUser.deleted_at.is_(None),
            Client.deleted_at.is_(None),
            scope.client_filter(),
        )
        .order_by(Client.name.asc(), ClientUser.name.asc())
    )
    if client_id:
        stmt = stmt.where(ClientUser.client_id == client_id)
    if q:
        # Escape LIKE metacharacters so a literal % or _ typed in the
        # search box matches itself instead of acting as a wildcard, and
        # match case-insensitively (a user searching "acme" expects
        # "Acme Corp").
        safe = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{safe}%"
        stmt = stmt.where(
            or_(
                ClientUser.name.ilike(like, escape="\\"),
                ClientUser.email.ilike(like, escape="\\"),
            )
        )
    result = await session.execute(stmt)
    rows = []
    for cu, client in result.all():
        d = client_user_dict(cu)
        d["client"] = client_dict(client)
        rows.append(d)
    return rows


@router.get("/api/users/{user_id}")
async def get_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> dict:
    """Fetch a single client user by id.

    Parameters
    ----------
    user_id : int
        Primary key of the user.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        The serialised client user.

    Raises
    ------
    HTTPException
        ``404`` if absent or the caller can't see the owning client.
    """
    cu = await _user_or_404(session, user_id)
    await scoped_client_or_404(session, cu.client_id, scope)
    return client_user_dict(cu)


@router.get("/api/users/{user_id}/studies")
async def user_studies(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> dict:
    """Every survey a contact is attributed to, newest first.

    Attribution is the union of the modern many-to-many
    (``transaction_users``) and the legacy single ``client_user_id``
    column, so no study is missed regardless of how it was recorded.

    Parameters
    ----------
    user_id : int
        The contact.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"contact": {...}, "client": {...}, "studies": [...]}`` — the
        contact, their owning client, and the attributed studies.

    Raises
    ------
    HTTPException
        ``404`` if the contact does not exist (or is archived).
    """
    cu = await _user_or_404(session, user_id)
    client = await scoped_client_or_404(session, cu.client_id, scope)
    attributed = select(TransactionUser.transaction_id).where(
        TransactionUser.client_user_id == user_id
    )
    result = await session.execute(
        select(Transaction)
        .where(
            Transaction.kind == "study",
            Transaction.deleted_at.is_(None),
            or_(
                Transaction.id.in_(attributed),
                Transaction.client_user_id == user_id,
            ),
        )
        .order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
        .options(selectinload(Transaction.client_user))
    )
    studies = result.scalars().all()
    return {
        "contact": client_user_dict(cu),
        "client": client_dict(client) if client else None,
        "studies": [transaction_dict(s, with_client_user=True) for s in studies],
    }


@router.patch("/api/users/{user_id}")
async def update_user(
    user_id: int,
    body: ClientUserIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
    scope: AccessScope = Depends(require_scope),
) -> dict:
    """Update a client user's name/email.

    Parameters
    ----------
    user_id : int
        Primary key of the user to update.
    body : ClientUserIn
        User form payload.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        The updated client user (includes ``clientId`` for redirects).

    Raises
    ------
    HTTPException
        ``404`` if absent, ``400`` if the name is blank.
    """
    cu = await _user_or_404(session, user_id)
    await scoped_client_or_404(session, cu.client_id, scope)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User name is required.",
        )
    cu.name = name
    cu.email = (body.email or "").strip() or None
    cu.updated_by_email = user
    cu.updated_at = utc_now()
    await session.commit()
    await session.refresh(cu)
    return client_user_dict(cu)


@router.delete("/api/users/{user_id}")
async def delete_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
    scope: AccessScope = Depends(require_scope),
) -> dict:
    """Archive a client user (soft delete), unless still attributed.

    Parameters
    ----------
    user_id : int
        Primary key of the user to delete.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"clientId": int, "name": str}`` so the caller can redirect
        and flash a confirmation.

    Raises
    ------
    HTTPException
        ``404`` if absent, ``409`` if the user is still attributed to
        one or more transactions (legacy ``client_user_id`` column).
    """
    cu = await _user_or_404(session, user_id)
    await scoped_client_or_404(session, cu.client_id, scope)
    count = await session.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(
            Transaction.client_user_id == user_id,
            Transaction.deleted_at.is_(None),
        )
    )
    if count and count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Can't delete '{cu.name}' — attributed to {count} "
                "transaction(s). Reassign or void those first."
            ),
        )
    cu.deleted_at = utc_now()
    cu.updated_by_email = user
    cu.updated_at = utc_now()
    await session.commit()
    return {"clientId": cu.client_id, "name": cu.name}
