# Segmented N (multi-collection) — Design Spec

**Date:** 2026-06-18
**Status:** Approved design (mockup signed off) — ready for implementation plan

## Goal

Let a survey optionally split its N into **labeled segments**, each with its own Target / Collected / N Actual (e.g. Coatue's **Buyers** and **Sellers**). Default stays a single N (today's behavior, unchanged). Schema supports any number of segments; the **UI caps adds at 2 for now**.

## Core principle: the project total is the sum of its segments

When a project has segments, its existing project-level `n_target / n_collected / n_actual` are kept as the **sum of the segments**. Everything that already reads those fields — board card, list, pace alerts, daily digest, the compliance gate — keeps working unchanged on the total. Only the **project detail page** shows the per-segment breakdown.

## Data model

New table `public.project_segments`:
- `id uuid pk`
- `project_id uuid not null references survey_projects(id) on delete cascade`
- `label text not null` (free text — "Buyers", "Sellers", …)
- `n_target integer`
- `n_collected integer not null default 0`
- `n_actual integer`
- `sort_order integer not null default 0`
- `created_at timestamptz default now()`
- index on `(project_id, sort_order)`

**Keeping the parent total in sync (DB trigger):** an `after insert/update/delete` trigger on `project_segments` recomputes the parent row:
- `n_target = sum(segment.n_target)`, `n_collected = sum(segment.n_collected)`, `n_actual = sum(segment.n_actual)` (nulls treated as 0; if every segment's actual is null, parent actual stays null).
- When the **last** segment row for a project is deleted, the parent values are left as they were (the project reverts to manual single-N editing).

This makes the trigger the single source of truth — the totals are always correct no matter who writes a segment (UI, script, future sync).

A project is **"segmented"** when it has ≥1 segment row (the Split action always creates 2 at once, since one segment is just a relabeled total).

**RLS:** mirror the other project-child tables — analyst full access (`my_role() = 'analyst'`), no anon, service role full. Compliance reviewers get nothing (segments are internal).

## UI

**Detail page (the N tile):**
- **Unsegmented (default):** the current single "N collected X / Y" tile, plus a **"＋ Split into segments"** control.
- **Split:** the **total** "N collected (total) X / Y" with the overall bar, then one editable row per segment — `label` (text input) + collected / target (+ N Actual) — each with a mini progress bar. An **"＋ Add segment"** (disabled at 2) and a remove (×) per segment. Removing down to 0 segments collapses back to the single-N tile.
- Splitting seeds the first two segments from the current parent values (e.g. one segment carrying the existing N, one empty) so no data is lost; labels start blank with a placeholder.

**Board card / list:** unchanged — show the **total**, with a small "2 segments" hint chip on the card and (optionally) in the list N/Target cell. No per-segment detail on these dense surfaces.

**N Actual / Sample card:** when segmented, N Actual is the sum; the breakdown lives with the segment rows on the detail page.

## Behavior

- Gate, pace alerts, digest, exports operate on the **total** (v1). Per-segment pace is a possible later enhancement.
- CSV export: include a `segments` summary column (e.g. `"Buyers 27/30; Sellers 14/20"`) so the breakdown isn't lost on export. (Nice-to-have; confirm in plan.)

## Out of scope (v1)

- More than 2 segments in the UI (schema already supports it; raise the cap later).
- Per-segment pace/overdue logic.
- Segment-level compliance or survey-IDs.

## Open question

- **Editing the total directly when segmented:** the total becomes read-only (derived) and is edited via the segments. Confirm that's acceptable (vs. allowing a manual total override). Recommended: read-only total when segmented.
