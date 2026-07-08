"""Request authentication for the internal API.

The Next.js frontend is the only client. It authenticates the human via
Cognito (Hosted UI) and calls this service with:

* ``Authorization: Bearer <id_token>`` — the user's Cognito ID token.
  The backend verifies it against the user pool's JWKS (signature,
  issuer, audience, expiry) and requires membership in the app group.
  The verified ``email`` claim is recorded on writes as ``actor_email``
  / ``created_by_email``.

When Cognito is not configured (local development) the service falls
back to trusting the ``X-User-Email`` header.
"""

import jwt
from fastapi import Depends, Header, HTTPException, Request, status

from app.cognito import verify_id_token
from app.config import get_settings

settings = get_settings()


def _email_from_bearer(authorization: str | None) -> tuple[str, list[str]]:
    """Verify the Cognito ID token and extract the user's email and groups.

    Parameters
    ----------
    authorization : str or None
        Value of the ``Authorization`` header, expected as
        ``Bearer <id_token>``.

    Returns
    -------
    tuple of (str, list of str)
        The lower-cased verified email and the token's
        ``cognito:groups`` list (used downstream to gate admin access).

    Raises
    ------
    HTTPException
        ``401`` if the header is missing/malformed or the token fails
        verification; ``403`` if the user is not in the allowed group.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )
    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = verify_id_token(token)
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        ) from exc

    if str(claims.get("email_verified")).lower() != "true":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email is not verified.",
        )

    groups = list(claims.get("cognito:groups") or [])
    if settings.cognito_allowed_group not in groups:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not a member of the required group.",
        )

    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has no email claim.",
        )
    return email, groups


async def require_user(
    request: Request,
    authorization: str | None = Header(default=None),
    x_user_email: str | None = Header(default=None),
) -> str:
    """Authenticate the calling request and return the acting user email.

    The verified email and the user's Cognito groups are also recorded on
    ``request.state`` (``actor_email`` / ``actor_groups``) so the audit
    middleware can attribute the action and :func:`require_admin` can gate
    admin access without re-verifying the token.

    Parameters
    ----------
    request : Request
        The incoming request; used to stash the resolved identity.
    authorization : str or None
        ``Bearer <id_token>`` carrying the user's Cognito ID token
        (required when Cognito is configured).
    x_user_email : str or None
        End-user email forwarded by the frontend (development fallback
        only, used when Cognito is not configured).

    Returns
    -------
    str
        The lower-cased end-user email, guaranteed to belong to the
        allowed domain.

    Raises
    ------
    HTTPException
        ``401`` for missing/invalid credentials, ``403`` if the user is
        outside the allowed group or Workspace domain.
    """
    if settings.cognito_enabled:
        email, groups = _email_from_bearer(authorization)
    else:
        # X-User-Email is a development-only fallback. In production it
        # must never be trusted, so a misconfigured deploy (Cognito env
        # vars missing) fails closed instead of accepting a raw header.
        if settings.is_production:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication is not configured.",
            )
        if not x_user_email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing X-User-Email header.",
            )
        email = x_user_email.strip().lower()
        # Local dev has no token; treat the dev user as a member of both
        # the app and admin groups so the admin page is reachable.
        groups = [settings.cognito_allowed_group, settings.cognito_admin_group]

    domain = settings.allowed_domain
    if domain and not email.endswith("@" + domain):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access restricted to @{domain} accounts.",
        )

    request.state.actor_email = email
    request.state.actor_groups = groups
    # Mirror onto the raw ASGI scope so the audit middleware (which runs
    # outside request/dependency scope) can read the resolved identity.
    request.scope["audit_actor_email"] = email
    request.scope["audit_actor_groups"] = groups
    return email


async def require_admin(
    request: Request, _email: str = Depends(require_user)
) -> str:
    """Authorize the caller as an audit-log administrator.

    Runs the full :func:`require_user` verification first, then requires
    membership in the configured admin group
    (:attr:`Settings.cognito_admin_group`).

    Parameters
    ----------
    request : Request
        The incoming request; ``request.state.actor_groups`` is read back
        from :func:`require_user`.
    _email : str
        The verified user email (unused here, but its dependency runs the
        authentication side effects).

    Returns
    -------
    str
        The verified admin user's email.

    Raises
    ------
    HTTPException
        ``403`` if the user is not a member of the admin group.
    """
    groups = getattr(request.state, "actor_groups", []) or []
    if settings.cognito_admin_group not in groups:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return _email
