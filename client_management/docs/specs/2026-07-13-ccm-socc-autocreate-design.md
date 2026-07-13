# CCM → SOCC auto-create (Option A) — design

*2026-07-13. Status: DESIGN (awaiting review). Build deferred until (a) the SOCC
create endpoint is confirmed/added and (b) the AWS RDS move lands — both apps on
AWS makes the server-to-server call simplest.*

## Goal
When a **study** is recorded in CCM, automatically create a matching **project**
in the SOCC (Survey Ops) tracker, and stamp the SOCC-assigned **PR#####** back
onto the CCM study. Auto-create is one of three creation paths — the others (the
SOCC `create_project` MCP connector, and creating directly in the SOCC app)
already exist; those studies reconcile into CCM via the existing PR-match sync.

## Decisions (David, 2026-07-13)
- **Mechanism = Option A:** CCM's backend calls a SOCC server-to-server
  create-project endpoint in real time; SOCC returns the PR#####.
- **SOCC endpoint:** existence TBD ("I'll check"). This spec defines the
  contract assuming a **new** endpoint; adjust if one already exists. I can
  write it but **I do not deploy SOCC** (see [[survey-ops-tracker-deployment]]).
- **project_type:** an explicit **PS / B2B / Rerun picker** on Record-a-Study.
- **Failure mode:** the **study always saves**; the SOCC create is best-effort,
  flagged when it hasn't happened, and retryable. Money-of-record is never
  blocked by SOCC being down.
- **PR##### owner:** SOCC (returned by the endpoint, stamped on the study).

## SOCC project data model (from the create_project MCP schema)
Required: `project_name`, `client`. Optional: `salesperson`, `n_target` (int>0),
`due_date`, `captain`, `project_type` ∈ {PS, B2B, Rerun}. SOCC dedups projects
and clients by name.

## Field mapping (CCM study → SOCC project)
| SOCC field | CCM source |
|---|---|
| `project_name` | study.name |
| `client` | client.name |
| `project_type` | new study picker (PS/B2B/Rerun) |
| `n_target` | study.target_n (omit if null/0) |
| `salesperson` | client.salespersonName (omit if none) |
| `due_date` | omitted (CCM has no project deadline; SOCC/captain set it) |
| `captain` | omitted (SOCC assigns) |

## SOCC endpoint contract (SOCC-side; you implement + deploy)
```
POST {SOCC_API_URL}/api/projects
Authorization: Bearer {SOCC_API_TOKEN}       # shared service secret
body: { project_name, client, project_type, n_target?, salesperson?,
        source: "ccm", idem_key: "ccm-study-<studyId>" }
-> 200/201 { pr_code: "PR#####" }             # existing or newly created
```
- **Idempotent on `idem_key`**: replaying returns the same project (so CCM
  retries never double-create). SOCC's existing name-dedup is a second backstop.
- Creating the client in SOCC if absent is fine (SOCC `create_client` already
  returns the existing one on a name match — no duplicate).

## CCM side (what I build)
1. **Schema:** `transactions.project_type TEXT NULL` (study-only; additive,
   idempotent in schema.sql). Optionally `socc_relay_status TEXT NULL`
   ('pending' | 'failed' | null) to drive the retry UI, or derive "needs SOCC"
   simply as `kind='study' AND socc_project_code IS NULL AND relay_wanted`.
2. **Study form (Record-a-Study):** a PS/B2B/Rerun picker (persisted) + a
   "Create in SOCC" checkbox (default checked). Unchecked → no relay (study
   already in SOCC or intentionally CCM-only).
3. **create_study flow:** commit the study first (its own transaction, unchanged
   + atomic with inline-contact). THEN, if relay wanted and no PR yet, call the
   SOCC endpoint **outside** that transaction:
   - success → set `socc_project_code = pr_code` (+ clear pending).
   - failure/timeout → leave PR null, mark `socc_relay_status='failed'`; never
     raises to the user (study is saved). Log for observability.
4. **Retry path:** a **"Create in SOCC"** action on any study with
   `socc_project_code IS NULL` and relay wanted (on the ledger row / study
   editor), calling the same idempotent endpoint. Optional daily cron drains
   failed ones. Manual button is the MVP.
5. **Config:** `SOCC_API_URL`, `SOCC_API_TOKEN` (backend env; also
   `.env.preview-secrets`). **Dormant when unset** — studies save normally, no
   flag, no call — so shipping the CCM side before SOCC is ready is safe.
6. **Client mapping caveat:** CCM sends the client *name*; SOCC matches/creates
   by name. Names must agree — this is why the duplicate-client guard (shipped)
   and one-client-one-record matter. A future hardening is a shared client id.

## Non-goals (v1)
- No two-way field sync after creation (status still flows SOCC→CCM via the
  existing sync; money never crosses).
- No bulk backfill of the 220+ existing studies into SOCC.
- No editing/deleting the SOCC project from CCM.

## Idempotency & safety summary
- Study save and SOCC create are decoupled (separate transactions) → a SOCC
  outage never corrupts or blocks the money record.
- `idem_key = ccm-study-<id>` + SOCC name-dedup → at-most-one SOCC project per
  study across any number of retries.
- Relay is opt-outable per study and globally dormant without config.

## Open items to confirm before build
1. Does the SOCC tracker already expose a create endpoint, or add the one above?
2. Auth shape (bearer token vs mTLS vs the existing X-Internal-Auth pattern).
3. Cron for auto-retry, or manual button only, for v1.
4. Sequence: build after the AWS move (recommended) so both apps share a network.
