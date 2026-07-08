# Local dev — running the CMS on this machine

Rebuilt code-for-code from Tedi/Nachiket's `client_management-main.zip` (2026-07-08).
The pristine import is commit `8bad00b`; everything after that is our work.

## Stack

| Piece | What | Where |
|---|---|---|
| Database | PostgreSQL 17 (embedded-postgres, no Docker/service) | port **5433**, data in `.devstack/pgdata/` |
| Backend | FastAPI (owns ALL data + logic; applies `backend/app/schema.sql` on boot) | port **8000** |
| Frontend | Next.js 15 (thin UI; calls backend over HTTP) | port **3000**, app at **`/ccm`** |

## Start (three terminals, in order)

```powershell
# 1. Postgres (keeps running; Ctrl+C stops it)
cd client_management\.devstack
node db.mjs start

# 2. Backend
cd client_management\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# 3. Frontend
cd client_management\frontend
npm run dev
```

Open **http://localhost:3000/ccm/clients** (note: the bare `/ccm` homepage shows
"Sign in" locally — see Findings #2 — go straight to a subpage).
API docs: http://127.0.0.1:8000/docs

- Local auth: no Cognito locally. The frontend middleware injects `DEV_USER_EMAIL`
  (from `frontend/.env`, currently david@alpharoc.ai) as an admin; the backend
  trusts the `X-User-Email` header when Cognito env vars are blank.
- `.env` files for both sides already exist (gitignored, local-only values).
- One-time setup already done: `backend/.venv` (Python 3.12 via winget),
  `frontend/node_modules`, `.devstack/node_modules`.

## Verified working end-to-end (2026-07-08)

- Schema auto-applied on backend boot (4 tables + index).
- UI: create client (dialog → server action → backend), inline add user.
- UI: Add Contract (+200 credits / +$10,000, renewal defaulted to start+1yr).
- Study math (`study_logic.py`): monthly tracker @10 credits/run + 20 setup
  → creditsDelta −140 (10×12+20); balance 200−140=60. Setup cost always folds
  into credits; studies debit exactly one currency.
- Reports: balance summary + per-client transaction log render correct numbers,
  actor emails and server timestamps logged.
- API parity (verified by exhaustive cross-read): every frontend call has a
  matching backend route; all 27 `lib/api.ts` methods used; the two `schema.sql`
  files are byte-identical — **`backend/app/schema.sql` is the live one**
  (`frontend/db/schema.sql` is a vestigial copy used only by dead legacy scripts).

## Our changes on top of the pristine import

- **FIXED — basePath redirects** (`1c1cb2a`): all server actions now redirect
  through `redirectTo()` in `lib/action.ts`, which prepends `/ccm`
  (single-sourced from `next.config.mjs` as `NEXT_PUBLIC_BASE_PATH`).
  Worth flagging upstream to Tedi/Nachiket — likely broken in prod too.
- **FIXED — local homepage auth** (`1c1cb2a`): `lib/auth.ts` falls back to
  `DEV_USER_EMAIL` (never in production) so the `/ccm` hub renders signed-in.
- **FIXED — date-validation 500s** (`1c1cb2a`): `parse_date` tolerates garbage,
  clients require `became_on`, contracts require `occurred_on` + valid
  `renewal_on` — clean 400s with human messages.
- **NEW — credit-usage PDF export**: `GET /ccm/reports/transactions/pdf?client_id=N`
  (jsPDF route handler) + a Download PDF button on the per-client transaction
  report. Branded snapshot: balance summary + colored signed ledger.
- **NEW — demo seed** (`.devstack/seed-from-socc.mjs`): loads the SOCC export
  (62 clients w/ RM + since-date, 222 studies attributed to the requested-by
  contact or a per-client "(Unassigned)" user, contacts as client users)
  through the backend API. Studies land at 0 cost on purpose — the tracker has
  no credit pricing; fill costs via the studies bulk-edit flow. Rerunnable.

## Findings still open (inherited from the import)

4. **`INTERNAL_API_SECRET` / `X-Internal-Auth` is documentation-only** — READMEs
   and both `.env.example`s describe a frontend↔backend shared secret; no code
   implements it (backend auth is Cognito JWT / X-User-Email + domain gate).
5. **Deleting a client user can silently orphan study attributions** — the
   delete guard only checks the legacy `transactions.client_user_id` column, not
   `transaction_users`; non-primary attributed users delete without warning.
6. **Duplicate-name check asymmetry** — create client is case-sensitive,
   update is case-insensitive.
7. **Stale docs everywhere** — both READMEs + infra README describe up to three
   older generations (Express/EJS, IAP/Cloud Run, App Runner, shared secrets).
   Trust the code, not the READMEs.
8. **Dead code** — all of `frontend/scripts/` imports `../src/lib/*` which no
   longer exists (seeds/migrations are unrunnable as-is); `frontend/db/schema.sql`
   orphaned; `pg`/`exceljs` deps only used by those scripts; `frontend/todo` is a
   relic; frontend Dockerfile is leftover from the App Runner era (Amplify is the
   real deploy; its HEALTHCHECK path and missing `public/` would break anyway).

## Production architecture (for reference — not needed locally)

Browser → Amplify Hosting (Next.js SSR, Cognito Hosted UI login, groups
`ccm-users`/`ccm-admins`) → API Gateway → Lambda (FastAPI container, Lambda Web
Adapter) → RDS PostgreSQL (private VPC). Audit trail: mutating requests logged as
JSON to CloudWatch → Firehose → S3 → Athena (admin "Audit Log" page queries it).
All Terraform in `infra/terraform/`.
