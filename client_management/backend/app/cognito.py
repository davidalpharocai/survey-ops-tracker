"""Cognito ID-token verification.

The frontend forwards the end user's Cognito **ID token** in the
``Authorization: Bearer`` header. This module verifies that token
against the user pool's published JWKS — signature, issuer, audience,
expiry and ``token_use`` — so the backend trusts a cryptographically
verifiable identity rather than an unauthenticated header.

When ``COGNITO_JWKS_JSON`` is set the keys are read from that env var
(no outbound network call). This is needed when the Lambda runs inside a
private VPC without internet access. Update the env var if Cognito
rotates its signing keys (rare; announced in advance).
"""

import json
from typing import Any

import jwt
from jwt import PyJWK, PyJWKClient

from app.config import get_settings

settings = get_settings()

_jwks_client: PyJWKClient | None = None
_static_keys: dict[str, Any] | None = None


def _get_signing_key(token: str) -> Any:
    """Return the RSA public key that signed *token*.

    Parameters
    ----------
    token : str
        Raw JWT string; only the header is decoded (unverified) to read
        the ``kid`` claim and select the correct key.

    Returns
    -------
    Any
        The public key object accepted by :func:`jwt.decode`.

    Raises
    ------
    jwt.InvalidTokenError
        If the key id is not found in the JWKS.
    """
    global _jwks_client, _static_keys

    if settings.cognito_jwks_json:
        if _static_keys is None:
            keys_data = json.loads(settings.cognito_jwks_json)["keys"]
            _static_keys = {k["kid"]: PyJWK(k).key for k in keys_data}
        kid = jwt.get_unverified_header(token).get("kid", "")
        if kid not in _static_keys:
            raise jwt.InvalidTokenError(f"Unknown signing key id: {kid}")
        return _static_keys[kid]

    # Fallback: fetch JWKS from URL (works outside private VPC)
    if _jwks_client is None:
        url = settings.cognito_jwks_url or f"{settings.cognito_issuer}/.well-known/jwks.json"
        _jwks_client = PyJWKClient(url)
    return _jwks_client.get_signing_key_from_jwt(token).key


def verify_id_token(token: str) -> dict:
    """Verify a Cognito ID token and return its claims.

    Parameters
    ----------
    token : str
        The raw JWT string from the ``Authorization: Bearer`` header.

    Returns
    -------
    dict
        The decoded, verified token claims.

    Raises
    ------
    jwt.InvalidTokenError
        If the signature, issuer, audience, expiry or ``token_use`` is
        invalid (subclasses cover the specific failure modes).
    """
    signing_key = _get_signing_key(token)
    claims = jwt.decode(
        token,
        signing_key,
        algorithms=["RS256"],
        audience=settings.cognito_app_client_id,
        issuer=settings.cognito_issuer,
        options={"require": ["exp", "iss", "aud"]},
    )
    if claims.get("token_use") != "id":
        raise jwt.InvalidTokenError("Not an ID token.")
    return claims
