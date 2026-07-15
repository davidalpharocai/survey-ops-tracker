# Bids/Blasts Rework — Design Spec (Suppliers for PS, Blast Configuration for B2B)

**Date:** 2026-07-15
**Status:** Approved (brainstorm) — pending spec review → implementation plan
**Author:** David + Claude (feedback from Julia)

## Goal

Reshape the project **Money** section to mirror the Campaign Manager tool and split it by project type: **PS projects** (PureSpectrum consumer panel) get a **Suppliers** block — a multi-select of sample suppliers each with a **CPI** (cost per interview) and a **completes cap** — replacing today's single "$/bid budget" change-log. **B2B projects** (expert panel, fielded via email/SMS blasts) get a **Blast Configuration** with a create-then-send lifecycle, a per-respondent **reward** incentive, and a **schedule time**.

## Context (why this shape)

- **"PS" = PureSpectrum**, a consumer-panel aggregator that routes fielding to underlying **sample suppliers** (Branded Research, DISQO, Fusion, Prime Insights API, …), each priced at its own **CPI** and capped at N completes. That's what the Campaign Manager "Suppliers" screen configures — hence a PS project's money model is per-supplier, not a single bid.
- **"B2B" = expert/business panel**, fielded via **blasts** (email/SMS sends) with a respondent **reward/incentive**.
- **Campaign Manager is a separate external app** (AWS Amplify) whose UX we're mirroring — SOCC does **not** integrate with it or send anything; SOCC records the setup/state for tracking.
- Today all three money widgets (`BudgetWidget`, `BidBudgetWidget`, `BlastsWidget`) render unconditionally in one "Money" sidebar card; no PS/B2B conditional exists yet (only `Internal` early-returns to a different view).

## Scope

**In scope**
- Conditional Money section by `project_type`: PS → Suppliers, B2B → Blast Configuration, shared Total-budget card for both.
- New suppliers data model (catalog + per-project junction) + PS Suppliers UI.
- B2B blast create-then-send lifecycle + reward + schedule; reward counted as spend.
- Remove the PS `$/bid` change-log surface.

**Non-goals**
- No actual sending/dispatch (SOCC records state; Campaign Manager sends).
- No per-supplier completes tracking (SOCC only has **total** N Collected from PureSpectrum) — so PS spend math stays estimate-only.
- No Campaign Manager API integration.
- Not dropping the `project_bids` table (left dormant — no destructive migration, no lost history).

## Decisions (from brainstorm)

