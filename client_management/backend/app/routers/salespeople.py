"""Salesperson (account owner) CRUD endpoints.

Salespeople are a small standalone list a client is assigned to. Assignment
is purely a filter/label — it never restricts who can see a client. When a
salesperson's name/email changes we propagate the denormalized snapshot to
every client that points at them so the dashboard's "my clients" default
stays correct for their whole book.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.db import get_session
from app.helpers import utc_now
from app.models import Client, Salesperson
from app.schemas import SalespersonIn
from app.serializers import salesperson_dict

router = APIRouter(
    prefix="/api/salespeople",
    tags=["salespeople"],
    dependencies=[Depends(require_user)],
)


def _clean(v: str | None) -> str | None:
    """Trim a string, mapping empty/whitespace to ``None``."""
    if v is None:
        return None
    v = v.strip()
    return v or None


def _clean_email(v: str | None) -> str | None:
    """Trim + lowercase an email, mapping blank to ``None``."""
    v = _clean(v)
    return v.lower() if v is not None else None


async def _active_by_name(
    session: AsyncSession, name: str
) -> Salesperson | None:
    """Return the active salesperson with this name (case-insensitive)."""
    return (
        await session.execute(
            select(Salesperson).where(
                func.lower(Salesperson.name) == name.lower(),
                Salesperson.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()


@router.get("")
async def list_salespeople(
    include: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """List salespeople, ascending by name.

    By default returns only active (non-archived) salespeople for the
    picker. ``?include=all`` also returns archived ones for the roster.
    """
    stmt = select(Salesperson).order_by(Salesperson.name.asc())
    if include != "all":
        stmt = stmt.where(
            Salesperson.deleted_at.is_(None), Salesperson.active.is_(True)
        )
    result = await session.execute(stmt)
    return [salesperson_dict(s) for s in result.scalars().all()]


@router.post("")
async def create_salesperson(
    body: SalespersonIn,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Create a salesperson (idempotent by active name).

    If an active salesperson already has this name, return it instead of
    erroring — so the client form's "add new" is safe to retry and never
    creates duplicates.

    Raises
    ------
    HTTPException
        ``400`` if the name is blank.
    """
    name = _clean(body.name)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Salesperson name is required.",
        )
    existing = await _active_by_name(session, name)
    if existing is not None:
        # Idempotent: fill in an email if one was supplied and it was blank.
        email = _clean_email(body.email)
        if email is not None and existing.email is None:
            existing.email = email
            await _propagate_snapshot(session, existing)
            await session.commit()
            await session.refresh(existing)
        return salesperson_dict(existing)
    sp = Salesperson(name=name, email=_clean_email(body.email), active=True)
    session.add(sp)
    try:
        await session.commit()
    except IntegrityError:
        # Race on salespeople_name_active_key: a concurrent request created
        # this active name first. Return its row rather than 500-ing, keeping
        # "add new" idempotent (mirrors contracts/adjustments routers).
        await session.rollback()
        existing = await _active_by_name(session, name)
        if existing is not None:
            return salesperson_dict(existing)
        raise
    await session.refresh(sp)
    return salesperson_dict(sp)


async def _propagate_snapshot(session: AsyncSession, sp: Salesperson) -> None:
    """Push a salesperson's name/email onto every client that points at it.

    Keeps the denormalized ``clients.salesperson_name/email`` snapshot (and
    the legacy ``relationship_manager`` mirror) in sync so "my clients"
    filtering works for the rep's whole book after an edit. Flushed with the
    caller's transaction.
    """
    await session.execute(
        update(Client)
        .where(Client.salesperson_id == sp.id)
        .values(
            salesperson_name=sp.name,
            salesperson_email=sp.email,
            relationship_manager=sp.name,
        )
    )


@router.patch("/{salesperson_id}")
async def update_salesperson(
    salesperson_id: int,
    body: SalespersonIn,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Edit a salesperson's name/email/active flag.

    A name or email change propagates to every client assigned to this
    salesperson (see :func:`_propagate_snapshot`).

    Raises
    ------
    HTTPException
        ``404`` if absent, ``400`` if the new name is blank, ``409`` if the
        new name collides with another active salesperson.
    """
    sp = await session.get(Salesperson, salesperson_id)
    if sp is None or sp.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesperson not found",
        )
    new_name = _clean(body.name)
    if not new_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Salesperson name is required.",
        )
    if new_name.lower() != sp.name.lower():
        clash = await session.execute(
            select(Salesperson).where(
                func.lower(Salesperson.name) == new_name.lower(),
                Salesperson.id != salesperson_id,
                Salesperson.deleted_at.is_(None),
            )
        )
        if clash.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Another salesperson is already named '{new_name}'.",
            )
    sp.name = new_name
    # Only overwrite the email when the caller actually sent the field, so a
    # PATCH that omits it (e.g. a rename) doesn't blank it and propagate an
    # empty email to every linked client, breaking their "my clients".
    if "email" in body.model_fields_set:
        sp.email = _clean_email(body.email)
    if body.active is not None:
        sp.active = body.active
    await _propagate_snapshot(session, sp)
    await session.commit()
    await session.refresh(sp)
    return salesperson_dict(sp)


@router.delete("/{salesperson_id}")
async def delete_salesperson(
    salesperson_id: int,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Archive a salesperson (soft delete).

    Removes them from the picker. Clients keep their snapshot so history
    still reads correctly; they can be reassigned on the client form.

    Raises
    ------
    HTTPException
        ``404`` if no salesperson has the given id.
    """
    sp = await session.get(Salesperson, salesperson_id)
    if sp is None or sp.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesperson not found",
        )
    sp.active = False
    sp.deleted_at = utc_now()
    await session.commit()
    return {"id": salesperson_id, "name": sp.name}
