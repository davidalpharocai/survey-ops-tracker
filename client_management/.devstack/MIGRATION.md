# CCM database migration runbook (Neon → Supabase → AWS)

The app is plain Postgres, so moving hosts = apply `schema.sql` to the target,
load a backup, reset sequences, flip one env var. Proven end-to-end against a
local Postgres 17 on 2026-07-13 (63 clients / 229 transactions / 585 rows;
exact money, bytea, sequences, and FK integrity all verified).

## Tooling
- `backup-neon.py` — full-fidelity dump of every table to JSON (money as exact
  decimals, bytea base64). Backups go to `.backups/` (gitignored).
- `migrate-db.py` — apply `schema.sql` to `TARGET_DATABASE_URL`, TRUNCATE, load
  a backup (FK-safe order; clients.parent_id in a 2nd pass), bump sequences,
  verify counts. `--dry-run` loads then rolls back.

## What I need from you (Supabase)
Create the project, then copy the pooler string (Connect dialog). Skip the
"Direct connection" — it's IPv6-only now and can fail from IPv4 hosts.
1. **Session pooler** (host `...pooler.supabase.com`, port **5432**, user
   `postgres.<ref>`) → `SUPABASE_SESSION_URL`. Used BOTH for the migration load
   AND as the app's runtime `DATABASE_URL`. Session mode pins one backend per
   connection (DDL, multi-statement transactions, and prepared statements all
   work) and is IPv4-safe.

**Do NOT use the 6543 TRANSACTION pooler for this app.** It caused intermittent
500s: asyncpg+SQLAlchemy use server-side prepared statements and Supavisor
txn-mode routes a follow-up query (e.g. a `selectinload`) to a different backend
where the statement doesn't exist. `statement_cache_size=0` doesn't fix it. The
5432 session pooler avoids it entirely (fine at this tool's low concurrency with
NullPool). (`SUPABASE_POOLER_URL` at 6543 is kept in secrets only for reference.)

## Cutover (I run this once you paste the two strings)
```bash
cd client_management
set -a; . ./.env.preview-secrets; set +a          # source DATABASE_URL (Neon)

# 1. Fresh backup of the live Neon DB (minimizes staleness at cutover).
backend/.venv/Scripts/python.exe .devstack/backup-neon.py .backups/ccm-db-backup-CUTOVER.json

# 2. Load into Supabase via the SESSION pooler (5432). Dry-run first.
TARGET_DATABASE_URL="$SUPABASE_SESSION_URL" \
  backend/.venv/Scripts/python.exe .devstack/migrate-db.py .backups/ccm-db-backup-CUTOVER.json --dry-run
TARGET_DATABASE_URL="$SUPABASE_SESSION_URL" \
  backend/.venv/Scripts/python.exe .devstack/migrate-db.py .backups/ccm-db-backup-CUTOVER.json

# 3. Point ccm-api at the Supabase SESSION pooler (5432) and redeploy.
#    (Vercel env: DATABASE_URL = $SUPABASE_SESSION_URL — NOT the 6543 txn pooler)
cd backend && npx vercel deploy --prod --yes --scope alpha-roc

# 4. Smoke test: hit each read/report endpoint a few times (all 200, no
#    intermittent 500s) + a ledger read against the new DB.
# 5. Post-cutover backup from Supabase for safety.
```

## Later: Supabase → AWS RDS
Same play: `backup-neon.py` against Supabase → `migrate-db.py` with
`TARGET_DATABASE_URL` = the RDS endpoint (reachable from Vercel over SSL) →
flip `DATABASE_URL` → redeploy. No code changes.
