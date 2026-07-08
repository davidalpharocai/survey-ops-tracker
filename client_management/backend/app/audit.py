"""Audit logging for write requests.

Every mutating request (``POST``/``PATCH``/``DELETE``) — and every denied
attempt at one — is recorded as a single structured JSON line on stdout.
On AWS those lines land in the function's CloudWatch log group, where a
subscription filter (``{ $.audit = true }``) ships them through Kinesis
Firehose to S3, which Athena queries for the admin triage page. Nothing
is written to the application database.

The capture is implemented as a pure ASGI middleware (rather than
Starlette's ``BaseHTTPMiddleware``) so the request body can be read for
the audit record and then replayed to the downstream handler without the
body-consumption pitfalls of the streaming base class. Emission is
best-effort: any failure is swallowed so auditing can never break the
user's request.
"""

import json
import time
from datetime import datetime, timezone

# Methods that mutate state and are therefore audited. Reads are skipped.
AUDIT_METHODS = {"POST", "PATCH", "DELETE", "PUT"}

# Map the HTTP verb to a human-friendly action for triage.
_ACTION = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}

# REST path segments that name an action rather than a resource.
_ACTIONS = {"mark-reviewed", "bulk-update"}

# Cap on the captured request body (bytes). Larger bodies are recorded as
# truncated so a single huge upload can't bloat the audit stream.
_BODY_CAP = 8192


def _resource_from_path(path: str) -> tuple[str | None, str | None]:
    """Derive the primary resource type and id from a request path.

    Walks the ``/api/...`` segments and returns the last
    collection/identifier pair, e.g. ``/api/clients/5`` →
    ``("clients", "5")`` and ``/api/clients/5/users`` →
    ``("users", None)`` (the created sub-resource).

    Parameters
    ----------
    path : str
        The request path.

    Returns
    -------
    tuple of (str or None, str or None)
        ``(resource_type, resource_id)``; either element may be ``None``.
    """
    parts = [p for p in path.split("/") if p]
    if parts and parts[0] == "api":
        parts = parts[1:]
    resource_type: str | None = None
    resource_id: str | None = None
    for seg in parts:
        if seg.isdigit():
            resource_id = seg
        elif seg in _ACTIONS:
            continue
        else:
            resource_type = seg
            resource_id = None
    return resource_type, resource_id


def _templated(path: str) -> str:
    """Return the path with numeric id segments replaced by ``{id}``.

    Parameters
    ----------
    path : str
        The concrete request path.

    Returns
    -------
    str
        A templated route, e.g. ``/api/clients/{id}``.
    """
    return "/".join("{id}" if seg.isdigit() else seg for seg in path.split("/"))


def _outcome(status_code: int) -> str:
    """Classify a status code for triage.

    Parameters
    ----------
    status_code : int
        The HTTP response status.

    Returns
    -------
    str
        ``"success"`` (<400), ``"denied"`` (401/403) or ``"error"``.
    """
    if status_code < 400:
        return "success"
    if status_code in (401, 403):
        return "denied"
    return "error"


def _client_ip(headers: dict[str, str], scope: dict) -> str | None:
    """Best-effort client IP from forwarding headers or the ASGI scope.

    Parameters
    ----------
    headers : dict of str to str
        Lower-cased request headers.
    scope : dict
        The ASGI connection scope.

    Returns
    -------
    str or None
        The originating client IP, if it can be determined.
    """
    fwd = headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    client = scope.get("client")
    if client:
        return client[0]
    return None


def _body_json(body: bytes, headers: dict[str, str]) -> str | None:
    """Capture a request body as a compact JSON string for the record.

    Stored as a string (not a nested object) so the downstream Glue/
    Athena schema needs only a single ``string`` column regardless of the
    body's shape.

    Parameters
    ----------
    body : bytes
        The raw request body.
    headers : dict of str to str
        Lower-cased request headers (used to check the content type).

    Returns
    -------
    str or None
        A JSON string of the parsed body, ``None`` when empty, or a small
        marker object when the body is too large or not JSON.
    """
    if not body:
        return None
    if len(body) > _BODY_CAP:
        return json.dumps({"_truncated": True, "_bytes": len(body)})
    if "application/json" not in headers.get("content-type", ""):
        return json.dumps({"_unparsed": True})
    try:
        return json.dumps(json.loads(body))
    except (ValueError, UnicodeDecodeError):
        return json.dumps({"_unparsed": True})


def _emit(scope: dict, body: bytes, status_code: int, duration_ms: int) -> None:
    """Print one structured audit record for a completed write request.

    Parameters
    ----------
    scope : dict
        The ASGI connection scope (carries the resolved actor identity
        under ``audit_actor_email``, set by ``require_user``).
    body : bytes
        The captured request body.
    status_code : int
        The HTTP response status.
    duration_ms : int
        Wall-clock handling time in milliseconds.
    """
    headers = {
        k.decode("latin-1").lower(): v.decode("latin-1")
        for k, v in scope.get("headers", [])
    }
    path = scope.get("path", "")
    method = scope.get("method", "")
    resource_type, resource_id = _resource_from_path(path)
    record = {
        "audit": True,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "actor_email": scope.get("audit_actor_email"),
        "method": method,
        "path": path,
        "route": _templated(path),
        "resource_type": resource_type,
        "resource_id": resource_id,
        "action": _ACTION.get(method),
        "status_code": status_code,
        "outcome": _outcome(status_code),
        "duration_ms": duration_ms,
        "ip_address": _client_ip(headers, scope),
        "user_agent": headers.get("user-agent"),
        "request_body": _body_json(body, headers),
    }
    print(json.dumps(record, default=str), flush=True)


class AuditMiddleware:
    """ASGI middleware that emits a structured audit line per write.

    Parameters
    ----------
    app : ASGI application
        The downstream application to wrap.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive, send) -> None:
        """Capture the request, run the app, and emit the audit record.

        Parameters
        ----------
        scope : dict
            The ASGI connection scope.
        receive : callable
            The ASGI receive channel.
        send : callable
            The ASGI send channel.
        """
        if scope.get("type") != "http" or scope.get("method") not in AUDIT_METHODS:
            await self.app(scope, receive, send)
            return

        # Buffer the full request body so it can be both audited and
        # replayed to the handler. All requests here carry small JSON.
        chunks: list[bytes] = []
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.request":
                chunks.append(message.get("body", b""))
                more = message.get("more_body", False)
            else:  # http.disconnect
                break
        body = b"".join(chunks)

        replayed = False

        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        status_code = 500

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        start = time.monotonic()
        try:
            await self.app(scope, replay, send_wrapper)
        finally:
            duration_ms = int((time.monotonic() - start) * 1000)
            try:
                _emit(scope, body, status_code, duration_ms)
            except Exception:  # noqa: BLE001 — auditing must never break a request
                pass
