# CCM Sales Dashboard + Structured Salesperson — Design

**Date:** 2026-07-09
**Status:** Approved by David (2026-07-09)
**Feature:** "Client Pulse" dashboard on the homepage + a structured Salesperson (owner) on each client, so the dashboard can default to a rep's own clients.

## Goal

Give everyone a dashboard-like view of clients on sign-in, defaulting to *their* clients if they're a salesperson — **without any access restrictions** (anyone can flip to "all clients" and see everything).

## Decisions (locked with David)

1. **Direction:** per-rep "my clients" as the **default filter**, not a permission. No locked-down role, no hidden data, no backend enforcement. Everyone keeps full access; the dashboard just *defaults* to a salesperson's own book with a one-click "All clients".
2. **Ownership:** each client has a required **Salesperson**. Not auto-set to whoever creates the record (David may add a client without being its salesperson) — the client form **requires** picking the salesperson, with an **"add a new salesperson"** option inline.
3. **Salespeople are a standalone list** (add anyone by name + optional email), not tied to Cognito logins. Email is what links a salesperson to a signed-in user for the "my clients" default.

## Data model

Additive only (idempotent `schema.sql`, applied on boot; migrations 001–048 already applied):

- **New table `salespeople`**: `id`, `name` (required), `email` (nullable, lowercased), `active` (bool, default true), `created_at`, `deleted_at`. Partial unique index on `lower(name)` where `deleted_at is null` (no duplicate active names).
- **`clients.salesperson_id`** `INTEGER REFERENCES salespeople(id) ON DELETE SET NULL` (nullable — imports/legacy rows may be blank).
- **Denormalized snapshot on `clients`**: `salesperson_name TEXT`, `salesperson_email TEXT`. Why: `client_dict` is serialized in the hot report paths (balances, renewals, balance-health) and `list_clients`. A snapshot lets `client_dict` emit the salesperson with **zero joins / no async lazy-load risk**. Kept in sync on assignment and on salesperson edit.
- Legacy `clients.relationship_manager` is mirrored (`= salesperson_name`) on write so the ZIP export and any other reader keep working unchanged.

## Backend

- **models.py**: `Salesperson`; `Client.salesperson_id/salesperson_name/salesperson_email`.
- **serializers.py**: `salesperson_dict`; `client_dict` gains `salespersonId`, `salespersonName`, `salespersonEmail` (from the snapshot columns).
- **schemas.py**: `SalespersonIn(name, email?)`; `ClientIn.salesperson_id: int | None`.
- **routers/salespeople.py** (`/api/salespeople`, `require_user`):
  - `GET` — active salespeople, name asc.
  - `POST` — create (name required; email optional, lowercased; dedupe by active lower(name) → return existing on clash rather than erroring, so "add new" is idempotent).
  - `PATCH /{id}` — edit name/email/active. **On name/email change, propagate the snapshot** to all `clients WHERE salesperson_id = id` (so "my clients" works for a rep's whole book once their email is set).
- **routers/clients.py**: create/update resolve `salesperson_id` → set `salesperson_id` + snapshot (`salesperson_name`/`salesperson_email` from the salesperson) + mirror `relationship_manager = salesperson_name`. Validate the id references an active salesperson (400 otherwise). Kept optional at the API (importer/back-compat); the **form** enforces "required".
- **main.py**: register the salespeople router.
- **Seed** (one-off script): create a salesperson per distinct non-blank `relationship_manager`; set each client's `salesperson_id` + snapshot. Emails left null (set later via the roster page). Idempotent (skip names that already exist).

## Frontend

- **lib/types.ts**: `Salesperson`; `ClientBase` gains `salespersonId/salespersonName/salespersonEmail`.
- **lib/api.ts**: `listSalespeople`, `createSalesperson`, `updateSalesperson`; client create/update carry `salesperson_id`.
- **SalespersonPicker** (client component): a required `<select>` of active salespeople + an "＋ Add new salesperson" option that reveals name (+ optional email) inputs. Emits either `salesperson_id` (existing) or `new_salesperson_name`/`new_salesperson_email` (create inline).
- **NewClientDialog.tsx** + **clients/page.tsx** edit form: replace the free-text "Relationship manager" input with the picker (required). Client list relabels "RM ·" → the salesperson.
- **clients/actions.ts**: if a new salesperson was typed, `createSalesperson` first, then set `salesperson_id`.
- **Client Pulse dashboard** on `app/page.tsx`, directly under the two action tiles, for every signed-in user:
  - `ClientPulse` server component fetches `/reports/balances`, `/reports/renewals`, `/reports/balance-health` in parallel and passes the signed-in email + rows to…
  - `ClientPulseView` client component: a **"My clients / All clients"** toggle (remembered in localStorage; first-time default = *My clients* when the signed-in email matches ≥1 client's `salespersonEmail`, else *All*). Filters every widget by `row.client.salespersonEmail === signedInEmail` in "My" mode.
  - Widgets: KPI strip (# negative, # low <60d, # renewals in 30d, this-year value), "Needs attention" table (balance-health negative/low), "Renewals due" (soonest ~8). Rows deep-link to the client. Reuse `.report` CSS, `lib/format`, `InfoTooltip`.
  - Pure helpers (KPI reducers + my-clients filter) extracted to `lib/clientPulse.ts` and unit-tested (vitest).
- **/salespeople roster page** (all signed-in users): list salespeople with editable name/email + add + deactivate. This is how emails get set so "my clients" works for the existing book (email edit propagates the snapshot server-side).

## Non-goals (v1)

- No access restrictions / hidden fields (explicitly out per David).
- No Cognito "sales" group or role tier.
- No multi-salesperson-per-client.
- No pipeline/stage tracking (SOCC already owns pipeline).

## Testing

- **pytest**: salespeople create (dedupe)/list/patch(+propagation); client create/update with `salesperson_id` (valid, invalid → 400) sets snapshot + mirrors relationship_manager; `client_dict` includes salesperson fields; nullable OK for imports.
- **vitest**: `lib/clientPulse.ts` KPI reducers + my-clients filter (empty, mixed emails, case-insensitive, none-owned → default All).

## Rollout

Post-demo (tomorrow's 7/10 demo is unaffected). Targeting the Mon 7/13 teach-in. Ship behind the normal gate + adversarial review; run the salesperson seed against Neon; verify live.
