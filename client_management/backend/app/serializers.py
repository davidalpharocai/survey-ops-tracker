"""ORM → camelCase JSON serializers.

The Express templates were written against the shapes the old SQL
``repo.js`` returned (camelCase keys, nested ``clientUser`` / ``users`` /
``client``). Returning the same shapes here means the EJS views and the
frontend route code need no structural changes — only the data source
moves.

Timestamps are emitted as ISO-8601 UTC strings; the frontend revives
them into ``Date`` objects so the existing formatters keep working.
"""

from datetime import datetime
from decimal import Decimal

from app.models import Client, ClientUser, Transaction


def _iso(dt: datetime | None) -> str | None:
    """Render a datetime as a UTC ISO-8601 string.

    Parameters
    ----------
    dt : datetime or None
        Value to render.

    Returns
    -------
    str or None
        ISO-8601 string ending in ``Z``, or ``None``.
    """
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "") + "Z"


def _num(v: Decimal | float | None) -> float | None:
    """Coerce a numeric column to a float for JSON.

    Parameters
    ----------
    v : Decimal or float or None
        Value to coerce.

    Returns
    -------
    float or None
        The value as a float, or ``None``.
    """
    return None if v is None else float(v)


def client_dict(c: Client) -> dict:
    """Serialise a :class:`~app.models.Client`.

    Parameters
    ----------
    c : Client
        Client row.

    Returns
    -------
    dict
        camelCase representation matching the legacy ``repo.js`` shape.
    """
    return {
        "id": c.id,
        "name": c.name,
        "soccCode": c.socc_code,
        "becameClientOn": _iso(c.became_client_on),
        "primaryContactName": c.primary_contact_name,
        "primaryContactCell": c.primary_contact_cell,
        "primaryContactEmail": c.primary_contact_email,
        "relationshipManager": c.relationship_manager,
        "createdByEmail": c.created_by_email,
        "createdAt": _iso(c.created_at),
    }


def client_user_dict(u: ClientUser) -> dict:
    """Serialise a :class:`~app.models.ClientUser`.

    Parameters
    ----------
    u : ClientUser
        Client-user row.

    Returns
    -------
    dict
        camelCase representation matching the legacy ``repo.js`` shape.
    """
    return {
        "id": u.id,
        "clientId": u.client_id,
        "name": u.name,
        "email": u.email,
        "createdByEmail": u.created_by_email,
        "createdAt": _iso(u.created_at),
    }


def transaction_dict(
    t: Transaction,
    *,
    with_client_user: bool = False,
    with_users: bool = False,
) -> dict:
    """Serialise a :class:`~app.models.Transaction`.

    Parameters
    ----------
    t : Transaction
        Transaction row.
    with_client_user : bool, optional
        Include the legacy single ``clientUser`` object (or ``None``).
    with_users : bool, optional
        Include the full ``users`` attribution set, each entry shaped
        ``{"clientUserId": int, "clientUser": {...}}``.

    Returns
    -------
    dict
        camelCase representation matching the legacy ``repo.js`` shape.
    """
    out = {
        "id": t.id,
        "clientId": t.client_id,
        "kind": t.kind,
        "name": t.name,
        "occurredOn": _iso(t.occurred_on),
        "renewalOn": _iso(t.renewal_on),
        "creditsDelta": _num(t.credits_delta),
        "dollarsDelta": _num(t.dollars_delta),
        "cadence": t.cadence,
        "costPerRun": _num(t.cost_per_run),
        "setupCost": _num(t.setup_cost),
        "clientUserId": t.client_user_id,
        "actorEmail": t.actor_email,
        "note": t.note,
        "soccProjectCode": t.socc_project_code,
        "reversesTransactionId": t.reverses_transaction_id,
        "contractId": t.contract_id,
        "soccBoardColumn": t.socc_board_column,
        "soccSyncedAt": _iso(t.socc_synced_at),
        "createdAt": _iso(t.created_at),
    }
    if with_client_user:
        out["clientUser"] = (
            client_user_dict(t.client_user) if t.client_user else None
        )
    if with_users:
        out["users"] = [
            {
                "clientUserId": tu.client_user_id,
                "clientUser": client_user_dict(tu.client_user)
                if tu.client_user
                else None,
            }
            for tu in t.users
        ]
    return out
