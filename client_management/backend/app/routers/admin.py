"""Admin endpoints for querying the audit log.

The audit trail lives in S3 (delivered from CloudWatch via Kinesis
Firehose) and is queried through Amazon Athena over a Glue table. These
endpoints are gated by :func:`app.auth.require_admin` (membership in the
``ccm-admins`` Cognito group). In local development Athena is not
configured, so the endpoints return an empty result set.

Queries are bounded by the ``dt`` partition (event date) to keep the
amount of data scanned — and therefore cost and latency — small, and use
Athena execution parameters for all user-supplied filter values so the
SQL itself is never string-interpolated with caller input.
"""

import time
from datetime import date, datetime, timedelta, timezone

import boto3
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import require_admin
from app.config import get_settings

settings = get_settings()

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)

# Columns selected, in order, and the camelCase keys returned to the UI.
_COLUMNS = [
    ("occurred_at", "occurredAt"),
    ("actor_email", "actorEmail"),
    ("method", "method"),
    ("path", "path"),
    ("route", "route"),
    ("resource_type", "resourceType"),
    ("resource_id", "resourceId"),
    ("action", "action"),
    ("status_code", "statusCode"),
    ("outcome", "outcome"),
    ("duration_ms", "durationMs"),
    ("ip_address", "ipAddress"),
    ("user_agent", "userAgent"),
    ("request_body", "requestBody"),
]
_INT_KEYS = {"statusCode", "durationMs"}

# Polling budget for an Athena query, comfortably inside the Lambda
# timeout. Queries over a small partition range finish in 1–3s.
_POLL_TIMEOUT_S = 25
_POLL_INTERVAL_S = 0.5


