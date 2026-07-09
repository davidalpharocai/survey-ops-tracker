# CCM — Contract-Linked Ledger (feature ①) — Design Spec

**Date:** 2026-07-09 · **Status:** approved (brainstorm) → ready for plan
**Roadmap:** feature ① of ①→⑤ (see memory `ccm-roadmap`). Search (②) is deferred.

## Problem
Today CCM credits are **pooled per client**: every contract adds credits, every
study subtracts, and a client's balance is the aggregate sum. A study has no tie
to the contract that funds it (`transactions` links to `client_id` only). So the
app can't answer "which contract did this survey draw from?" or "how much is left
on *this* contract?" — and a client with multiple contracts is just one pot.

## Goal
Let each study roll up to a specific contract, and show the ledger grouped by
contract (studies nested under their contract, each contract with its own
remaining balance) — **without changing any existing balance/report math**. This
is purely additive.

## Locked decisions (from brainstorm)
1. **Optional single link.** A study points at ≤1 contract of the same client.
   Unlinked studies sit in an **"Unassigned"** group. No backfill — the 222
   imported studies start Unassigned.
2. **Ledger tree lives on the Transaction Log page** (`/reports/transactions?client_id=`).
   Contracts as parent rows; studies indented; expand/collapse per contract + all.
3. **Client total balance, Balance Health, and Renewal Radar math are UNCHANGED.**
   Per-contract remaining is a new, additive breakdown only.
4. **Block archiving a contract that still has active linked studies** (mirrors the
   existing "can't delete a user still attributed to transactions" guard).
5. **Adjustments stay client-level** — shown in their own group, never linked.
6. Over-drawn contract (linked studies exceed funding) shows negative/red, like
   today's client-level negative styling.
7. `(i)` tooltips on every new element.

## Data model
Add one nullable, self-referential column to `transactions`:

```sql
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS contract_id INTEGER
    REFERENCES transactions(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS transactions_contract_id_idx ON transactions(contract_id);
```

