# AlphaROC Client Credit Management

Internal web app for tracking client credits and dollars. Express + EJS
over PostgreSQL (plain SQL via `node-postgres`; RDS in production).
Designed to run behind
Google Cloud IAP at a hostname like `budget.alpharoc.ai`, where every
visitor is already an authenticated @alpharoc.ai Google Workspace user.

## What it does

- **Hub home page** with two panels: *Manage Client and User Lists* and
  *Add Studies and Contracts*.
- **Manage Client List** — scrollable client list on the left, full record
  on the right (name, primary contact name/cell/email, relationship
  manager, balances, current-year contract value and renewal date) with
  inline user CRUD. Delete-client is gated behind a confirmation card.
- **Manage User List** — flat searchable view of every user across all
  clients with a client filter.
- **Transaction Reports** — *Credits and dollars remaining by client*
  (current-year contract value + renewal date) and *Per-client transaction
  log*.
- **Add Contract** / **Add User Study** — dedicated pages reached from the
  hub. Each contract has a renewal date (defaults to start + 1 year). Each
  study is attributed to one user at the chosen client.

Every transaction logs the acting team member's email and a server-side
timestamp.

## Local development

You'll need Node 20+ on your machine.

```bash
cd frontend
npm install

# Bring up a local Postgres (matches DATABASE_URL in .env.example)
docker run -d --name ccdb -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=clientcredits -p 5432:5432 postgres:16

npm run db:init                # applies db/schema.sql (idempotent)

# Seed real data from the spreadsheet
npm run seed:clients
npm run seed:users

# Start the dev server
DEV_USER_EMAIL=michael@alpharoc.ai SECRET_KEY=dev npm run dev
```

The app boots on http://127.0.0.1:8080 (use the IP — Node's HTTP server
binds to IPv4 here).

`npm run dev` uses Node's `--watch` flag, so changes to `src/**` reload
automatically. Templates and CSS are re-read on each request.

## Project layout

```
frontend/
├── package.json
├── db/schema.sql           # source of truth for the schema
├── src/
│   ├── index.js            # entry point
│   ├── app.js              # Express app + all routes
│   ├── middleware/auth.js  # IAP-aware auth shim
│   └── lib/
│       ├── db.js           # pg pool + helpers
│       ├── repo.js         # SQL data-access layer
│       ├── dates.js
│       ├── balances.js     # current-year + lifetime aggregations
│       └── format.js       # dollars/credits/signed formatters
├── views/                  # EJS templates (layout.ejs + pages)
├── public/style.css
├── scripts/
│   ├── seed-from-spreadsheet.js
│   └── seed-users.js
├── data/                   # gitignored — xlsx + users.tsv live here
├── Dockerfile
└── .env.example
```

## Deploy to Cloud Run with IAP

```bash
PROJECT=alpharoc-prod
REGION=us-central1
SERVICE=budget

gcloud run deploy "$SERVICE" \
    --source . \
    --region "$REGION" \
    --no-allow-unauthenticated \
    --set-env-vars ALLOWED_DOMAIN=alpharoc.ai,SECRET_KEY=$(openssl rand -hex 32)
```

Then enable IAP on the Cloud Run service in the console
(*Security → Identity-Aware Proxy*), grant **IAP-secured Web App User** to
`domain:alpharoc.ai`, and map `budget.alpharoc.ai` to the service.

## Persistence

Data lives in **PostgreSQL** (AWS RDS in production — provisioning is a
later detail). Point `DATABASE_URL` at the RDS endpoint and append
`?sslmode=require` to enforce TLS. The schema is plain SQL in
`db/schema.sql`; the container runs `node scripts/apply-schema.js` on
boot. That script is idempotent (`CREATE ... IF NOT EXISTS`) and only
adds objects — it never drops data. To evolve the schema, edit
`db/schema.sql` with additive statements (and write an explicit one-off
migration script under `scripts/` for any column changes/backfills).

### One-time data import from the old SQLite prototype

The legacy prototype data in `prisma/budget.db` can be loaded into a
freshly-initialised Postgres (run `npm run db:init` first). Requires
`python3` and `psql` on PATH:

```bash
DATABASE_URL=postgresql://… npm run migrate:from-sqlite -- --dry-run   # preview
DATABASE_URL=postgresql://… npm run migrate:from-sqlite                # load
DATABASE_URL=postgresql://… npm run migrate:from-sqlite -- --truncate  # replace existing
```

It preserves primary keys (so foreign keys stay intact), converts the
epoch-millisecond dates Prisma stored, resets the id sequences, and
aborts if the target tables already contain data unless `--truncate` is
passed.

## Where to take it next

- Provision the RDS instance and wire up `DATABASE_URL` (with TLS).
- Edit / void transactions (currently the ledger is append-only).
- CSV / PDF export of per-client transaction history.
- Low-balance alerts.
- More reports in the Transaction Reports page.
