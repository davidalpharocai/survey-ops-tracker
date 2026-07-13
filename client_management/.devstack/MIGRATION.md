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
Create the project, then copy **both pooler** strings (Connect dialog). Skip
the "Direct connection" — it's IPv6-only now and can fail from IPv4 hosts.
1. **Session pooler** (host `...pooler.supabase.com`, port **5432**, user
   `postgres.<ref>`) → `SUPABASE_SESSION_URL`. Used for the one-time migration
   load — session mode behaves like a direct connection (DDL + multi-statement
   transaction) but is IPv4-safe.
2. **Transaction pooler** (same host, port **6543**) → `SUPABASE_POOLER_URL`.
   Used as the app's runtime `DATABASE_URL` (Vercel is serverless). Safe
   because `db.py` already sets asyncpg `statement_cache_size=0`.

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

# 3. Point ccm-api at the Supabase POOLER (6543) and redeploy.
#    (Vercel env: DATABASE_URL = <supabase-pooler-6543>)
cd backend && npx vercel deploy --prod --yes --scope alpha-roc

# 4. Smoke test: counts + a ledger read against the new DB.
# 5. Post-cutover backup from Supabase for safety.
```

## Later: Supabase → AWS RDS
Same play: `backup-neon.py` against Supabase → `migrate-db.py` with
`TARGET_DATABASE_URL` = the RDS endpoint (reachable from Vercel over SSL) →
flip `DATABASE_URL` → redeploy. No code changes.
