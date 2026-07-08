"""Team-member (internal user) administration via Cognito.

Admin-only. Governs who can sign into the app: it creates/enables users
in the Cognito user pool and toggles membership in the admin group.

Requires the backend's execution role to hold the ``cognito-idp:Admin*``
and ``ListUsersInGroup`` permissions on the pool. When Cognito is not
configured (local development) the endpoints report ``configured: false``
so the UI shows the manual runbook instead of failing.

Access is always restricted to ``@{ALLOWED_DOMAIN}`` emails; invites for
any other domain are rejected.

boto3 calls are blocking, so the handlers are sync ``def`` — FastAPI runs
them in a threadpool and the event loop is never blocked.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth import require_admin
from app.config import get_settings

settings = get_settings()

router = APIRouter(prefix="/api/admin/team", tags=["team"])


class InviteIn(BaseModel):
    """Invite payload: an @alpharoc.ai email and whether they're an admin."""

    email: str = ""
    is_admin: bool = False


class SetAdminIn(BaseModel):
    """Toggle admin-group membership for an existing member."""

    email: str = ""
    is_admin: bool = False


class SetEnabledIn(BaseModel):
    """Enable or disable (revoke access for) an existing member."""

    email: str = ""
    enabled: bool = True


def _cognito():
    """Return a cognito-idp client for the configured region."""
    import boto3

    return boto3.client("cognito-idp", region_name=settings.cognito_region)


def _require_configured() -> None:
    """403-equivalent guard: the pool must be configured to manage users."""
    if not settings.cognito_user_pool_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cognito is not configured in this environment.",
        )


def _validate_domain(email: str) -> str:
    """Lower-case and domain-check an email, or raise 400."""
    e = (email or "").strip().lower()
    if not e or "@" not in e:
        raise HTTPException(400, "A valid email is required.")
    if settings.allowed_domain and not e.endswith("@" + settings.allowed_domain):
        raise HTTPException(400, f"Only @{settings.allowed_domain} emails are allowed.")
    return e


def _emails_in_group(client, group: str) -> set[str]:
    """Collect the lower-cased emails of every user in a Cognito group."""
    emails: set[str] = set()
    token: str | None = None
    while True:
        kwargs = {"UserPoolId": settings.cognito_user_pool_id, "GroupName": group, "Limit": 60}
        if token:
            kwargs["NextToken"] = token
        resp = client.list_users_in_group(**kwargs)
        for u in resp.get("Users", []):
            attr = {a["Name"]: a["Value"] for a in u.get("Attributes", [])}
            if attr.get("email"):
                emails.add(attr["email"].lower())
        token = resp.get("NextToken")
        if not token:
            break
    return emails


@router.get("")
def list_team(_: str = Depends(require_admin)) -> dict:
    """List internal users, marking admins and always-admin allow-list emails.

    Returns
    -------
    dict
        ``configured`` flag, the ``CCM_ADMIN_EMAILS`` allow-list, the group
        names, and (when configured) a ``members`` list with email, status,
        enabled and admin flags.
    """
    allow = sorted(settings.admin_email_set)
    base = {
        "configured": bool(settings.cognito_user_pool_id),
        "allowlistAdmins": allow,
        "allowedGroup": settings.cognito_allowed_group,
        "adminGroup": settings.cognito_admin_group,
        "allowedDomain": settings.allowed_domain,
        "members": [],
    }
    if not settings.cognito_user_pool_id:
        return base

    client = _cognito()
    try:
        admin_emails = _emails_in_group(client, settings.cognito_admin_group)
        members = []
        token: str | None = None
        while True:
            kwargs = {"UserPoolId": settings.cognito_user_pool_id, "Limit": 60}
            if token:
                kwargs["PaginationToken"] = token
            resp = client.list_users(**kwargs)
            for u in resp.get("Users", []):
                attr = {a["Name"]: a["Value"] for a in u.get("Attributes", [])}
                email = (attr.get("email") or "").lower()
                if not email:
                    continue
                members.append({
                    "email": email,
                    "status": u.get("UserStatus"),
                    "enabled": u.get("Enabled", True),
                    "isAdmin": email in admin_emails or email in settings.admin_email_set,
                    "adminSource": "allowlist" if email in settings.admin_email_set
                        else ("group" if email in admin_emails else None),
                    "createdAt": u.get("UserCreateDate").isoformat() if u.get("UserCreateDate") else None,
                })
            token = resp.get("PaginationToken")
            if not token:
                break
        members.sort(key=lambda m: m["email"])
        base["members"] = members
    except Exception as exc:  # noqa: BLE001 — surface the AWS error to the admin
        raise HTTPException(502, f"Cognito query failed: {exc}") from exc
    return base


@router.post("", status_code=status.HTTP_201_CREATED)
def invite_member(body: InviteIn, _: str = Depends(require_admin)) -> dict:
    """Invite a new @alpharoc.ai user (Cognito emails them a temp password)."""
    email = _validate_domain(body.email)
    _require_configured()
    client = _cognito()
    try:
        client.admin_create_user(
            UserPoolId=settings.cognito_user_pool_id,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
            ],
            DesiredDeliveryMediums=["EMAIL"],
        )
        client.admin_add_user_to_group(
            UserPoolId=settings.cognito_user_pool_id,
            Username=email,
            GroupName=settings.cognito_allowed_group,
        )
        if body.is_admin:
            client.admin_add_user_to_group(
                UserPoolId=settings.cognito_user_pool_id,
                Username=email,
                GroupName=settings.cognito_admin_group,
            )
    except client.exceptions.UsernameExistsException as exc:
        raise HTTPException(409, f"{email} is already a member.") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Cognito invite failed: {exc}") from exc
    return {"email": email, "isAdmin": body.is_admin}


@router.post("/set-admin")
def set_admin(body: SetAdminIn, _: str = Depends(require_admin)) -> dict:
    """Grant or revoke admin-group membership for an existing member."""
    email = _validate_domain(body.email)
    _require_configured()
    client = _cognito()
    try:
        if body.is_admin:
            client.admin_add_user_to_group(
                UserPoolId=settings.cognito_user_pool_id,
                Username=email,
                GroupName=settings.cognito_admin_group,
            )
        else:
            client.admin_remove_user_from_group(
                UserPoolId=settings.cognito_user_pool_id,
                Username=email,
                GroupName=settings.cognito_admin_group,
            )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Cognito update failed: {exc}") from exc
    return {"email": email, "isAdmin": body.is_admin}


@router.post("/set-enabled")
def set_enabled(body: SetEnabledIn, _: str = Depends(require_admin)) -> dict:
    """Enable or disable a member (disable = revoke sign-in access)."""
    email = _validate_domain(body.email)
    _require_configured()
    client = _cognito()
    try:
        if body.enabled:
            client.admin_enable_user(UserPoolId=settings.cognito_user_pool_id, Username=email)
        else:
            client.admin_disable_user(UserPoolId=settings.cognito_user_pool_id, Username=email)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Cognito update failed: {exc}") from exc
    return {"email": email, "enabled": body.enabled}
