# Longitudinal Auto-Rerun — Design Spec

**Date:** 2026-06-18
**Status:** Approved design (one-shot for v1) — ready for implementation plan

## Goal

For longitudinal surveys, automate the painful part of running the next wave: a daily job **spawns a copy a week before a "rerun date,"** carrying the setup over, resetting the run data, numbering it (`[base] - 2nd Rerun`, then 3rd…), and linking the waves as a series. The copy lands in **Submitted** for the captain to review/launch. This automates what Sree tracks by hand in the sheet's "Manual Rerun" tab.

**v1 is one-shot** (each wave's next date is set explicitly by a human). A recurring **cadence** that auto-fills the next date is a deliberate fast-follow (see Out of scope) — chosen this way because the real workflow is cadence-*informed* but human-controlled (studies end irregularly: "one more month", "CLOSED").

## Data model (new columns on `survey_projects`)

- `rerun_date date` — when the next wave should run. Setting it (on a longitudinal project) arms the spawn.
- `rerun_number integer not null default 1` — this wave's number (the original is 1; first spawn is 2).
- `rerun_series_id uuid` — shared across all waves of a study (the original's id, set on first spawn). Lets the app group/show the series.
- `rerun_spawned_at timestamptz` — idempotency: stamped when *this* project's next wave has been spawned, so the cron never double-creates.

## The spawn job (daily Vercel cron)

New route `app/api/cron/spawn-reruns/route.ts` (same `CRON_SECRET` auth + `system_events` logging as the other crons; added to `vercel.json`). Each run:

1. Select projects where `longitudinal = true`, `rerun_date is not null`, `rerun_date <= today + 7 days`, `rerun_spawned_at is null`, `deleted_at is null`, `status <> 'Closed'`.
2. For each, **insert a copy** that:
   - **Carries over:** client, captain_id, co_captain_ids, salesperson, n_target, audience_size, linked_documents, longitudinal=true (so it can rerun again), voter_survey_qa, citation_language_needed, row_level_data, compliance_override. `project_type = 'Rerun'`.
   - **Resets the run:** status='Open', phase='Active', board_column='Submitted', all `stage_* = false`, n_collected=0, n_actual=null, survey_tool_id=null, submitted_date=today, launch_date/due_date/deliver_date=null (captain sets on review). `rerun_date=null` (one-shot — human sets the next), `rerun_spawned_at=null` (so the copy can spawn its own next wave later).
   - **Series + numbering:** `rerun_series_id = source.rerun_series_id ?? source.id`; `rerun_number = source.rerun_number + 1`; `project_name = baseName(source) + ' - ' + ordinal(rerun_number) + ' Rerun'` where `baseName` strips any existing ` - Nth Rerun` suffix so it never compounds. (`ordinal`: 2→"2nd", 3→"3rd", 4→"4th"…)
   - PR code auto-assigned by the existing 027 trigger; client_id by the sync trigger; `(created)` audit row by the audit trigger.
3. Stamp the **source** `rerun_spawned_at = now()`.
4. **Surface it:** log a `system_events` row and add a "🔁 New rerun spawned" line to the **daily digest** (and the captain is on the project's notify path). The wave sits in Submitted, so a human confirms before it's fielded.

## UI

- **Project detail page** (longitudinal projects): a **"Rerun date"** field (date) + a read-only **"Wave N · part of a rerun series"** indicator with a link to the other waves (filter by `rerun_series_id`). When `rerun_spawned_at` is set, show "Next wave created →" linking to the copy.
- **No board/list changes** beyond the existing Rerun type chip.

## Out of scope (v1) — the fast-follow

- **Cadence:** an optional `rerun_cadence` (e.g. monthly / quarterly / every N weeks) that, on spawn, pre-fills the copy's `rerun_date` (advancing by the cadence) so the series self-perpetuates — with each wave still landing in Submitted and the date adjustable/clearable (the off-switch). Deferred so we can resolve the "unactioned waves pile up in Submitted" question against real usage (e.g. only auto-advance once a wave has actually launched).
- A dedicated rerun-series view.

## Open questions

- **Eligibility:** should a wave spawn regardless of the source's status (as long as it's not Closed), or only once the source has been Delivered? Recommended: spawn on the date regardless (the source may still be wrapping up); the copy is in Submitted anyway.
- **Lead time:** 7 days fixed for v1, or a setting? Recommended: fixed 7 days now.
