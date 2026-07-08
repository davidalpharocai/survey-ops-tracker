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
from app.helpers import parse_date
from app.models import Client
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
    if client is None:
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
    stmt = select(Client).order_by(Client.name.asc())
    if want_users:
        stmt = stmt.options(selectinload(Client.users))
    result = await session.execute(stmt)
    clients = result.scalars().all()
    out = []
    for c in clients:
        d = client_dict(c)
        if want_users:
            users = sorted(c.users, key=lambda u: u.name)
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
    dup = await session.execute(select(Client).where(Client.name == name))
    if dup.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A client named '{name}' already exists.",
        )
    client = Client(
        name=name,
        became_client_on=became_client_on,
        primary_contact_name=_clean(body.primary_contact_name),
        primary_contact_cell=_clean(body.primary_contact_cell),
        primary_contact_email=_clean(body.primary_contact_email),
        relationship_manager=_clean(body.relationship_manager),
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
    client.name = new_name
    client.became_client_on = became_client_on
    client.primary_contact_name = _clean(body.primary_contact_name)
    client.primary_contact_cell = _clean(body.primary_contact_cell)
    client.primary_contact_email = _clean(body.primary_contact_email)
    client.relationship_manager = _clean(body.relationship_manager)
    await session.commit()
    await session.refresh(client)
    return client_dict(client)


@router.delete("/{client_id}")
async def delete_client(
    client_id: int, session: AsyncSession = Depends(get_session)
) -> dict:
    """Delete a client; users and transactions cascade via FK.

    Parameters
    ----------
    client_id : int
        Primary key of the client to delete.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"id": int, "name": str}`` so the caller can flash a
        confirmation.

    Raises
    ------
    HTTPException
        ``404`` if no client has the given id.
    """
    client = await _get_or_404(session, client_id)
    name = client.name
    await session.delete(client)
    await session.commit()
    return {"id": client_id, "name": name}
