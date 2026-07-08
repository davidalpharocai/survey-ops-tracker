# AlphaROC Client Credit Management

Internal tool for tracking client **credits** and **dollars** — contracts
that add balance, studies that consume it, and the running balance per
client. Restricted to `@alpharoc.ai` users.

The **backend owns all data**: every CRUD operation, validation and
balance computation lives in the FastAPI service, the only thing that
talks to Postgres. The frontend is a thin server-rendered UI that calls
the backend over HTTP and holds no SQL or business logic.

## Features

- **Clients** — create/edit/delete client orgs (contact, relationship
  manager, "became client" date).
- **Client users** — the people (contacts) under each client; reused as
  study attributions.
- **Contracts** — transactions that *add* credits and/or dollars, with a
  renewal date.
- **Studies** — transactions that *consume* balance; cost by run /
  cadence (weekly/monthly/quarterly), setup cost, multi-user
  attribution, bulk edit, "mark reviewed".
- **Reports & balances** — per-client and all-client balances (credits,
  dollars, current-year value & renewal), transaction history.
- **Auth** — every request is tied to an `@alpharoc.ai` user; the
  frontend↔backend hop is authenticated with a shared secret.

## System / Infrastructure

```
Browser ──HTTPS──► Express/EJS frontend ──HTTPS + shared secret──►
        API Gateway (HTTP API) ──► Lambda (FastAPI, container image)
        ──in-VPC──► RDS PostgreSQL (private, TLS)
```

- **Backend** — FastAPI + async SQLAlchemy, packaged as a container
  image and run on **AWS Lambda** (via the AWS Lambda Web Adapter — the
  uvicorn app is unchanged) behind an **API Gateway HTTP API**. Applies
  `app/schema.sql` idempotently on startup (no ORM migrations).
- **Database** — **RDS PostgreSQL** (private, not publicly accessible,
  TLS enforced) inside the existing shared `prod-vpc-us-east-1`. Only
  the backend's security group can reach it.
- **Frontend** — Express + EJS on **App Runner**, gated by the
  `enable_frontend` Terraform flag (currently **off** — backend + RDS
  deployed first; the UI is run locally against the live backend until
  an identity provider is added).
- **Secrets** — DB URL, frontend↔backend shared secret and session key
  live in Secrets Manager (and are Terraform-managed).
- **No NAT** — the VPC's interface endpoints cover everything the Lambda
  needs; nothing else needs internet egress.

All of it is Terraform: see [`infra/terraform/`](infra/terraform/) and
its [README](infra/terraform/README.md) for apply steps, cost and the
auth-gap caveat.

## Layout

```
client_management/
├── frontend/        # Express + EJS UI — calls the backend over HTTP
├── backend/         # FastAPI service — owns the DB, CRUD, all logic
└── infra/terraform/ # AWS infra: RDS + Lambda/API Gateway (+ frontend, gated)
```

## Run the app

### Local (full stack on your machine)

1. **Postgres** (the backend creates the schema itself on boot):

   ```bash
   docker run -d --name ccdb -e POSTGRES_PASSWORD=dev \
     -e POSTGRES_DB=clientcredits -p 5432:5432 postgres:16
   ```

2. **Backend** — FastAPI on `:8000`:

   ```bash
   cd backend
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env     # set DATABASE_URL to the Postgres above
   uvicorn app.main:app --reload --port 8000
   ```

   Leave `INTERNAL_API_SECRET` blank locally to skip the shared-secret
   check. API docs: `http://127.0.0.1:8000/docs` (off when
   `ENV=production`).

3. **Frontend** — Express on `:8080`, pointed at the backend:

   ```bash
   cd frontend
   npm install
   BACKEND_URL=http://127.0.0.1:8000 DEV_USER_EMAIL=you@alpharoc.ai \
     SECRET_KEY=dev npm start
   ```

   Open `http://localhost:8080`. `DEV_USER_EMAIL` stands in for the
   identity header in local dev.

### Local frontend against the deployed backend

The backend is live on Lambda/API Gateway. Point a local frontend at it
with a `frontend/.env` (loaded by `npm run dev`):

```env
BACKEND_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com/
BACKEND_SHARED_SECRET=<value of the ccm/internal-api-secret secret>
DEV_USER_EMAIL=you@alpharoc.ai
SECRET_KEY=dev-local-only
PORT=8090
```

```bash
cd frontend && npm install && npm run dev    # http://localhost:8090
```

Get the URL and secret from Terraform / Secrets Manager:

```bash
cd infra/terraform && terraform output backend_url
aws secretsmanager get-secret-value --region us-east-1 \
  --secret-id ccm/internal-api-secret --query SecretString --output text
```

> `.env` holds a real secret — it is gitignored; never commit it.

### Deploy

Terraform provisions RDS + the backend (Lambda/API Gateway); the
frontend is added later by setting `enable_frontend = true`. See
[`infra/terraform/README.md`](infra/terraform/README.md) for the
apply + image-push runbook, cost, and the **auth gap** (no end-user
identity provider yet — required before exposing the UI publicly).
