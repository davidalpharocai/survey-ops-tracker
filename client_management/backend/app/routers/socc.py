"""CCM <- SOCC one-way status sync (manual, file-based).

The admin uploads a SOCC export; the frontend parses its Projects tab and
POSTs {pr_code, board_column, ...} rows here. We match each on the shared
PR##### code to a study and record its SOCC board column (status only —
credits/dollars are never touched). Projects with no matching study come
back in `unmatched` for reconciliation.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.db import get_session
from app.helpers import utc_now
from app.models import Client, Transaction
from app.schemas import SoccSyncIn

router = APIRouter(
    prefix="/api/admin", tags=["socc"], dependencies=[Depends(require_admin)]
)


@router.post("/socc-sync")
async def socc_sync(
    body: SoccSyncIn,
    session: AsyncSession = Depends(get_session),
    admin: str = Depends(require_admin),
) -> dict:
    """Apply SOCC board-column statuses to matching surveys.

    Returns
    -------
    dict
        ``{"matched": [...], "unmatched": [...], "matchedCount",
        "unmatchedCount"}``. Each matched row names the updated survey +
        client; each unmatched row echoes the SOCC project for review.
    """
    now = utc_now()
    matched: list[dict] = []
    unmatched: list[dict] = []
    seen: set[str] = set()

    for u in body.updates:
        code = (u.pr_code or "").strip()
        board = (u.board_column or "").strip()
        if not code or code in seen:
            continue
        seen.add(code)
        rows = (
            await session.execute(
                select(Transaction, Client)
                .join(Client, Client.id == Transaction.client_id)
                .where(
                    Transaction.kind == "study",
                    Transaction.deleted_at.is_(None),
                    Transaction.socc_project_code == code,
                )
            )
        ).all()
        if not rows:
            unmatched.append(
                {
                    "prCode": code,
                    "boardColumn": board,
                    "projectName": (u.project_name or "").strip(),
                    "clientName": (u.client_name or "").strip(),
                }
            )
            continue
        for t, c in rows:
            t.socc_board_column = board or None
            t.socc_synced_at = now
            t.updated_by_email = admin
            t.updated_at = now
            matched.append(
                {
                    "prCode": code,
                    "studyId": t.id,
                    "name": t.name,
                    "boardColumn": board,
                    "clientId": c.id,
                    "clientName": c.name,
                }
            )

    await session.commit()
    return {
        "matched": matched,
        "unmatched": unmatched,
        "matchedCount": len(matched),
        "unmatchedCount": len(unmatched),
    }
