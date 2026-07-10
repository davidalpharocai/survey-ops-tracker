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

-- Additive columns (idempotent; see FUTURE.md). Applied on boot.
-- Stable cross-app identifiers (SOCC Cl##### / PR#####): the only
-- reliable join key between CCM and the Survey Ops Command Center.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS socc_code TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS socc_project_code TEXT;

-- Soft-delete: money history is never destroyed by a delete.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP(3);
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP(3);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP(3);

-- Editor attribution: who last changed a row, and when.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_by_email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3);
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS updated_by_email TEXT;
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_by_email TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS clients_socc_code_key
    ON clients (socc_code) WHERE socc_code IS NOT NULL;

-- Name uniqueness applies to ACTIVE clients only, so an archived
-- client's name can be reused (the API dup-check already filters on
-- deleted_at; this makes the DB agree with it).
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS clients_name_active_key
    ON clients (name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS transactions_socc_project_code_idx
    ON transactions (socc_project_code) WHERE socc_project_code IS NOT NULL;

-- Adjustment entries: corrections are recorded as NEW ledger rows
-- (kind = 'adjustment') instead of editing history. An adjustment may
-- point at the transaction it reverses.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reverses_transaction_id INTEGER;

-- Idempotency keys on money-creating POSTs: a retried request (client
-- retry, double-click, network replay) can never double-insert a row.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS idem_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_idem_key_key
    ON transactions (idem_key) WHERE idem_key IS NOT NULL;

-- Contract-linked ledger: a study may optionally roll up to exactly one
-- contract of the same client (self-referential; NULL = Unassigned). The
-- "same client + kind='contract' + not archived" rule is enforced in the
-- application layer. Additive and nullable: existing studies are untouched.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS contract_id INTEGER
    REFERENCES transactions(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS transactions_contract_id_idx
    ON transactions (contract_id);

-- CCM<->SOCC one-way sync (status only): the survey's SOCC board column
-- (e.g. "Fielding") and when it was last synced from a SOCC export. Purely
-- informational — never affects credits/dollars or any report math.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS socc_board_column TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS socc_synced_at TIMESTAMP(3);

-- Study metadata (studies only; additive + nullable, existing rows
-- untouched). `audience` is free-text; `target_n` / `actual_n_delivered`
-- are respondent counts; `description` is a free-text blurb.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS audience TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS target_n INTEGER;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS actual_n_delivered INTEGER;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS description TEXT;

-- Structured salesperson (account owner). Each client is assigned one
-- salesperson, chosen from this list (with add-new on the client form).
-- This is purely a filter/label dimension — there is NO access restriction
-- anywhere; anyone can still see every client. `email` links a salesperson
-- to a signed-in user so the dashboard can default to "my clients".
CREATE TABLE IF NOT EXISTS salespeople (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP(3)
);
-- No two active salespeople share a name (case-insensitive), so "add new"
-- stays idempotent and the picker list is clean.
CREATE UNIQUE INDEX IF NOT EXISTS salespeople_name_active_key
    ON salespeople (lower(name)) WHERE deleted_at IS NULL;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS salesperson_id INTEGER
    REFERENCES salespeople(id) ON DELETE SET NULL ON UPDATE CASCADE;
-- Denormalized snapshot of the assigned salesperson so client_dict can be
-- serialized with NO join (the reports embed client_dict on every row).
-- Kept in sync when a client is (re)assigned and when a salesperson's
-- name/email is edited (the PATCH propagates to linked clients).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS salesperson_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS salesperson_email TEXT;

-- Optional parent account (flat Parent->Child; NULL = top-level). Self-
-- referential; the one-level invariants are enforced in the application
-- layer. Additive + nullable — existing clients are untouched.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent_id INTEGER
    REFERENCES clients(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS clients_parent_id_idx ON clients (parent_id);
CREATE INDEX IF NOT EXISTS clients_salesperson_email_idx
    ON clients (lower(salesperson_email)) WHERE salesperson_email IS NOT NULL;

-- Credit-request approval queue. A restricted salesperson can't add credits
-- directly; they submit a request here and an approver (Vineet/Shanu/David)
-- approves it, which creates the actual adjustment. The row is the durable
-- approval audit record. transaction_id is optional survey context only
-- (NOT a funding link). idem_key: the resulting adjustment reuses
-- transactions.idem_key with the value 'credit_request:{id}'.
CREATE TABLE IF NOT EXISTS credit_requests (
    id                     SERIAL PRIMARY KEY,
    client_id              INTEGER NOT NULL
                             REFERENCES clients(id) ON DELETE CASCADE ON UPDATE CASCADE,
    transaction_id         INTEGER
                             REFERENCES transactions(id) ON DELETE SET NULL ON UPDATE CASCADE,
    credits_delta          DECIMAL(65,30) NOT NULL DEFAULT 0,
    dollars_delta          DECIMAL(65,30) NOT NULL DEFAULT 0,
    note                   TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'pending',
    requested_by_email     TEXT NOT NULL,
    created_at             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by_email       TEXT,
    decided_at             TIMESTAMP(3),
    decision_note          TEXT,
    resulting_transaction_id INTEGER
                             REFERENCES transactions(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS credit_requests_status_created_idx
    ON credit_requests (status, created_at);
CREATE INDEX IF NOT EXISTS credit_requests_requester_idx
    ON credit_requests (lower(requested_by_email));
CREATE INDEX IF NOT EXISTS credit_requests_client_idx
    ON credit_requests (client_id);
