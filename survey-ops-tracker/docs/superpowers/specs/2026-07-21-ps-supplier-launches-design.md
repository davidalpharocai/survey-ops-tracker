# PS Supplier Launches — Design

**Date:** 2026-07-21
**Status:** Approved (David), pending implementation
**Goal:** Let a Pure Spectrum (PS) project have **multiple launches**, mirroring how a B2B project has multiple blasts. Each launch is a self-contained set of supplier line items (supplier · $/complete (CPI) · cap · N collected) with its own **target N**. The project's estimated cost = the sum of every launch's estimate range.

---

## Background (current model)

Today a PS project has a **flat** list of `project_suppliers` rows: `(project_id, supplier_id, cpi, completes_cap, n_collected)`.
- **Actual cost** = Σ(cpi × n_collected) across the rows → fed into `survey_projects.actual_spend` by `recompute_project_spend` (migration 059).
- **Estimate** (before any completes) = ONE range = `internal_target × [min CPI … max CPI]`; per-supplier caps are non-additive ceilings on the one shared target pool.
- `SuppliersWidget` renders the single flat list; `lib/utils/suppliers.ts` holds the math; `useProjectSuppliers` the CRUD; `lib/server/clone.ts` copies suppliers on clone.

## New model — launches

A **launch** is a fielding wave. A project has 1..N launches; each launch owns a set of supplier rows plus a target N.

### Data model

**New table `project_launches`:**
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `project_id` | uuid | → `survey_projects(id)`, on delete cascade |
| `label` | text null | optional user label ("soft launch", "topped up sellers") |
| `launch_date` | date null | optional date the wave was fielded |
| `target` | int null | the launch's target # of completes (drives its estimate range) |
| `created_by` | text | |
| `created_at` | timestamptz default now() | launches ordered by this asc |

Display number ("Launch 1/2/3") is the **ordinal position** in the created_at-ordered list — no stored number (deleting a launch renumbers the display, which is fine for informal wave labels; `label` gives stable naming when it matters).

**`project_suppliers` gains `launch_id uuid`** → `project_launches(id)` **on delete cascade** (removing a launch removes its supplier rows). Nullable at the column level; the app always sets it on insert.

**Backfill (8 existing rows in prod):** for every project that has launch-less supplier rows, create one launch (target = `coalesce(n_internal_target, n_target)` of that project so the current estimate is preserved), then set those rows' `launch_id` to it. Existing `n_collected` values are untouched.

**Actual spend is UNCHANGED.** `recompute_project_spend` keeps summing `Σ(cpi × n_collected)` across *all* of a project's `project_suppliers` rows regardless of launch — launches are a grouping/estimate layer only. Cascade deletes of supplier rows still fire `sync_supplier_spend`, so removing a launch recomputes spend correctly. No trigger changes.

Migration number: **061_supplier_launches.sql** (manual-apply by David, held until run + REST-verified before code deploy).

### Math (`lib/utils/suppliers.ts`)

Keep existing per-row helpers. Add launch-aware helpers:
- **Per launch:** `estimateRange(launch.target, launch.lines)` (existing fn, now called per launch) → `{low, high}`; `actualCost(launch.lines)`, `totalCollected(launch.lines)`.
- **Project rollup:**
  - `projectEstimateRange(launches)` = `{ low: Σ launch.low, high: Σ launch.high }` (null if no priced launches).
  - `projectActualCost(launches)` = Σ `actualCost` over launches (== Σ(cpi × n_collected), reconciles to `actual_spend`).
  - `projectCollected` = Σ collected; `projectTarget` = Σ launch targets; `blendedActualCpi` = projectActual ÷ projectCollected.
- A launch shows its **Est. range** until it has any completes, then flips to **Actual cost** (same rule as the current whole-widget behavior, applied per launch).

### UI (`SuppliersWidget` + new `LaunchBlock`)

- `SuppliersWidget` fetches launches + their supplier rows, groups rows by `launch_id`, renders a **`LaunchBlock`** per launch.
- **`LaunchBlock`** header: **"Launch N"** + optional inline **date** + optional inline **label**, and a **✕** to remove the launch (confirm-free, cascade). Body: the supplier table (Supplier · $/complete · cap · N collected · ✕-row) exactly as today, plus a **target** input for the launch, an **add-supplier** dropdown + **new-supplier** inline + **Apply CPI to all** — all scoped to that launch. Footer of the block: the launch's Est. range or Actual cost.
- **`＋ Add launch`** button under the last block: creates a launch pre-filled by copying the previous launch's supplier rows (supplier_id + cpi + completes_cap), `n_collected` reset to 0, `target` blank, `launch_date` = today. First-ever launch on a project starts from the catalog (empty).
- **Card footer (project rollup):** Est. $ = `projectEstimateRange` (or Actual once any completes exist) · blended CPI · `projectCollected / projectTarget` · the existing `blended × N-actual` footnote. **Soft hint** if `projectTarget` ≠ project internal target (they can legitimately differ; not an error).
- The widget keeps its `nTarget` / `nInternalTarget` / `nActual` props (internal-target divergence hint + blended×N-actual footnote). It no longer uses the project target to compute the estimate — launches do.

### Hooks

- **New `useProjectLaunches(projectId)`** — fetch `project_launches` (ordered) and the project's `project_suppliers` (`*, suppliers(name)`), returned grouped, or returned separately and grouped in the widget. Plus `useAddLaunch`, `useUpdateLaunch` (label/date/target), `useRemoveLaunch`. Each invalidates `project-suppliers`/`project`/`projects` caches (spend can change on launch removal).
- **`useProjectSuppliers`**: `useAddProjectSupplier` gains a required `launch_id`.

### Clone (`lib/server/clone.ts`)

When `carry_suppliers`, copy the **launch structure**: recreate each source launch (label, target, launch_date → null/today per reset rules) on the new project, then copy its supplier rows (supplier_id, cpi, completes_cap) with `n_collected` reset to 0. Matches the existing "reset run-data" clone behavior.

### Types (`lib/supabase/types.ts`)

Add `project_launches` Row/Insert/Update; add `launch_id` to `project_suppliers` Row/Insert/Update.

## Out of scope

- **Connector / assistant:** no change — `get_project` doesn't surface suppliers/launches today, and there's no supplier write tool. (A future connector tool could add launches; not now.)
- **Actual-spend formula / hero budget / Insights:** unchanged.

## Testing

- `suppliers.test.ts`: extend with per-launch range + project rollup cases (sum of ranges; actual = Σ cpi×collected across launches; blended; est→actual flip).
- Typecheck + production build.
- Adversarial review (formula consistency, migration/backfill correctness, completeness sweep, UI/clone correctness) before shipping — same gate as the blast-completes change.
- Migration 061 applied by David, then REST-verified (table + `launch_id` column + backfilled rows) before the code is pushed.