def _escape_like(value: str) -> str:
    """Escape LIKE special characters so user input is treated as literal text.

    Parameters
    ----------
    value : str
        Raw user-supplied substring.

    Returns
    -------
    str
        The value with ``\\``, ``%``, and ``_`` escaped for a LIKE clause
        that uses ``\\`` as the escape character.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _athena():
    """Return a boto3 Athena client for the configured region.

    Returns
    -------
    botocore.client.BaseClient
        An Athena client. Created per call; cheap and avoids holding a
        client across Lambda freezes.
    """
    return boto3.client("athena", region_name=settings.aws_region)


def _valid_date(value: str | None) -> date | None:
    """Parse a ``YYYY-MM-DD`` string into a date.

    Parameters
    ----------
    value : str or None
        The candidate date string.

    Returns
    -------
    date or None
        The parsed date, or ``None`` if ``value`` is falsy.

    Raises
    ------
    HTTPException
        ``400`` if the string is present but not a valid date.
    """
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid date: {value!r} (expected YYYY-MM-DD).",
        ) from exc


def _build_query(
    actor: str | None,
    action: str | None,
    resource_type: str | None,
    statuscode: int | None,
    outcome: str | None,
    q: str | None,
    date_from: date,
    date_to: date,
    limit: int,
) -> tuple[str, list[str]]:
    """Build the Athena SQL and its execution parameters.

    Parameters
    ----------
    actor, action, resource_type, outcome, q : str or None
        Optional equality / substring filters.
    statuscode : int or None
        Optional exact HTTP status filter.
    date_from, date_to : date
        Inclusive ``dt`` partition bounds (event date).
    limit : int
        Row cap (already validated).

    Returns
    -------
    tuple of (str, list of str)
        The parameterized SQL and the positional parameter values.
    """
    select_cols = ", ".join(name for name, _ in _COLUMNS)
    # Inline the date bounds as string literals rather than ? parameters.
    # Athena's partition projection (type=date) infers ? as a date/integer
    # and then fails to compare it against the varchar dt column.
    # date.isoformat() is always YYYY-MM-DD so this is safe to embed.
    where = [f"dt >= '{date_from.isoformat()}'", f"dt <= '{date_to.isoformat()}'"]
    params: list[str] = []
    if actor:
        where.append("actor_email = ?")
        params.append(actor.strip().lower())
    if action:
        where.append("action = ?")
        params.append(action)
    if resource_type:
        where.append("resource_type = ?")
        params.append(resource_type)
    if statuscode is not None:
        where.append("status_code = ?")
        params.append(str(statuscode))
    if outcome:
        where.append("outcome = ?")
        params.append(outcome)
    if q:
        safe = _escape_like(q)
        where.append("(path LIKE ? ESCAPE '\\' OR actor_email LIKE ? ESCAPE '\\')")
        params.extend([f"%{safe}%", f"%{safe}%"])
    sql = (
        f"SELECT {select_cols} "
        f'FROM "{settings.athena_database}"."{settings.athena_table}" '
        f"WHERE {' AND '.join(where)} "
        f"ORDER BY occurred_at DESC "
        f"LIMIT {limit}"
    )
    return sql, params


def _run_query(sql: str, params: list[str]) -> str:
    """Start an Athena query and wait for it to finish.

    Parameters
    ----------
    sql : str
        The parameterized query.
    params : list of str
        Positional execution-parameter values.

    Returns
    -------
    str
        The completed query execution id.

    Raises
    ------
    HTTPException
        ``502`` if the query fails, is cancelled, or times out.
    """
    client = _athena()
    kwargs = {
        "QueryString": sql,
        "QueryExecutionContext": {"Database": settings.athena_database},
        "WorkGroup": settings.athena_workgroup,
        "ResultConfiguration": {"OutputLocation": settings.audit_s3_output},
    }
    if params:
        kwargs["ExecutionParameters"] = params
    query_id = client.start_query_execution(**kwargs)["QueryExecutionId"]

    deadline = time.monotonic() + _POLL_TIMEOUT_S
    while True:
        info = client.get_query_execution(QueryExecutionId=query_id)
        state = info["QueryExecution"]["Status"]["State"]
        if state == "SUCCEEDED":
            return query_id
        if state in ("FAILED", "CANCELLED"):
            reason = info["QueryExecution"]["Status"].get(
                "StateChangeReason", "unknown error"
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Audit query {state.lower()}: {reason}",
            )
        if time.monotonic() > deadline:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Audit query timed out.",
            )
        time.sleep(_POLL_INTERVAL_S)


def _fetch_page(
    query_id: str, next_token: str | None
) -> tuple[list[dict], str | None]:
    """Read one page of results for a completed query.

    Parameters
    ----------
    query_id : str
        The completed query execution id.
    next_token : str or None
        Pagination token from a previous page, if any.

    Returns
    -------
    tuple of (list of dict, str or None)
        The mapped rows (camelCase) and the next pagination token.
    """
    client = _athena()
    kwargs = {"QueryExecutionId": query_id, "MaxResults": 100}
    if next_token:
        kwargs["NextToken"] = next_token
    result = client.get_query_results(**kwargs)
    rows = result["ResultSet"]["Rows"]
    # The very first page repeats the column names as its first data row.
    if not next_token and rows:
        rows = rows[1:]
    out = []
    for row in rows:
        data = row.get("Data", [])
        record: dict = {}
        for (_, key), cell in zip(_COLUMNS, data):
            value = cell.get("VarCharValue")
            if value is not None and key in _INT_KEYS:
                try:
                    value = int(value)
                except ValueError:
                    pass
            record[key] = value
        out.append(record)
    return out, result.get("NextToken")


@router.get("/audit-logs")
def list_audit_logs(
    actor: str | None = Query(default=None),
    action: str | None = Query(default=None),
    resource_type: str | None = Query(default=None),
    status_code: int | None = Query(default=None),
    outcome: str | None = Query(default=None),
    q: str | None = Query(default=None),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    limit: int = Query(default=100, ge=1, le=500),
    query_id: str | None = Query(default=None, alias="queryId"),
    next_token: str | None = Query(default=None, alias="nextToken"),
) -> dict:
    """Query the audit log with optional filters and pagination.

    Defined as a synchronous endpoint so FastAPI runs the blocking boto3
    calls in a worker thread rather than on the event loop.

    Parameters
    ----------
    actor, action, resource_type, outcome, q : str or None
        Optional filters (q is a substring match on path/actor).
    status_code : int or None
        Optional exact HTTP status filter.
    date_from, date_to : str or None
        Inclusive ``YYYY-MM-DD`` event-date bounds; default the last 7 days.
    limit : int
        Row cap, 1–500 (default 100).
    query_id, next_token : str or None
        Supplied together to fetch the next page of an earlier query
        instead of running a new one.

    Returns
    -------
    dict
        ``{"rows": [...], "queryId": str | None, "nextToken": str | None}``.
        Empty when Athena is not configured (local development).
    """
    if not settings.athena_enabled:
        return {"rows": [], "queryId": None, "nextToken": None, "athena": False}

    # Continue paginating an existing query without re-scanning S3.
    # Verify the execution belongs to our workgroup before reading results
    # (prevents an admin from reading another query's output via IDOR).
    if query_id and next_token:
        exec_info = _athena().get_query_execution(QueryExecutionId=query_id)
        if exec_info["QueryExecution"].get("WorkGroup") != settings.athena_workgroup:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid query ID.",
            )
        rows, token = _fetch_page(query_id, next_token)
        return {"rows": rows, "queryId": query_id, "nextToken": token}

    today = datetime.now(timezone.utc).date()
    df = _valid_date(date_from) or (today - timedelta(days=7))
    dt = _valid_date(date_to) or today
    if df > dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="'from' date must not be after 'to' date.",
        )

    sql, params = _build_query(
        actor, action, resource_type, status_code, outcome, q, df, dt, limit
    )
    new_query_id = _run_query(sql, params)
    rows, token = _fetch_page(new_query_id, None)
    return {"rows": rows, "queryId": new_query_id, "nextToken": token}
