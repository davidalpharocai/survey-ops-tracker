"""ORM models mapped onto the shared Postgres tables.

These mirror ``backend/app/schema.sql`` (the single source of truth for
the schema, applied idempotently on startup). The backend now owns every
write path; the Express frontend reaches these tables only through this
service's HTTP API.
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
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
    name: Mapped[str] = mapped_column(String, unique=True)
    socc_code: Mapped[str | None] = mapped_column(String, nullable=True)
    became_client_on: Mapped[datetime] = mapped_column(DateTime)
    primary_contact_name: Mapped[str | None] = mapped_column(String, nullable=True)
    primary_contact_cell: Mapped[str | None] = mapped_column(String, nullable=True)
    primary_contact_email: Mapped[str | None] = mapped_column(String, nullable=True)
    relationship_manager: Mapped[str | None] = mapped_column(String, nullable=True)
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
