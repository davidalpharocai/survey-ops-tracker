"""Study transaction endpoints.

Studies subtract from a client's balances on exactly one currency
column; setup cost is folded into the credits side. This module owns the
study cost arithmetic, multi-user attribution, the CSV-import review
flag, single-row save, and bulk save — all ported faithfully from the
former Express routes.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_user
from app.db import get_session
from app.helpers import utc_now
from app.models import Client, ClientUser, Transaction, TransactionUser
from app.schemas import StudyBulkUpdateIn, StudyIn
from app.serializers import transaction_dict
from app.study_logic import StudyForm, decorate_study, read_study_form

router = APIRouter(
    prefix="/api",
    tags=["studies"],
    dependencies=[Depends(require_user)],
)


async def _study_or_404(
    session: AsyncSession, txn_id: int
) -> Transaction:
    """Fetch a study transaction (with attributions) or raise ``404``.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    txn_id : int
        Transaction primary key.

    Returns
    -------
    Transaction
        The matching study, with ``users`` eagerly loaded.

    Raises
    ------
    HTTPException
        ``404`` if absent or not of kind ``study``.
    """
    result = await session.execute(
        select(Transaction)
        .where(Transaction.id == txn_id)
        .options(selectinload(Transaction.users))
    )
    t = result.scalar_one_or_none()
    if t is None or t.kind != "study" or t.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Study not found"
        )
    return t


async def _validate_users(
    session: AsyncSession, user_ids: list[int], client_id: int
) -> list[ClientUser] | None:
    """Resolve study users, requiring every id to belong to the client.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    user_ids : list of int
        Requested attribution ids.
    client_id : int
        Client the study belongs to.

    Returns
    -------
    list of ClientUser or None
        The users (ascending by id) when every id resolves to this
        client, otherwise ``None`` (mirrors ``validateStudyUsers``).
    """
    if not user_ids:
        return None
    result = await session.execute(
        select(ClientUser)
        .where(
            ClientUser.id.in_(user_ids),
            ClientUser.client_id == client_id,
        )
        .order_by(ClientUser.id.asc())
    )
    found = list(result.scalars().all())
    if len(found) != len(user_ids):
        return None
    return found


def _check_common(f: StudyForm) -> None:
    """Apply the validations shared by create/update/bulk.

    Parameters
    ----------
    f : StudyForm
        Parsed study form.

    Raises
    ------
    HTTPException
        ``400`` with the same messages the Express routes flashed.
    """
    if not f.name:
        raise HTTPException(400, "Study name is required.")
    if f.occurred_on is None:
        raise HTTPException(400, "Study date is required.")
    if f.annual_total < 0:
        raise HTTPException(400, "Cost cannot be negative.")
    if not f.user_ids:
        raise HTTPException(
            400, "Pick at least one user this study belongs to."
        )


async def _set_attributions(
    session: AsyncSession, txn_id: int, user_ids: list[int]
) -> None:
    """Replace a transaction's user attribution set.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    txn_id : int
        Transaction whose attributions are replaced.
    user_ids : list of int
        New attribution ids (deduplicated; idempotent).
    """
    existing = await session.execute(
        select(TransactionUser).where(
            TransactionUser.transaction_id == txn_id
        )
    )
    for row in existing.scalars().all():
        await session.delete(row)
    await session.flush()
    for uid in dict.fromkeys(user_ids):
        session.add(
            TransactionUser(transaction_id=txn_id, client_user_id=uid)
        )


@router.get("/clients/{client_id}/studies")
async def list_studies(
    client_id: int, session: AsyncSession = Depends(get_session)
) -> list[dict]:
    """List a client's studies, decorated and back-filled.

    Newest first. Each row carries the derived economics from
    ``decorateStudy``; rows with no modern attribution but a legacy
    ``clientUserId`` are back-filled from it so the page works even if
    the one-off migration has not run.

    Parameters
    ----------
    client_id : int
        Owning client.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    list of dict
        Decorated study transactions.
    """
    result = await session.execute(
        select(Transaction)
        .where(
            Transaction.client_id == client_id,
            Transaction.kind == "study",
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
        .options(
            selectinload(Transaction.users).selectinload(
                TransactionUser.client_user
            )
        )
    )
    studies = result.scalars().all()

    cu_result = await session.execute(
        select(ClientUser).where(ClientUser.client_id == client_id)
    )
    users_by_id = {u.id: u for u in cu_result.scalars().all()}

    out = []
    for t in studies:
        raw = transaction_dict(t, with_users=True)
        decorated = decorate_study(raw)
        if not decorated["userIds"] and decorated.get("clientUserId"):
            legacy = users_by_id.get(decorated["clientUserId"])
            decorated["userIds"] = [decorated["clientUserId"]]
            if legacy is not None:
                decorated["userObjs"] = [
                    {
                        "id": legacy.id,
                        "clientId": legacy.client_id,
                        "name": legacy.name,
                        "email": legacy.email,
                    }
                ]
        out.append(decorated)
    return out


@router.post("/studies", status_code=status.HTTP_201_CREATED)
async def create_study(
    body: StudyIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
) -> dict:
    """Publish a new study for a client.

    Parameters
    ----------
    body : StudyIn
        Study form payload (includes ``client_id``).
    session : AsyncSession
        Injected request-scoped database session.
    user : str
        Authenticated acting user (recorded as ``actor_email``).

    Returns
    -------
    dict
        The created study plus ``clientName`` for the caller's flash.

    Raises
    ------
    HTTPException
        ``404`` if the client is absent, ``400`` if validation fails.
    """
    client = await session.get(Client, body.client_id or 0)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Client not found"
        )
    f = read_study_form(body)
    _check_common(f)
    users = await _validate_users(session, f.user_ids, client.id)
    if users is None:
        raise HTTPException(400, "Pick users that belong to this client.")

    credits_annual = f.annual_total if f.cost_type == "credits" else 0.0
    dollars_annual = f.annual_total if f.cost_type == "dollars" else 0.0
    t = Transaction(
        client_id=client.id,
        kind="study",
        name=f.name,
        socc_project_code=(body.socc_project_code or "").strip() or None,
        occurred_on=f.occurred_on,
        credits_delta=-(f.setup_cost + credits_annual),
        dollars_delta=-dollars_annual,
        cadence=f.cadence,
        cost_per_run=f.per_run if f.cadence else None,
        setup_cost=f.setup_cost if f.cadence else None,
        client_user_id=users[0].id,
        actor_email=user,
    )
    session.add(t)
    await session.flush()
    await _set_attributions(session, t.id, [u.id for u in users])
    await session.commit()
    await session.refresh(t)
    out = transaction_dict(t)
    out["clientName"] = client.name
    return out


@router.patch("/studies/{txn_id}")
async def update_study(
    txn_id: int,
    body: StudyIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
) -> dict:
    """Update a single study.

    Parameters
    ----------
    txn_id : int
        Study transaction id.
    body : StudyIn
        Study form payload.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        The updated study.

    Raises
    ------
    HTTPException
        ``404`` if absent/not a study, ``400`` if validation fails.
    """
    t = await _study_or_404(session, txn_id)
    f = read_study_form(body)
    _check_common(f)
    users = await _validate_users(session, f.user_ids, t.client_id)
    if users is None:
        raise HTTPException(400, "Pick users that belong to this client.")

    # Clear the CSV-import "needs review" note once a real cost is set.
    note = t.note
    if f.annual_total > 0 and note and "Imported from CSV" in note:
        note = None

    await _set_attributions(session, t.id, [u.id for u in users])
    credits_annual = f.annual_total if f.cost_type == "credits" else 0.0
    dollars_annual = f.annual_total if f.cost_type == "dollars" else 0.0
    t.name = f.name
    t.occurred_on = f.occurred_on
    t.credits_delta = -(f.setup_cost + credits_annual)
    t.dollars_delta = -dollars_annual
    t.cadence = f.cadence
    t.cost_per_run = f.per_run if f.cadence else None
    t.setup_cost = f.setup_cost if f.cadence else None
    t.client_user_id = users[0].id
    t.note = note
    if body.socc_project_code is not None:
        t.socc_project_code = (body.socc_project_code or "").strip() or None
    t.updated_by_email = user
    t.updated_at = utc_now()
    await session.commit()
    await session.refresh(t)
    return transaction_dict(t)


@router.delete("/studies/{txn_id}")
async def delete_study(
    txn_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
) -> dict:
    """Archive a study (soft delete) — its history is preserved.

    Parameters
    ----------
    txn_id : int
        Study transaction id.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"clientId": int, "name": str}`` for the caller's redirect.

    Raises
    ------
    HTTPException
        ``404`` if absent or not a study.
    """
    t = await _study_or_404(session, txn_id)
    t.deleted_at = utc_now()
    t.updated_by_email = user
    t.updated_at = utc_now()
    await session.commit()
    return {"clientId": t.client_id, "name": t.name}


@router.post("/studies/{txn_id}/mark-reviewed")
async def mark_reviewed(
    txn_id: int, session: AsyncSession = Depends(get_session)
) -> dict:
    """Clear the CSV-import note without changing cost.

    Parameters
    ----------
    txn_id : int
        Study transaction id.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"clientId": int, "name": str}`` for the caller's redirect.

    Raises
    ------
    HTTPException
        ``404`` if absent or not a study.
    """
    t = await _study_or_404(session, txn_id)
    if t.note and "Imported from CSV" in t.note:
        t.note = None
    await session.commit()
    return {"clientId": t.client_id, "name": t.name}


@router.post("/studies/bulk-update")
async def bulk_update(
    body: StudyBulkUpdateIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
) -> dict:
    """Save every row of the existing-studies table in one shot.

    Per-row failures are collected (not fatal) so a partial save still
    succeeds, mirroring the Express bulk handler.

    Parameters
    ----------
    body : StudyBulkUpdateIn
        ``client_id`` plus a map of study id → form payload.
    session : AsyncSession
        Injected request-scoped database session.

    Returns
    -------
    dict
        ``{"updated": int, "errors": list[str]}``.
    """
    client_id = body.client_id
    updated = 0
    errors: list[str] = []

    for sid, st in body.studies.items():
        t = await session.get(Transaction, sid)
        if (
            t is None
            or t.kind != "study"
            or t.client_id != client_id
            or t.deleted_at is not None
        ):
            errors.append(f"#{sid}: not found")
            continue
        f = read_study_form(st)
        if not f.name:
            errors.append(f"'{st.name or sid}': name required")
            continue
        if f.occurred_on is None:
            errors.append(f"'{f.name}': date required")
            continue
        if f.annual_total < 0:
            errors.append(f"'{f.name}': cost cannot be negative")
            continue
        if not f.user_ids:
            errors.append(f"'{f.name}': pick at least one user")
            continue
        users = await _validate_users(session, f.user_ids, client_id)
        if users is None:
            errors.append(f"'{f.name}': invalid users")
            continue

        note = t.note
        if f.annual_total > 0 and note and "Imported from CSV" in note:
            note = None

        await _set_attributions(session, t.id, [u.id for u in users])
        credits_annual = f.annual_total if f.cost_type == "credits" else 0.0
        dollars_annual = f.annual_total if f.cost_type == "dollars" else 0.0
        t.name = f.name
        t.occurred_on = f.occurred_on
        t.credits_delta = -(f.setup_cost + credits_annual)
        t.dollars_delta = -dollars_annual
        t.cadence = f.cadence
        t.cost_per_run = f.per_run if f.cadence else None
        t.setup_cost = f.setup_cost if f.cadence else None
        t.client_user_id = users[0].id
        t.note = note
        t.updated_by_email = user
        t.updated_at = utc_now()
        updated += 1

    await session.commit()
    return {"updated": updated, "errors": errors}
