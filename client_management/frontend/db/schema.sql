-- AlphaROC Client Credit Management — PostgreSQL schema.
-- Idempotent: safe to run on every boot (CREATE ... IF NOT EXISTS).
-- This is the single source of truth for the schema now that the ORM is
-- gone. Evolve it with explicit, additive statements.

CREATE TABLE IF NOT EXISTS clients (
    id                    SERIAL PRIMARY KEY,
    name                  TEXT NOT NULL UNIQUE,
    became_client_on      TIMESTAMP(3) NOT NULL,
    primary_contact_name  TEXT,
    primary_contact_cell  TEXT,
    primary_contact_email TEXT,
    relationship_manager  TEXT,
    created_by_email      TEXT NOT NULL,
    created_at            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client_users (
    id               SERIAL PRIMARY KEY,
    client_id        INTEGER NOT NULL
                       REFERENCES clients(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name             TEXT NOT NULL,
    email            TEXT,
    created_by_email TEXT NOT NULL,
    created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id             SERIAL PRIMARY KEY,
    client_id      INTEGER NOT NULL
                     REFERENCES clients(id) ON DELETE CASCADE ON UPDATE CASCADE,
    kind           TEXT NOT NULL,
    name           TEXT NOT NULL,
    occurred_on    TIMESTAMP(3) NOT NULL,
    renewal_on     TIMESTAMP(3),
    credits_delta  DECIMAL(65,30) NOT NULL DEFAULT 0,
    dollars_delta  DECIMAL(65,30) NOT NULL DEFAULT 0,
    cadence        TEXT,
    cost_per_run   DECIMAL(65,30),
    setup_cost     DECIMAL(65,30),
    client_user_id INTEGER
                     REFERENCES client_users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    actor_email    TEXT NOT NULL,
    note           TEXT,
    created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transaction_users (
    id             SERIAL PRIMARY KEY,
    transaction_id INTEGER NOT NULL
                     REFERENCES transactions(id) ON DELETE CASCADE ON UPDATE CASCADE,
    client_user_id INTEGER NOT NULL
                     REFERENCES client_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE (transaction_id, client_user_id)
);

CREATE INDEX IF NOT EXISTS transactions_client_kind_occurred_idx
    ON transactions (client_id, kind, occurred_on);
