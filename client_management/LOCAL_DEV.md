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

## Findings (bugs & quirks found during the rebuild — none fixed yet)

1. **Server-action redirects drop the `/ccm` basePath** — every successful form
   submit (create client/contract/study, edits, deletes) redirects to e.g.
   `/clients?id=3` instead of `/ccm/clients?id=3` → lands on a 404. The write
   succeeds. Next.js `redirect()` doesn't prepend `basePath`; fix is to prefix
   the redirect paths (all in `app/**/actions.ts`). Likely broken in prod too.
2. **Bare `/ccm` homepage shows "Sign in" locally** — the middleware matcher
   misses the basePath root, so `x-user-email` isn't injected there; in prod the
   Cognito cookie fallback in `lib/auth.ts` masks it. Subpages are fine.
3. **Create/update client without a date 500s** — `became_on` is optional in the
   request schema but NOT NULL in the DB → IntegrityError 500 instead of a 400.
   Same class of issue: contracts don't validate `occurred_on` (missing/bad date
   → 500). Studies DO validate theirs.
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
