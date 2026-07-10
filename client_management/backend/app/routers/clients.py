"""Client CRUD endpoints.

All client mutations and the validation that used to live in the Express
routes (name required, name uniqueness) are authoritative here.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_user
from app.db import get_session
from app.helpers import parse_date, utc_now
from app.models import Client, Salesperson
from app.schemas import ClientIn
from app.serializers import client_dict, client_user_dict

router = APIRouter(
    prefix="/api/clients",
    tags=["clients"],
    dependencies=[Depends(require_user)],
)


def _clean(v: str | None) -> str | None:
    """Trim a string, mapping empty/whitespace to ``None``.

    Parameters
    ----------
    v : str or None
        Raw form value.

    Returns
    -------
    str or None
        Trimmed value, or ``None`` when blank.
    """
    if v is None:
        return None
    v = v.strip()
    return v or None


async def _resolve_salesperson(
    session: AsyncSession, salesperson_id: int | None
) -> Salesperson | None:
    """Look up an active salesperson by id, or raise ``400``.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    salesperson_id : int or None
        Chosen salesperson; ``None`` means "not provided" (import/legacy).

    Returns
    -------
    Salesperson or None
        The salesperson, or ``None`` when no id was provided.

    Raises
    ------
    HTTPException
        ``400`` if an id was provided but no active salesperson matches.
    """
    if salesperson_id is None:
        return None
    sp = await session.get(Salesperson, salesperson_id)
    if sp is None or sp.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected salesperson was not found.",
        )
    return sp


async def _get_or_404(session: AsyncSession, client_id: int) -> Client:
    """Fetch a client by id or raise ``404``.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    client_id : int
        Primary key to look up.

    Returns
    -------
    Client
        The matching client.

    Raises
    ------
    HTTPException
        ``404`` when no client has the given id.
    """
    client = await session.get(Client, client_id)
    if client is None or client.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Client not found"
        )
    return client


@router.get("")
async def list_clients(
    include: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """List all clients ascending by name.

    Parameters
    ----------
    include : str or None
        When ``"users"``, embed each client's users as ``users``
        (ascending by name), matching ``listClientsWithUsers``.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    list of dict
        Serialised clients.
    """
    want_users = include == "users"
    stmt = (
        select(Client)
        .where(Client.deleted_at.is_(None))
        .order_by(Client.name.asc())
    )
    if want_users:
        stmt = stmt.options(selectinload(Client.users))
    result = await session.execute(stmt)
    clients = result.scalars().all()
    out = []
    for c in clients:
        d = client_dict(c)
        if want_users:
            users = sorted(
                (u for u in c.users if u.deleted_at is None),
                key=lambda u: u.name,
            )
            d["users"] = [client_user_dict(u) for u in users]
        out.append(d)
    return out


@router.get("/{client_id}")
async def get_client(
    client_id: int, session: AsyncSession = Depends(get_session)
) -> dict:
    """Fetch a single client by id.

    Parameters
    ----------
    client_id : int
        Primary key of the client.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        The serialised client.

    Raises
    ------
    HTTPException
        ``404`` if no client has the given id.
    """
    return client_dict(await _get_or_404(session, client_id))


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_client(
    body: ClientIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
) -> dict:
    """Create a client.

    Parameters
    ----------
    body : ClientIn
        Client form payload.
    session : AsyncSession
        Injected request-scoped database session.
    user : str
        Authenticated acting user (recorded as ``created_by_email``).

    Returns
    -------
    dict
        The created client.

    Raises
    ------
    HTTPException
        ``400`` if the name is blank, ``409`` if the name is taken.
    """
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Client name is required.",
        )
    became_client_on = parse_date(body.became_on)
    if became_client_on is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A 'became a client' date is required.",
        )
    # Case-insensitive so "Acme" can't be created alongside "acme"
    # (matches the update path, which already compares lower()).
    dup = await session.execute(
        select(Client).where(
            func.lower(Client.name) == name.lower(),
            Client.deleted_at.is_(None),
        )
    )
    if dup.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A client named '{name}' already exists.",
        )
    socc_code = _clean(body.socc_code)
    if socc_code is not None:
        clash = await session.execute(
            select(Client).where(Client.socc_code == socc_code)
        )
        if clash.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Client code '{socc_code}' is already in use.",
            )
    sp = await _resolve_salesperson(session, body.salesperson_id)
    client = Client(
        name=name,
        socc_code=socc_code,
        became_client_on=became_client_on,
        primary_contact_name=_clean(body.primary_contact_name),
        primary_contact_cell=_clean(body.primary_contact_cell),
        primary_contact_email=_clean(body.primary_contact_email),
        # A chosen salesperson takes precedence and mirrors into the legacy
        # relationship_manager column; otherwise fall back to whatever the
        # (import/legacy) caller supplied.
        relationship_manager=(sp.name if sp else _clean(body.relationship_manager)),
        salesperson_id=(sp.id if sp else None),
        salesperson_name=(sp.name if sp else None),
        salesperson_email=(sp.email if sp else None),
        created_by_email=user,
    )
    session.add(client)
    await session.commit()
    await session.refresh(client)
    return client_dict(client)


@router.patch("/{client_id}")
async def update_client(
    client_id: int,
    body: ClientIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
) -> dict:
    """Update a client.

    Parameters
    ----------
    client_id : int
        Primary key of the client to update.
    body : ClientIn
        Client form payload.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        The updated client.

    Raises
    ------
    HTTPException
        ``404`` if absent, ``400`` if the name is blank, ``409`` if the
        new name collides with another client.
    """
    client = await _get_or_404(session, client_id)
    new_name = (body.name or "").strip()
    if not new_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Client name is required.",
        )
    if new_name.lower() != client.name.lower():
        clash = await session.execute(
            select(Client).where(
                func.lower(Client.name) == new_name.lower(),
                Client.id != client_id,
                Client.deleted_at.is_(None),
            )
        )
        if clash.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Another client is already named '{new_name}'.",
            )
    became_client_on = parse_date(body.became_on)
    if became_client_on is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A 'became a client' date is required.",
        )
    socc_code = _clean(body.socc_code)
    if socc_code is not None and socc_code != client.socc_code:
        clash = await session.execute(
            select(Client).where(
                Client.socc_code == socc_code, Client.id != client_id
            )
        )
        if clash.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Client code '{socc_code}' is already in use.",
            )
    sp = await _resolve_salesperson(session, body.salesperson_id)
    client.name = new_name
    if socc_code is not None:  # only overwrite when a code was supplied
        client.socc_code = socc_code
    client.became_client_on = became_client_on
    client.primary_contact_name = _clean(body.primary_contact_name)
    client.primary_contact_cell = _clean(body.primary_contact_cell)
    client.primary_contact_email = _clean(body.primary_contact_email)
    if sp is not None:
        # Form path: the chosen salesperson drives the snapshot + the
        # legacy relationship_manager mirror.
        client.salesperson_id = sp.id
        client.salesperson_name = sp.name
        client.salesperson_email = sp.email
        client.relationship_manager = sp.name
    else:
        # No salesperson supplied (import/legacy caller): leave the existing
        # assignment intact and only update the free-text mirror.
        client.relationship_manager = _clean(body.relationship_manager)
    client.updated_by_email = user
    client.updated_at = utc_now()
    await session.commit()
    await session.refresh(client)
    return client_dict(client)


@router.delete("/{client_id}")
async def delete_client(
    client_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
) -> dict:
    """Archive a client (soft delete) — its ledger is never destroyed.

    Sets ``deleted_at`` instead of removing the row, so the client
    disappears from every list/picker while all its contracts, studies
    and contacts stay intact and recoverable. Replaces the old hard
    delete, which cascade-wiped the client's entire financial history.

    Parameters
    ----------
    client_id : int
        Primary key of the client to archive.
    session : AsyncSession
        Injected request-scoped database session.
    user : str
        Authenticated acting user (recorded as ``updated_by_email``).

    Returns
    -------
    dict
        ``{"id": int, "name": str}`` so the caller can flash a
        confirmation.

    Raises
    ------
    HTTPException
        ``404`` if no client has the given id (or it is already archived).
    """
    client = await _get_or_404(session, client_id)
    client.deleted_at = utc_now()
    client.updated_by_email = user
    client.updated_at = utc_now()
    await session.commit()
    return {"id": client_id, "name": client.name}
