# Bids/Blasts Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Split the project Money section by type — PS → **Suppliers** (catalog + per-project CPI/cap, estimate-only), B2B → **Blast Configuration** (create-then-send lifecycle, reward counted as spend) — replacing the PS `$/bid` change-log.

**Architecture:** New `suppliers` catalog + `project_suppliers` junction; `project_blasts` gains `reward`/`scheduled_at`/`status`; the `sync_blast_spend` trigger becomes sent-only + incentive-aware so the shared `actual_spend` stays correct. The Money card branches on `project_type`. Pure math lives in `lib/utils/{suppliers,blast}.ts` (unit-tested); React-Query hooks + widgets follow existing patterns.

**Tech Stack:** Next.js 15, Supabase (PostgREST + triggers), React Query, TypeScript, Vitest. Reference spec: `docs/superpowers/specs/2026-07-15-bids-blasts-rework-design.md`.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/054_suppliers_and_blast_config.sql` | suppliers + project_suppliers + blast columns + updated triggers |
| Modify | `lib/supabase/types.ts` | new tables + project_blasts columns |
| Create | `lib/utils/suppliers.ts` (+ `.test.ts`) | estimatedCost / blendedCpi / totalCappedCompletes |
| Modify | `lib/utils/blast.ts` (+ `.test.ts`) | reward in blastTotal; sent-only totals; totalIncentives |
| Create | `lib/hooks/useSuppliers.ts` | catalog read + add |
| Create | `lib/hooks/useProjectSuppliers.ts` | junction read + add/update/remove |
| Modify | `lib/hooks/useProjectBlasts.ts` | status/reward/scheduled_at fields + markSent |
| Create | `components/project/SuppliersWidget.tsx` | PS suppliers UI |
| Modify→rename | `components/project/BlastsWidget.tsx` → `BlastConfigWidget.tsx` | B2B lifecycle UI |
| Delete | `components/project/BidBudgetWidget.tsx`, `lib/hooks/useBidBudget.ts` | PS $/bid log removed |
| Modify | `app/(app)/projects/[id]/page.tsx` | Money card conditional by project_type |
| Modify | `lib/utils/auditFormat.ts` | drop `bid_*`; add `supplier_*` + blast status labels |
| Modify | `lib/mcp/writes.ts`, `app/api/mcp/route.ts`, MCP tool list | remove `set_bid_budget`; `log_blast` gains optional `reward`, status='sent' |
| Modify | `USER_GUIDE.md` | Money section note |

---

## Task 1: Migration 054 + types

**Files:** Create `supabase/migrations/054_suppliers_and_blast_config.sql`; Modify `lib/supabase/types.ts`.

- [ ] **Step 1: Write the migration** (complete):

```sql
-- 054_suppliers_and_blast_config.sql — PS Suppliers model + B2B blast lifecycle.
-- Adds a global suppliers catalog + per-project supplier CPI/cap (PS planning),
-- and blast reward/schedule/status (B2B create-then-send). Rewires actual_spend to
-- count only SENT blasts and include the incentive. Applied manually by David.
begin;

-- 1) Global suppliers catalog (PureSpectrum sample suppliers). Analyst-editable.
create table if not exists public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;
revoke all on public.suppliers from anon, authenticated;
grant select, insert, update on public.suppliers to authenticated;
grant all on public.suppliers to service_role;
drop policy if exists suppliers_analyst_rw on public.suppliers;
create policy suppliers_analyst_rw on public.suppliers for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists suppliers_service_all on public.suppliers;
create policy suppliers_service_all on public.suppliers for all to service_role using (true) with check (true);
insert into public.suppliers (name) values
  ('Branded Research'), ('DISQO'), ('Fusion'), ('Prime Insights API')
  on conflict (name) do nothing;

-- 2) Per-project supplier selection with CPI + completes cap.
create table if not exists public.project_suppliers (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.survey_projects(id) on delete cascade,
  supplier_id   uuid not null references public.suppliers(id),
  cpi           numeric(10,2) not null default 0,
  completes_cap integer not null default 1000,
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (project_id, supplier_id)
);
alter table public.project_suppliers enable row level security;
revoke all on public.project_suppliers from anon, authenticated;
grant select, insert, update, delete on public.project_suppliers to authenticated;
grant all on public.project_suppliers to service_role;
drop policy if exists project_suppliers_analyst_rw on public.project_suppliers;
create policy project_suppliers_analyst_rw on public.project_suppliers for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
drop policy if exists project_suppliers_service_all on public.project_suppliers;
create policy project_suppliers_service_all on public.project_suppliers for all to service_role using (true) with check (true);
create index if not exists project_suppliers_project_idx on public.project_suppliers (project_id);

