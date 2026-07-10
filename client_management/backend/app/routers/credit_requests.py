"""Credit-request approval queue.

Restricted salespeople can't add credits directly (contracts / positive
adjustments are gated). Instead they submit a credit request here; an
approver (Vineet / Shanu / David) approves it, which creates the actual
adjustment via the shared ``insert_adjustment`` path — atomically and
idempotently (the resulting adjustment carries idem_key
``credit_request:{id}``, so a double-approve can't double-credit).
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.config import get_settings
from app.db import get_session
from app.helpers import parse_money, utc_now
from app.models import Client, CreditRequest
from app.routers.adjustments import insert_adjustment
from app.schemas import CreditRequestDecision, CreditRequestIn
from app.scoping import (
    AccessScope,
    require_credit_approver,
    require_scope,
    scoped_client_or_404,
)
from app.serializers import credit_request_dict

settings = get_settings()

router = APIRouter(
    prefix="/api/credit-requests",
    tags=["credit-requests"],
    dependencies=[Depends(require_user)],
)


@router.post("", status_code=status.HTTP_201_CREATED)
async def submit_request(
    body: CreditRequestIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
    scope: AccessScope = Depends(require_scope),
) -> dict:
    """Submit a request to add credits/dollars to a client.

    The requester must be able to see the client (own it, or be
    unrestricted). Amounts are additions only (>= 0, at least one > 0).
    """
    client = await scoped_client_or_404(session, body.client_id or 0, scope)
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(400, "A note explaining the request is required.")
    credits_delta = parse_money(body.credits_delta)
    dollars_delta = parse_money(body.dollars_delta)
    if credits_delta < 0 or dollars_delta < 0:
        raise HTTPException(400, "Credit requests add credits — amounts can't be negative.")
    if credits_delta == 0 and dollars_delta == 0:
        raise HTTPException(400, "Enter a non-zero credits and/or dollars amount.")
    cr = CreditRequest(
        client_id=client.id,
        transaction_id=body.transaction_id,
        credits_delta=credits_delta,
        dollars_delta=dollars_delta,
        note=note,
        status="pending",
        requested_by_email=user,
    )
    session.add(cr)
    await session.commit()
    await session.refresh(cr)
    return credit_request_dict(cr, client)


@router.get("")
async def list_requests(
    request_status: str | None = Query(default=None, alias="status"),
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
    scope: AccessScope = Depends(require_scope),
) -> list[dict]:
    """List credit requests.

    Approvers / admins / full-access see every request (optionally filtered
    by ``status``); everyone else sees only the requests they submitted.
    Newest first, with the client embedded.
    """
    stmt = (
        select(CreditRequest, Client)
        .join(Client, Client.id == CreditRequest.client_id)
        .order_by(CreditRequest.created_at.desc(), CreditRequest.id.desc())
    )
    # Restricted salespeople see only their own requests; everyone
    # unrestricted (admin / approver / full-access) sees the whole queue.
    if scope.restricted:
        stmt = stmt.where(CreditRequest.requested_by_email == user)
    if request_status:
        stmt = stmt.where(CreditRequest.status == request_status)
    rows = (await session.execute(stmt)).all()
    return [credit_request_dict(cr, c) for cr, c in rows]


async def _pending_or_error(
    session: AsyncSession, request_id: int
) -> CreditRequest:
    """Fetch a request FOR UPDATE and require it to be pending."""
    cr = (
        await session.execute(
            select(CreditRequest)
            .where(CreditRequest.id == request_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if cr is None:
        raise HTTPException(404, "Credit request not found.")
    if cr.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This request is already {cr.status}.",
        )
    return cr


@router.post("/{request_id}/approve")
async def approve_request(
    request_id: int,
    body: CreditRequestDecision | None = None,
    session: AsyncSession = Depends(get_session),
    approver: str = Depends(require_credit_approver),
) -> dict:
    """Approve a pending request — creates the adjustment, atomically.

    Locks the row, guards it is still pending, creates the adjustment via
    the shared idempotent path (idem_key ``credit_request:{id}``), then
    flips the request to approved in the same transaction.
    """
    cr = await _pending_or_error(session, request_id)
    client = await session.get(Client, cr.client_id)
    if client is None or client.deleted_at is not None:
        raise HTTPException(400, "That client is no longer active.")
    t = await insert_adjustment(
        session,
        client=client,
        credits_delta=float(cr.credits_delta),
        dollars_delta=float(cr.dollars_delta),
        note=f"Credit request #{cr.id}: {cr.note}",
        actor_email=approver,
        idem_key=f"credit_request:{cr.id}",
    )
    cr.status = "approved"
    cr.decided_by_email = approver
    cr.decided_at = utc_now()
    cr.decision_note = (body.decision_note or "").strip() or None if body else None
    cr.resulting_transaction_id = t.id
    await session.commit()
    await session.refresh(cr)
    return credit_request_dict(cr, client)


@router.post("/{request_id}/reject")
async def reject_request(
    request_id: int,
    body: CreditRequestDecision | None = None,
    session: AsyncSession = Depends(get_session),
    approver: str = Depends(require_credit_approver),
) -> dict:
    """Reject a pending request (no adjustment is created)."""
    cr = await _pending_or_error(session, request_id)
    cr.status = "rejected"
    cr.decided_by_email = approver
    cr.decided_at = utc_now()
    cr.decision_note = (body.decision_note or "").strip() or None if body else None
    await session.commit()
    await session.refresh(cr)
    client = await session.get(Client, cr.client_id)
    return credit_request_dict(cr, client)


@router.post("/{request_id}/cancel")
async def cancel_request(
    request_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
) -> dict:
    """Withdraw one's own pending request."""
    cr = await _pending_or_error(session, request_id)
    if cr.requested_by_email.strip().lower() != user.strip().lower():
        raise HTTPException(403, "You can only cancel your own request.")
    cr.status = "canceled"
    cr.decided_by_email = user
    cr.decided_at = utc_now()
    await session.commit()
    await session.refresh(cr)
    client = await session.get(Client, cr.client_id)
    return credit_request_dict(cr, client)