1. **PS Suppliers = config + estimate.** Store suppliers + CPI + cap; show **estimated cost = Σ(cap × CPI)** and **blended CPI = Σ(cap×CPI) / Σcap**. Does **not** touch the real Actual $ / Budget-used (those keep flowing from `actual_spend` as today).
2. **B2B = create-then-send lifecycle** (`queued → scheduled → sent`). Create with reward + $/bid + optional schedule (empty ⇒ queued); fill delivered + fee when marked **sent**. SOCC tracks state only.
3. **Reward is real spend.** `actual_spend` for a **sent** blast = `delivered × $/bid + blast_fee + reward × delivered`.
4. **Suppliers catalog** is global, seeded with the 4 common, and any **analyst** can add more (inline).
5. **"Apply CPI to all"** bulk-sets the typed CPI onto every selected supplier's row (each still overridable).
6. **Cap** is a **soft** over-cap warning, not a hard block.
7. **Rerun / null project_type**: show **both** blocks (they don't map cleanly to PS or B2B). Minor; revisit if noisy.

## Data model (migration 054)

**`suppliers`** — global catalog:
```
id uuid pk default gen_random_uuid(), name text not null unique, active boolean not null default true,
created_by text, created_at timestamptz not null default now()
```
Seed: Branded Research, DISQO, Fusion, Prime Insights API. RLS: analyst read/write + service_role (mirrors existing money-table policies). No project scope.

**`project_suppliers`** — per-project selection (junction):
```
id uuid pk, project_id uuid not null references survey_projects on delete cascade,
supplier_id uuid not null references suppliers, cpi numeric(10,2) not null default 0,
completes_cap integer not null default 1000, created_by text, created_at timestamptz default now(),
unique (project_id, supplier_id)
```
RLS analyst + service_role. Audit trigger writing `project_audit` (`supplier_added / supplier_removed / supplier_changed`), following the `audit_project_blast` pattern.

**`project_blasts`** — add lifecycle + incentive:
```
alter add column reward       numeric(10,2) not null default 0   -- per-respondent incentive
alter add column scheduled_at timestamptz                        -- null ⇒ queued
alter add column status       text not null default 'sent'       -- 'queued' | 'scheduled' | 'sent'
```
- `status` default `'sent'` so existing rows (all historical, already delivered) remain counted with no backfill.
- `delivered`/`bid`/`blast_cost` stay; for a new queued/scheduled blast they start 0 and are filled on send.

**`sync_blast_spend` trigger — new formula:** `actual_spend = Σ over blasts WHERE status='sent' of (delivered*bid + blast_cost + reward*delivered)`. Only **sent** blasts count, so queued/scheduled ones contribute nothing until sent. Keeps `actual_spend` the single shared number for hero tile / Insights / Client / CSV / MCP.

**`audit_project_blast` trigger:** extend the audit string to include status transitions + reward (so the Audit Log reads sensibly).

## PS Suppliers block (UI)

- Multi-select of catalog suppliers (chips), with an inline **"+ add supplier"** that inserts into the catalog.
- One row per selected supplier: name · **CPI $** input · **completes cap** input (default 1000). Remove (×) per row.
- **"Apply CPI to all"**: a CPI input + button that bulk-sets every selected row's CPI.
- Footer: **Estimated cost** = Σ(cap × CPI), **blended CPI**, total capped completes = Σcap. A soft ⚠ if a supplier's cap pushes Σcap past N Target (informational).
- Hooks: `useProjectSuppliers(projectId)` (read + add/update/remove), `useSuppliers()` (catalog + add). Graceful "needs the latest migration" empty state like the other money widgets.
- Component: `components/project/SuppliersWidget.tsx`; math in `lib/utils/suppliers.ts` (estimatedCost, blendedCpi) — pure + unit-tested.

## B2B Blast Configuration (UI)

- **Create** form (mirrors screenshot): Reward Amount (optional, per respondent) · Schedule Time (ET; empty ⇒ queued) · Create Blast. Also $/bid for the send.
- **List** of blasts with status chips (queued / scheduled / sent). A queued/scheduled row shows **Mark sent** → reveals delivered + fee inputs; on save, status→sent and it starts counting toward spend.
- Footer totals reflect **sent** blasts (total delivered, incentive $, blast $, Total bid $, cost/complete).
- Reworks the existing `BlastsWidget` into `BlastConfigWidget` (or renames); drops the `$/bid` **cap / over-cap** coupling (that was the PS bid-budget concept, now gone).
- `lib/utils/blast.ts`: spend/total helpers updated to include `reward × delivered` and to sum **sent** blasts only. `useProjectBlasts` gains status/reward/schedule fields.

## Removed / deprecated

- `components/project/BidBudgetWidget.tsx`, `lib/hooks/useBidBudget.ts` — deleted.
- MCP `set_bid_budget` tool + `mcp_set_bid_budget` RPC + `runSetBidBudget` — removed (and drop from the connector tool list).
- `bid_added / bid_changed / bid_removed` handling in `lib/utils/auditFormat.ts`.
- `BlastsWidget`'s cap/auto-fill/over-cap logic (no bid budget to cap against).
- `project_bids` **table left dormant** (not dropped) — no data loss, no destructive migration; its `audit_project_bid` trigger can stay (harmless) or be dropped in a later cleanup.

## Conditional rendering

In the "Money" `SidebarCard` (`app/(app)/projects/[id]/page.tsx`), keep `BudgetWidget` (Total budget + Actual $) for all types, then branch:
- `project_type === 'PS'` → `<SuppliersWidget>`
- `project_type === 'B2B'` → `<BlastConfigWidget>`
- `'Rerun'` or `null` → show **both** (non-destructive; edit-type resolves it)
- `'Internal'` never reaches here (early-return to `InternalProjectView`).

The "＋ Add cost line (coming soon)" placeholder stays.

## MCP / connector

- Remove `set_bid_budget`.
- `log_blast` / `mcp_log_blast` keep working: they create a **sent** blast (status defaults to 'sent'); extend the RPC to accept an optional `reward` (default 0) so connector-logged blasts count incentives too. Keep the `(project_id, idem_key)` idempotency.

## Testing

- **Unit (pure):** `lib/utils/suppliers.ts` (estimatedCost, blendedCpi incl. zero/empty), `lib/utils/blast.ts` (new spend formula: reward×delivered, sent-only summation, backward-compat with status='sent' default).
- **Trigger behavior:** verify (via a scratch check after migration) that inserting a queued blast doesn't change `actual_spend`, and marking it sent with delivered+reward does.
- **UI smoke:** PS project shows Suppliers (not Blasts); B2B shows Blast Config; create-queued → mark-sent flow; "apply CPI to all"; estimated cost recompute.

## Open / future
- Per-supplier completes (if PureSpectrum ever exposes them) → real per-supplier actual spend.
- Rerun money-model inheritance from parent (currently shows both).
- Eventually drop the dormant `project_bids` table in a cleanup migration.