-- audit: supplier_added / supplier_changed / supplier_removed (mirrors audit_project_blast)
create or replace function public.audit_project_supplier() returns trigger language plpgsql security definer
set search_path = public as $$
declare pid uuid; sname text; act text; detail text;
begin
  pid := coalesce(new.project_id, old.project_id);
  select name into sname from public.suppliers where id = coalesce(new.supplier_id, old.supplier_id);
  if tg_op = 'INSERT' then act := 'supplier_added'; detail := sname || ' @ $' || new.cpi || ' cap ' || new.completes_cap;
  elsif tg_op = 'DELETE' then act := 'supplier_removed'; detail := sname;
  else act := 'supplier_changed'; detail := sname || ' @ $' || new.cpi || ' cap ' || new.completes_cap;
  end if;
  insert into public.project_audit (project_id, field, new_value, changed_by)
    values (pid, act, detail, coalesce(auth.email(), 'system'));
  return coalesce(new, old);
end $$;
drop trigger if exists trg_audit_project_supplier on public.project_suppliers;
create trigger trg_audit_project_supplier after insert or update or delete on public.project_suppliers
  for each row execute function public.audit_project_supplier();

-- 3) Blast lifecycle + incentive.
alter table public.project_blasts add column if not exists reward       numeric(10,2) not null default 0;
alter table public.project_blasts add column if not exists scheduled_at timestamptz;
alter table public.project_blasts add column if not exists status       text not null default 'sent';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_blasts_status_chk') then
    alter table public.project_blasts add constraint project_blasts_status_chk
      check (status in ('queued','scheduled','sent'));
  end if;
end $$;

-- 4) Spend = SENT blasts only, now including the per-respondent incentive.
create or replace function public.sync_blast_spend() returns trigger language plpgsql security definer
set search_path = public as $$
declare pid uuid;
begin
  pid := coalesce(new.project_id, old.project_id);
  update public.survey_projects set actual_spend = coalesce((
    select sum(delivered * bid + blast_cost + delivered * reward)
    from public.project_blasts where project_id = pid and status = 'sent'
  ), 0) where id = pid;
  return null;
end $$;

commit;
```

- [ ] **Step 2: types.ts** — add `suppliers` + `project_suppliers` table types (Row/Insert/Update), and add `reward: number`, `scheduled_at: string | null`, `status: string` to `project_blasts` Row (+ optional in Insert/Update). Mirror existing table type shapes.
- [ ] **Step 3: Commit** `feat(bids-blasts): migration 054 suppliers + blast lifecycle + spend trigger`. (David runs it before this ships.)

---

## Task 2: Pure math — `suppliers.ts` + `blast.ts` (TDD)

**Files:** Create `lib/utils/suppliers.ts` + `.test.ts`; Modify `lib/utils/blast.ts` + create/extend `blast.test.ts`.

- [ ] **Step 1: `lib/utils/suppliers.ts`:**

```ts
export interface SupplierLine { cpi: number; completes_cap: number }
/** Max spend if every supplier fills its cap = Σ(cap × CPI). */
export function estimatedCost(rows: SupplierLine[]): number {
  return rows.reduce((s, r) => s + (r.cpi || 0) * (r.completes_cap || 0), 0)
}
/** Σ completes cap across suppliers. */
export function totalCappedCompletes(rows: SupplierLine[]): number {
  return rows.reduce((s, r) => s + (r.completes_cap || 0), 0)
}
/** Cap-weighted CPI = estimatedCost / Σcap; null if no caps. */
export function blendedCpi(rows: SupplierLine[]): number | null {
  const caps = totalCappedCompletes(rows)
  return caps > 0 ? estimatedCost(rows) / caps : null
}
```

- [ ] **Step 2: `lib/utils/blast.ts`** — reward in the per-blast total, and every money total sums **sent** blasts only:

```ts
import type { Tables } from '@/lib/supabase/types'
export type Blast = Tables<'project_blasts'>
export const isSent = (b: Pick<Blast, 'status'>) => b.status === 'sent'

