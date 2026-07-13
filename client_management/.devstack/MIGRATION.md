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
Create the project, then copy **both** connection strings from
Settings → Database:
1. **Direct** (host `db.<ref>.supabase.co`, port **5432**) — used for the
   one-time migration load (DDL + big transaction need a real session).
2. **Transaction pooler** (host `...pooler.supabase.com`, port **6543**) — used
   as the app's runtime `DATABASE_URL` (Vercel is serverless). Safe because
   `db.py` already sets asyncpg `statement_cache_size=0`.

## Cutover (I run this once you paste the two strings)
```bash
cd client_management
set -a; . ./.env.preview-secrets; set +a          # source DATABASE_URL (Neon)

# 1. Fresh backup of the live Neon DB (minimizes staleness at cutover).
backend/.venv/Scripts/python.exe .devstack/backup-neon.py .backups/ccm-db-backup-CUTOVER.json

# 2. Load into Supabase via the DIRECT (5432) string. Dry-run first.
TARGET_DATABASE_URL="<supabase-direct-5432>" \
  backend/.venv/Scripts/python.exe .devstack/migrate-db.py .backups/ccm-db-backup-CUTOVER.json --dry-run
TARGET_DATABASE_URL="<supabase-direct-5432>" \
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
