"""ORM models mapped onto the shared Postgres tables.

These mirror ``backend/app/schema.sql`` (the single source of truth for
the schema, applied idempotently on startup). The backend now owns every
write path; the Express frontend reaches these tables only through this
service's HTTP API.
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Salesperson(Base):
    """An AlphaROC salesperson (account owner) a client can be assigned to.

    Maps to the ``salespeople`` table. Purely a filter/label dimension —
    assignment never restricts who can see a client. ``email`` (optional)
    links a salesperson to a signed-in user so the dashboard can default
    to that rep's own clients.

    Attributes
    ----------
    id : int
        Primary key.
    name : str
        Display name (unique among active salespeople, case-insensitive).
    email : str or None
        Login email used to match the signed-in user, if known.
    active : bool
        Whether the salesperson appears in the picker.
    """

    __tablename__ = "salespeople"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Client(Base):
    """A client organisation.

    Maps to the ``clients`` table.

    Attributes
    ----------
    id : int
        Primary key.
    name : str
        Unique client name.
    became_client_on : datetime
        Date the organisation became a client (UTC midnight).
    primary_contact_name, primary_contact_cell, primary_contact_email : str or None
        Primary point-of-contact details.
    relationship_manager : str or None
        Internal owner of the relationship, if assigned.
    created_by_email : str
        Email of the team member who created the record.
    created_at : datetime
        Server-side creation timestamp.
    """

    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Uniqueness is enforced by a partial index over ACTIVE clients only
    # (clients_name_active_key in schema.sql), so archived names can be
    # reused.
    name: Mapped[str] = mapped_column(String)
    socc_code: Mapped[str | None] = mapped_column(String, nullable=True)
    became_client_on: Mapped[datetime] = mapped_column(DateTime)
    primary_contact_name: Mapped[str | None] = mapped_column(String, nullable=True)
    primary_contact_cell: Mapped[str | None] = mapped_column(String, nullable=True)
    primary_contact_email: Mapped[str | None] = mapped_column(String, nullable=True)
    relationship_manager: Mapped[str | None] = mapped_column(String, nullable=True)
    # Structured salesperson (account owner) + a denormalized snapshot of
    # their name/email so client_dict serializes with no join. Nullable for
    # imports/legacy rows; the client form requires it going forward.
    salesperson_id: Mapped[int | None] = mapped_column(
        ForeignKey("salespeople.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
    )
    salesperson_name: Mapped[str | None] = mapped_column(String, nullable=True)
    salesperson_email: Mapped[str | None] = mapped_column(String, nullable=True)
    # Optional parent account (flat Parent->Child; NULL = top-level). Self-
    # referential; the one-level invariants are enforced in the app layer.
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by_email: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    users: Mapped[list["ClientUser"]] = relationship(
        back_populates="client", cascade="all, delete-orphan"
    )


class ClientUser(Base):
    """A named contact belonging to a client.

    Maps to the ``client_users`` table.

    Attributes
    ----------
    id : int
        Primary key.
    client_id : int
        Owning client.
    name : str
        Contact name.
    email : str or None
        Contact email.
    created_by_email : str
        Email of the team member who created the record.
    created_at : datetime
        Server-side creation timestamp.
    """

    __tablename__ = "client_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE", onupdate="CASCADE")
    )
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by_email: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    client: Mapped[Client] = relationship(back_populates="users")


class CreditRequest(Base):
    """A salesperson's request to add credits/dollars, awaiting approval.

    Maps to the ``credit_requests`` table. Restricted salespeople can't add
    credits directly; they file a request that an approver (Vineet / Shanu /
    David) approves, which creates the actual adjustment. The row is the
    durable approval audit trail.
    """

    __tablename__ = "credit_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE", onupdate="CASCADE")
    )
    # Optional survey context ("these credits are for PR#####") — NOT a link.
    transaction_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    credits_delta: Mapped[Decimal] = mapped_column(Numeric(65, 30), default=0)
    dollars_delta: Mapped[Decimal] = mapped_column(Numeric(65, 30), default=0)
    note: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")
    requested_by_email: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    decided_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String, nullable=True)
    resulting_transaction_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )


class Transaction(Base):
    """A single ledger entry (a contract or a study).

    Maps to the ``transactions`` table. Contracts add positive deltas;
    studies add a negative delta on exactly one currency column.

    Attributes
    ----------
    id : int
        Primary key.
    client_id : int
        Owning client.
    kind : str
        Either ``"contract"`` or ``"study"``.
    name : str
        Human-readable label.
    occurred_on : datetime
        When the entry took effect (UTC midnight).
    renewal_on : datetime or None
        Renewal date (contracts only).
    credits_delta, dollars_delta : Decimal
        Signed change to the client's credit / dollar balance.
    cadence : str or None
        Run cadence for tracker studies (weekly/monthly/quarterly).
    cost_per_run, setup_cost : Decimal or None
        Tracker-study economics.
    client_user_id : int or None
        Legacy single-user attribution column.
    actor_email : str
        Email of the team member who recorded the entry.
    note : str or None
        Free-text note (used for the CSV-import review flag).
    created_at : datetime
        Server-side creation timestamp.
    """

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE", onupdate="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    occurred_on: Mapped[datetime] = mapped_column(DateTime)
    renewal_on: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    credits_delta: Mapped[Decimal] = mapped_column(Numeric(65, 30), default=0)
    dollars_delta: Mapped[Decimal] = mapped_column(Numeric(65, 30), default=0)
    cadence: Mapped[str | None] = mapped_column(String, nullable=True)
    cost_per_run: Mapped[Decimal | None] = mapped_column(
        Numeric(65, 30), nullable=True
    )
    setup_cost: Mapped[Decimal | None] = mapped_column(
        Numeric(65, 30), nullable=True
    )
    client_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("client_users.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
    )
    actor_email: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    socc_project_code: Mapped[str | None] = mapped_column(String, nullable=True)
    # Adjustment rows may point at the transaction they reverse (plain
    # integer column — no FK constraint; see schema.sql).
    reverses_transaction_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    # Idempotency key for money-creating POSTs (partial unique index
    # transactions_idem_key_key in schema.sql).
    idem_key: Mapped[str | None] = mapped_column(String, nullable=True)
    # Optional study→contract link (self-referential; NULL = Unassigned).
    # Meaningful only for kind='study'; validated in the application layer.
    contract_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Study metadata (kind='study' only; nullable/additive). `audience` is
    # free-text; `target_n`/`actual_n_delivered` are respondent counts;
    # `description` is a free-text note distinct from the CSV-import `note`.
    audience: Mapped[str | None] = mapped_column(String, nullable=True)
    target_n: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actual_n_delivered: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    # One-way SOCC sync (status only): the survey's SOCC board column and
    # when it was last synced. Never affects money.
    socc_board_column: Mapped[str | None] = mapped_column(String, nullable=True)
    socc_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    client_user: Mapped[ClientUser | None] = relationship()
    users: Mapped[list["TransactionUser"]] = relationship(
        back_populates="transaction", cascade="all, delete-orphan"
    )


class TransactionUser(Base):
    """Join row attributing a transaction to a client user.

    Maps to the ``transaction_users`` table. A study may be attributed to
    several users; this is the modern many-to-many replacement for the
    legacy ``transactions.client_user_id`` column.

    Attributes
    ----------
    id : int
        Primary key.
    transaction_id : int
        Attributed transaction.
    client_user_id : int
        Attributed client user.
    """

    __tablename__ = "transaction_users"
    __table_args__ = (UniqueConstraint("transaction_id", "client_user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE", onupdate="CASCADE")
    )
    client_user_id: Mapped[int] = mapped_column(
        ForeignKey("client_users.id", ondelete="CASCADE", onupdate="CASCADE")
    )

    transaction: Mapped[Transaction] = relationship(back_populates="users")
    client_user: Mapped[ClientUser] = relationship()
