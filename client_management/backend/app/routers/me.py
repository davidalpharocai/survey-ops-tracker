"""Current-identity endpoint — lets the frontend tailor UI to the role.

The backend stays authoritative for access (scoping.py enforces it); this
just tells the UI which actions to show/hide (e.g. hide "Add contract" for a
restricted salesperson, show the Approvals page for an approver).
"""

from fastapi import APIRouter, Depends, Request

from app.auth import require_user
from app.config import get_settings

settings = get_settings()

router = APIRouter(prefix="/api", tags=["me"])


@router.get("/me")
async def me(request: Request, email: str = Depends(require_user)) -> dict:
    """Return the caller's identity + resolved role for UI gating."""
    groups = getattr(request.state, "actor_groups", []) or []
    return {
        "email": email,
        "role": settings.resolve_role(email, groups),
        "isAdmin": settings.is_admin(email, groups),
        "isApprover": settings.is_credit_approver(email, groups),
        "isRestricted": settings.is_restricted(email, groups),
    }
