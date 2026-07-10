"""Request bodies for the write API.

These intentionally mirror the *form field names* the Express routes
collected (``became_on``, ``credits_amount``, ``client_user_ids`` …)
rather than the database columns. All parsing, defaulting and validation
that used to live in ``frontend/src/app.js`` now happens server-side so
the frontend is a thin pass-through.
"""

from pydantic import BaseModel, Field


class ClientIn(BaseModel):
    """Create/update payload for a client (mirrors the client form)."""

    name: str = ""
    socc_code: str | None = None
    became_on: str | None = None
    primary_contact_name: str | None = None
    primary_contact_cell: str | None = None
    primary_contact_email: str | None = None
    relationship_manager: str | None = None
    # Structured salesperson (account owner). Optional at the API for
    # imports/back-compat; the client form requires it. When set, the
    # backend snapshots the salesperson's name/email onto the client.
    salesperson_id: int | None = None


class ClientUserIn(BaseModel):
    """Create/update payload for a client user."""

    name: str = ""
    email: str | None = None


class SalespersonIn(BaseModel):
    """Create/update payload for a salesperson."""

    name: str = ""
    email: str | None = None
    active: bool | None = None


class ContractIn(BaseModel):
    """Create/update payload for a contract transaction."""

    client_id: int | None = None
    name: str = ""
    socc_project_code: str | None = None
    occurred_on: str | None = None
    renewal_on: str | None = None
    credits_amount: float | str | None = None
    dollars_amount: float | str | None = None


class StudyIn(BaseModel):
    """Create/update payload for a study transaction.

    Mirrors the unified study form consumed by ``readStudyForm``: a
    single ``cost`` field (per-run for trackers, total otherwise) with
    legacy ``cost_per_run`` / ``cost_amount`` fallbacks.
    """

    client_id: int | None = None
    name: str = ""
    socc_project_code: str | None = None
    occurred_on: str | None = None
    cost_type: str | None = None
    cadence: str | None = None
    cost: float | str | None = None
    cost_per_run: float | str | None = None
    cost_amount: float | str | None = None
    setup_cost: float | str | None = None
    client_user_ids: list[int] = Field(default_factory=list)
    # Optional study→contract link. None = Unassigned (also used to unlink
    # on edit). Validated against the client's active contracts server-side.
    contract_id: int | None = None


class StudyBulkUpdateIn(BaseModel):
    """Bulk save payload: one client, many study rows keyed by id."""

    client_id: int
    studies: dict[int, StudyIn]


class SoccProjectStatus(BaseModel):
    """One SOCC project's status row from an uploaded export."""

    pr_code: str = ""
    board_column: str = ""
    project_name: str = ""
    client_name: str = ""


class SoccSyncIn(BaseModel):
    """Payload for the manual SOCC status sync (parsed client-side)."""

    updates: list[SoccProjectStatus] = Field(default_factory=list)
