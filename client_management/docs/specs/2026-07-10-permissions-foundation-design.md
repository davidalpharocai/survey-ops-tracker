# CCM Permissions Foundation — Design

**Date:** 2026-07-10
**Status:** Designed (multi-agent research + synthesis, workflow wf_7a2ae585-bb0). Awaiting David on Phase 0 (identity trust) + allowlist membership before deploy.
**Scope:** Sales hard-restriction (backend-enforced) · admin "view as user" · credit-adjustment approval queue.

## Summary

Three-tier, backend-enforced permissions on the existing `require_user` chokepoint. Roles resolve in ONE place (`config.py` predicates), consumed by a new `scoping.py` dependency:

- **admin** (allowlist/group) — unrestricted; can impersonate + approve.
- **full_access** (`CCM_FULL_ACCESS_EMAILS`) — non-admin who still reads all clients (ops like Sree; approvers live here so they can judge requests).
- **restricted** (default = everyone else) — scoped to clients where `lower(salesperson_email) == login email`; 404 on anything else.

One `AccessScope` dependency yields a reusable `client_filter()` SQL clause + `scoped_client_or_404()` helper that replaces every per-client fetch guard — additive WHERE-filtering only, so money math + reports are untouched.

## The blocker (Phase 0 — David's decision)

The live deploy authenticates via a **shared Basic Auth password + self-asserted `X-User-Email`**. So backend scoping is only a real wall for normal UI use; anyone holding the shared password could forge a different email and read another rep's book. A truly un-bypassable per-user wall needs **Cognito enabled in prod** (verified ID token). Options: (A) enable Cognito now, (B) ship scoping now + Cognito fast-follow, (C) ship scoping as soft enforcement only.

## Data model

- **config.py (no schema):** `full_access_emails` / `approver_emails` (default vineet/shanu/david) + Cognito group names `ccm-staff` / `ccm-credit-approvers`; `is_full_access` / `is_credit_approver` / `is_restricted` / `resolve_role`. Single source of truth for read-scope AND write-gate.
- **New `credit_requests` table** (idempotent in schema.sql + ORM): id, client_id (FK), transaction_id (nullable — survey context), credits_delta/dollars_delta (≥0), note, status (pending|approved|rejected|canceled), requested_by_email, created_at, decided_by_email, decided_at, decision_note, resulting_transaction_id, idem_key. Indexes on (status,created_at), lower(requested_by_email), client_id. The row is the durable approval audit.
- **No transactions change:** approval reuses the existing `transactions.idem_key` unique index with `credit_request:{id}` (distinct namespace) → one request ⇒ at most one adjustment.
- **Read-scoping reuses** `clients.salesperson_email` + `clients_salesperson_email_idx`. No role column in the DB — roles are config-derived.
- **Impersonation:** no table — a signed httpOnly cookie `{sub: target, act: admin, iat}` (HMAC), ~30-min TTL, read-only, audited.

## Central scoping mechanism

`backend/app/scoping.py`: `require_scope` (downstream of an impersonation-aware identity) → `AccessScope` with `client_filter()` (`sa.true()` if unrestricted else `lower(Client.salesperson_email)==email`), `owned_client_ids_subq()` (for transactions/client_users filtered by client_id), and `scoped_client_or_404()` (drop-in for every `_get_or_404`, returns **404 not 403** to hide existence). Every per-client endpoint calls the helper; every global list/report/search ANDs `client_filter()`. A **route-coverage test** enumerating all client-data routes is the guardrail against a forgotten endpoint.

## Endpoints to scope (from the auth map)

Per-client (swap guard → `scoped_client_or_404`): get_client, list_client_users, get_user, user_studies, list_studies(by client), list_contracts(by client), client_balances, client_transactions, client_ledger, get_transaction (currently an IDOR — returns any txn by id). Global (AND `client_filter()`): list_clients, list_users_filtered, list_all_studies, list_all_contracts, all_balances, renewal_radar, balance_health, search (all four groups). Roster: list_salespeople.

## Escalation lockdown (ships WITH read-scoping)

The scope key (`salesperson_email`) is writable today via `clients PATCH` and salespeople CRUD (both `require_user`). Gate salespeople POST/PATCH/DELETE behind `require_admin`; restrict changing `salesperson_id/email` on clients to admin/full_access; client-create stays admin/full_access. Must land in the same release as read-scoping or a restricted user could self-grant.

## Build phases (each TDD + shippable)

0. **Blocking decision** (identity trust + allowlist membership).
1. **Roles + read-scoping** — config predicates + scoping.py + swap guards + AND filters; route-coverage test first. Fail-closed (own nothing ⇒ empty + 404s).
2. **Escalation lockdown** — ships with Phase 1.
3. **Write-gate + credit-approval queue** — `require_unrestricted` (403 on contracts + positive adjustments), extract `insert_adjustment()`, credit_requests table + router (submit/list/approve/reject/cancel); approve = SELECT FOR UPDATE + guard + insert_adjustment(idem `credit_request:{id}`) + status flip, atomic + idempotent.
4. **Admin impersonation** — real vs effective identity; signed cookie; read-only (403 writes while impersonating); banner + exit; audit real admin + impersonated email.
5. **Frontend UX** — restricted users: force dashboard "mine", hide My/All toggle + Salespeople nav + admin chrome, replace "New contract"/"Add adjustment" with "Request credits", add an Approvals page. Backend stays authoritative.

## Open questions (defaults I'll proceed on unless changed)

1. **Identity trust (BLOCKING)** — Cognito now / fast-follow / soft-only.
2. **Allowlists** — approvers = Vineet/Shanu/David (default); full_access = TBD (ops). Approvers get unrestricted read (needed to judge requests) unless told otherwise.
3. **Restricted capabilities** — sales MAY record studies + edit contacts on their OWN clients; MAY NOT create clients or reassign salespeople; may submit credit ADDITIONS only (negative/correction adjustments stay admin/approver). Credit requests are client-level with the survey as context.
4. **Impersonation** — read-only, ~30-min TTL, targets = salespeople/team roster, faithful target view (admin chrome disappears).

## Top risks

Self-asserted identity under Basic Auth (closed only by Cognito) · read-scope/write-gate divergence (mitigated by one `config.py` predicate) · escalation via the scope key (ship lockdown together) · forgotten endpoint (route-coverage test) · **data quality**: scoping keys on nullable `salesperson_email` — clients with NULL become invisible to non-admins, and a rep whose login ≠ salesperson email is scoped to nothing (needs a data audit + login==salesperson-email confirmation before deploy) · impersonation mis-attribution (writes blocked; api always sends real admin) · approve idempotency (SELECT FOR UPDATE + deterministic idem_key).