/** Cost of one blast = delivered×$/bid + fixed fee + delivered×reward. */
export function blastTotal(b: Pick<Blast, 'delivered' | 'bid' | 'blast_cost' | 'reward'>): number {
  const d = b.delivered ?? 0
  return d * (b.bid ?? 0) + (b.blast_cost ?? 0) + d * (b.reward ?? 0)
}
const sent = (blasts: Blast[]) => blasts.filter(isSent)
export function totalBidDollars(blasts: Blast[]): number { return sent(blasts).reduce((s, b) => s + blastTotal(b), 0) }
export function totalDelivered(blasts: Blast[]): number { return sent(blasts).reduce((s, b) => s + (b.delivered ?? 0), 0) }
export function totalBlastFees(blasts: Blast[]): number { return sent(blasts).reduce((s, b) => s + (b.blast_cost ?? 0), 0) }
export function totalIncentives(blasts: Blast[]): number { return sent(blasts).reduce((s, b) => s + (b.delivered ?? 0) * (b.reward ?? 0), 0) }
export function weightedAvgBid(blasts: Blast[]): number | null {
  const d = totalDelivered(blasts); if (d <= 0) return null
  return sent(blasts).reduce((s, b) => s + (b.bid ?? 0) * (b.delivered ?? 0), 0) / d
}
export function avgBid(blasts: Blast[]): number | null {
  const s = sent(blasts); if (s.length === 0) return null
  return s.reduce((sum, b) => sum + (b.bid ?? 0), 0) / s.length
}
export function costPerN(totalBid: number, nCollected: number): number | null { return nCollected > 0 ? totalBid / nCollected : null }
```

- [ ] **Step 3: tests** — `suppliers.test.ts`: estimatedCost/blendedCpi/totalCappedCompletes incl. empty + zero caps. `blast.test.ts`: `blastTotal` includes reward×delivered; totals ignore non-sent blasts (a queued blast with delivered/reward set adds 0); `totalIncentives`; weighted/avg over sent only. Run `npx vitest run lib/utils`. **Commit.**

---

## Task 3: Suppliers hooks + widget

**Files:** Create `lib/hooks/useSuppliers.ts`, `lib/hooks/useProjectSuppliers.ts`, `components/project/SuppliersWidget.tsx`.

- [ ] **Step 1: `useSuppliers.ts`** — `useSuppliers()` reads `suppliers` (active, name asc, graceful `[]` on 42P01); `useAddSupplier()` inserts `{ name, created_by }` (invalidate `['suppliers']`).
- [ ] **Step 2: `useProjectSuppliers.ts`** — `useProjectSuppliers(projectId)` reads `project_suppliers` joined to `suppliers(name)`; `useAddProjectSupplier` / `useUpdateProjectSupplier` (cpi, completes_cap) / `useRemoveProjectSupplier`. All invalidate `['project-suppliers', projectId]`. Follow `useProjectBlasts.ts` shape.
- [ ] **Step 3: `SuppliersWidget.tsx`** (structure mirrors `BidBudgetWidget`/`BlastsWidget` styling; `isError` → "needs the latest database migration"):
  - Header "Suppliers" + InfoTooltip ("PureSpectrum sample suppliers; each with a CPI (cost per interview) and completes cap. Estimated cost = Σ cap × CPI.").
  - A supplier picker (`<select>` of catalog suppliers not yet added; plus an inline "+ new" text input calling `useAddSupplier` then adding it).
  - One row per `project_suppliers` entry: name · CPI $ input (onBlur → update) · completes-cap input · ✕ remove. Amber hint if `Σcap > n_target`.
  - "Apply CPI to all": a CPI input + button → bulk `useUpdateProjectSupplier` for every row.
  - Footer: `Estimated cost` = `estimatedCost(rows)`, `blended CPI` = `blendedCpi(rows)`, `Σ cap` = `totalCappedCompletes(rows)`.
- [ ] **Step 4:** `npx next build`. **Commit** `feat(bids-blasts): PS Suppliers block (catalog + per-project CPI/cap + estimate)`.

---

## Task 4: Blast Configuration widget (lifecycle)

**Files:** Modify `lib/hooks/useProjectBlasts.ts`; rename `BlastsWidget.tsx` → `BlastConfigWidget.tsx`.

- [ ] **Step 1: `useProjectBlasts.ts`** — Blast type now includes reward/scheduled_at/status. `useAddBlast` accepts `{ bid, reward, scheduled_at, status }` (delivered/blast_cost default 0 for a new queued/scheduled blast). Add `useMarkBlastSent(projectId)` → update `{ status: 'sent', delivered, blast_cost }`. Keep invalidations (`['blasts']`, `['project']`, `['projects']`).
- [ ] **Step 2: `BlastConfigWidget.tsx`** — reworked from `BlastsWidget`:
  - Drop `useBidBudget`/cap/over-cap entirely.
  - **Create form** (mirrors screenshot): Reward Amount (optional) · $/bid · Schedule Time (`<input type="datetime-local">`, ET) · **Create Blast**. Status = `scheduled` if a time is set, else `queued`. Helper: "Leave schedule empty to create as queued (manual send)."
  - **List**: each blast shows a status chip (queued/scheduled/sent) + reward + $/bid. queued/scheduled rows show **Mark sent** → inline delivered + blast-fee inputs → `useMarkBlastSent`. sent rows show delivered · $/bid · fee · incentive · total (`blastTotal`), editable/deletable.
  - **Footer** (sent only): total delivered, incentives `totalIncentives`, blast fees, **Total spend** `totalBidDollars`, wtd/avg $/bid.
- [ ] **Step 3:** `npx next build`. **Commit** `feat(bids-blasts): B2B Blast Configuration lifecycle (queued/scheduled/sent + reward)`.

---

## Task 5: Money card conditional + removals

**Files:** Modify `app/(app)/projects/[id]/page.tsx`; Delete `BidBudgetWidget.tsx` + `useBidBudget.ts`; Modify `auditFormat.ts`.

- [ ] **Step 1: page.tsx** — in the "Money" `SidebarCard`, keep `<BudgetWidget>`, then branch:
  ```tsx
  {project.project_type === 'PS' && <SuppliersWidget projectId={project.id} nTarget={project.n_target} />}
  {project.project_type === 'B2B' && <BlastConfigWidget projectId={project.id} />}
  {(project.project_type === 'Rerun' || project.project_type == null) && (<><SuppliersWidget projectId={project.id} nTarget={project.n_target} /><BlastConfigWidget projectId={project.id} /></>)}
  ```
  Remove the `<BidBudgetWidget>` import + render. Keep the "＋ Add cost line" placeholder.
- [ ] **Step 2: Delete** `components/project/BidBudgetWidget.tsx` and `lib/hooks/useBidBudget.ts`. Grep to confirm no remaining imports.
- [ ] **Step 3: auditFormat.ts** — remove `bid_added/bid_changed/bid_removed` from the MONEY set; add `supplier_added/supplier_changed/supplier_removed` + (optional) blast status labels.
- [ ] **Step 4:** `npx next build`. **Commit** `feat(bids-blasts): conditional Money section by project_type; remove PS $/bid log`.

---

## Task 6: MCP cleanup

**Files:** Modify `lib/mcp/writes.ts`, `app/api/mcp/route.ts` (+ tool list), `supabase/migrations` note.

- [ ] **Step 1:** Remove the `set_bid_budget` tool definition + handler (`route.ts:702-740`) and `runSetBidBudget` (`writes.ts`); drop it from the connector tool list/spec. Leave the `mcp_set_bid_budget` RPC in the DB (dormant) — note in the migration comment; no need to drop.
- [ ] **Step 2:** `log_blast` / `mcp_log_blast` — add an optional `reward` param (default 0); logged blasts get `status='sent'` (the column default), so they count immediately. Keep `(project_id, idem_key)` idempotency.
- [ ] **Step 3:** `npx next build` + `npx vitest run`. **Commit** `feat(bids-blasts): MCP — drop set_bid_budget, log_blast gains reward`.

---

## Task 7: Docs + final review + ship

- [ ] **Step 1: USER_GUIDE** — update the Money description: PS projects show Suppliers (CPI + cap, estimated cost); B2B show Blast Configuration (reward + schedule, create→send); incentives count toward spend.
- [ ] **Step 2:** Adversarial review (workflow) over the diff — dimensions: SQL/trigger correctness + spend parity (client `totalBidDollars` vs the DB trigger must agree), suppliers RLS/audit, blast lifecycle edge cases (queued with delivered 0; mark-sent; delete), conditional rendering (Rerun/null/type-change), removal completeness (no dangling `useBidBudget`/`set_bid_budget` refs). Fix confirmed findings.
- [ ] **Step 3:** `npx next build` + `npx vitest run` green. Rebase onto `origin/main`, push. Ships behind **migration 054** (David runs it; until then the widgets show the graceful "needs the latest migration" state and the Money card still renders BudgetWidget).

---

## Self-Review notes
- **Spend parity:** the client `totalBidDollars` (sent-only + reward) MUST match the DB `sync_blast_spend` formula (`Σ status='sent' delivered*bid+blast_cost+delivered*reward`) — both updated in lockstep (Tasks 1 & 2).
- **Backward compat:** `status` defaults to `'sent'`, so existing blasts keep counting with no backfill; PS projects simply have no blasts (Actual $ stays as-is).
- **No placeholders:** migration + pure utils are complete; widgets specced against the existing `BlastsWidget`/`BidBudgetWidget` templates with all new logic given.
- **Type consistency:** `SupplierLine {cpi, completes_cap}` used by suppliers.ts + widget; `Blast` gains status/reward/scheduled_at used identically in blast.ts, hook, and widget.
```