- Meaningful only for `kind='study'`. `NULL` = Unassigned.
- The FK guarantees referential integrity; the **same-client + kind='contract' +
  not-archived** rule is enforced in the application layer (a FK can't express it).
- Applied via the existing idempotent `schema.sql` on boot + the manual Neon apply.
  No data migration. (Generate with `sql-database-assistant`.)

## Balance semantics (the careful part)
- **Per-contract remaining** (per currency) = `contract.delta + Σ(linked studies' delta)`
  (studies are negative). Computed on read; never stored.
- **Unassigned** = studies with `contract_id IS NULL`; they reduce the client total
  but belong to no contract.
- **Client total** (headline) = `Σ all contracts + Σ all studies` — identical to
  today. Invariant to verify in tests:
  `client_total == Σ(per-contract remaining) + Σ(unassigned study deltas) + Σ(adjustment deltas)`.
- Balance Health / Renewal Radar / client balances endpoints are **untouched**.

## Backend
- **Schema/model:** add `contract_id` to `Transaction`; helper to resolve/validate a
  study's contract.
- **Validation** (study create + update): if `contract_id` provided, it must be an
  existing `kind='contract'`, `deleted_at IS NULL`, same `client_id`; else 400.
- **New endpoint** `GET /api/clients/{id}/ledger` → grouped tree:
  ```json
  {
    "contracts": [{ "...contract fields", "remainingCredits", "remainingDollars", "studies": [ ... ] }],
    "unassigned": [ ...studies ],
    "adjustments": [ ...adjustments ],
    "totals": { "credits", "dollars" }
  }
  ```
  Excludes soft-deleted rows and archived clients (reuse `_active_client_or_404`).
- **Archive guard:** `DELETE /api/contracts/{id}` returns 409 if any active study
  has `contract_id = id` (message names the count, mirroring the user-delete guard).
- Flat `GET /api/clients/{id}/transactions` stays (PDF/export unaffected).

## Frontend
- **Transaction Log page:** replace the flat table with the grouped tree
  (contract parent rows → indented studies), collapsible per contract + an
  expand/collapse-all control. Unassigned + Adjustments groups at the bottom.
  Per-contract remaining shown on each contract row (red when negative).
- **Study form** (`NewStudyForm` + edit): add a **"Contract (optional)"** `<select>`
  of the client's active contracts.
- **Per-client search:** an instant client-side filter box over the loaded tree
  (name / `PR#####` / kind). No new request.
- `(i)` `InfoTooltip` on: per-contract remaining, Unassigned, the contract picker.

## User stories & acceptance criteria

**US-1 (Enabler) — study→contract link.** *As a developer, I need a nullable
`contract_id` on study transactions so a study can roll up to one contract.*
- Given the schema applies, When it runs on an existing DB, Then `contract_id` is
  added, nullable, defaulting NULL, with no row rewritten and no existing study changed.
- Given a study with `contract_id=NULL`, When balances are computed, Then the
  client total is byte-for-byte identical to before the migration.

**US-2 — assign a study to a contract.** *As an ops user, I want to pick a contract
when recording/editing a study so usage rolls up correctly.*
- Given a client with ≥1 active contract, When I open the study form, Then a
  "Contract (optional)" picker lists that client's active contracts plus "— none —".
- Given I pick a contract and save, When the study is created, Then its `contract_id`
  is that contract and it appears nested under it in the ledger.
- Given I pick a contract belonging to a different client (tampered request), When I
  submit, Then the API responds 400 and nothing is written.
- Given I leave it blank, When I save, Then the study is created Unassigned.

**US-3 — contract-grouped ledger with per-contract remaining.** *As an ops user, I
want the ledger grouped by contract with each contract's remaining balance so I can
see how much each has left.*
- Given a client with contracts and linked studies, When I open the Transaction Log,
  Then each contract is a parent row showing funding, remaining (funding − its
  studies), and renewal, with its studies indented beneath.
- Given a contract whose linked studies exceed its funding, When I view it, Then its
  remaining shows negative in red.
- Given the same data, When I sum per-contract remaining + unassigned + adjustments,
  Then it equals the client's headline balance.

**US-4 — expand/collapse.** *As an ops user, I want to collapse contracts so I can
focus.*
- Given the tree, When I click a contract's toggle, Then its studies hide/show and the
  contract row remains with its remaining visible.
- Given the tree, When I click "Collapse all"/"Expand all", Then all contracts
  collapse/expand.

**US-5 — per-client ledger search.** *As an ops user, I want to filter one client's
ledger so I can find a study/contract fast.*
- Given a client's ledger, When I type in the search box, Then only contracts/studies
  whose name or `PR#####` matches remain (a matching study keeps its contract
  visible), case-insensitively, with no page reload.
- Given I clear the box, When the field is empty, Then the full tree returns.

**US-6 — Unassigned & Adjustments groups.** *As an ops user, I want unlinked studies
and adjustments visible so nothing is hidden.*
- Given studies with no contract, When I view the ledger, Then they appear under an
  "Unassigned" group with an `(i)` explaining it.
- Given adjustments exist, When I view the ledger, Then they appear under a
  client-level "Adjustments" group and are never nested under a contract.

**US-7 (Guard) — protect linked contracts.** *As an admin, I want to be blocked from
archiving a contract that still has active linked studies so I don't orphan usage.*
- Given a contract with ≥1 active linked study, When I try to archive it, Then the API
  responds 409 with a message naming the count and nothing is archived.
- Given a contract whose only linked studies are already archived, When I archive it,
  Then it archives successfully.

**US-8 (Invariant) — reports unchanged.** *As a finance user, I need existing balances
and reports to stay exactly the same so trust is preserved.*
- Given any client, When Balance Health / Renewal Radar / client balances are computed
  before and after this feature, Then the outputs are identical.

## Edge cases
- **Currency:** per-contract remaining is shown per currency; linkage isn't
  currency-restricted (rare mixed cases show both credit and dollar remaining).
- **Archived contract with only archived studies:** archivable (guard checks active
  studies only).
- **Editing a study to remove its contract:** allowed → moves it to Unassigned.
- **Restore:** restoring an archived study keeps its `contract_id`; if that contract
  is archived, the study shows Unassigned until reassigned (documented).

## Testing
- **Backend pytest:** migration is additive (no total change); contract_id validation
  (same client, is-contract, not-archived, null ok); ledger grouping + remaining math
  incl. over-draw negative; unassigned/adjustments grouping; archive-guard 409/allow;
  invariant that per-contract + unassigned + adjustments == client total; reports
  unchanged.
- **Frontend:** tsc; vitest for tree grouping/collapse/filter logic; `next build`.
- Same green gate as prior work (currently 181 backend / 35 vitest).

## Rollout
Additive nullable column → deploy backend (schema self-applies) + frontend. No
backfill. Reversible (drop column / ignore). Demo data untouched.

## Out of scope (later roadmap items)
Global search (②), configurable export (④), SOCC↔CCM fielding relay (⑤), per-contract
grouping in the PDF/export, and a contracts summary on the Manage Client List page.
