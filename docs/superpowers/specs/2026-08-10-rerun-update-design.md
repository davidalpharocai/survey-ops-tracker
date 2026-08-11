# Rerun Update — Design Spec

**Date:** 2026-08-10
**Source of requirements:** `Reruns 2026.08.10.docx` (David's instructions) + the `Rerun_DS` tab of `Survey Ops (7).xlsx` (one-time field/data reference — NOT an ongoing feed).
**Status:** Design approved in brainstorming; pending written-spec review before planning.

---

## 1. Goal

Make reruns first-class in the Command Center: a recurring survey is represented by one **Rerun Series** record that owns its cadence, template, and the default values future waves inherit, and that spawns each **wave** as a normal project. The team (Sree) can see every wave scheduled each month so none are missed, waves are fully editable without disturbing each other, and the app — not the sheet — becomes the source of truth for reruns going forward.

## 2. Definitions (these are distinct)

- **Rerun** — a survey placed (manually to start, automatically thereafter) into **"rerun service"** to collect N for the next wave/run on a cadence.
- **Longitudinal** — a survey whose data is collected and tracked over time. This is *independent* of rerun service. Today the `longitudinal` flag drives auto-rerun; after this update, auto-spawning keys off **rerun-service membership**, and `longitudinal` goes back to meaning only "data tracked over time."

## 3. Architecture (approved)

A recurring survey = **one first-class `rerun_series` record** (visible/editable, POC approved) that spawns each wave as a normal `survey_projects` row linked back to it.

- Edit the **series** → changes apply to **future** waves only.
- Edit a **wave** → changes apply to **that wave only**, never to siblings or the series.

This supersedes the behind-the-scenes `rerun_meta` table (its cadence/owner/paused data migrates into `rerun_series`).

## 4. Data model

### 4.1 New table: `rerun_series`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `client_id` | uuid fk → clients | + denormalized `client` text for display parity |
| `survey_name` | text | e.g. "Consumer Study" |
| `base_type` | text check in ('B2B','PS') | the underlying survey type (see §5) |
| `cadence_months` | int null | 1/3/6/12; null = ad-hoc |
| `delivery_cadence` | text null | free text, e.g. "Beginning of month", "Mid-quarter" |
| `in_service` | bool not null default true | in rerun service? |
| `service_mode` | text check in ('auto','manual') default 'auto' | whether waves auto-spawn (default auto = "auto to continue") |
| `auto_armed` | bool not null default true | the seed sets this **false** so the first wave after the ~29-record load is manual; the first manual "Create next wave" (or a bulk "Arm") flips it true and auto runs thereafter (§18) |
| `template_id` | text null | source/template survey id(s) |
| `owner_email` | text | defaults to Sree |
| `paused` | bool not null default false | |
| `next_wave_no` | int | next wave number to assign (derived/maintained) |
| `future_defaults` | jsonb | see §7 |
| `notes` | text null | |
| `data_qa_note` | text null | mirrors Rerun_DS "DATA QA Note to self" |
| `created_at` / `updated_at` / `updated_by` | | |

RLS mirrors `rerun_meta` (analyst RW + service_role all).

### 4.2 Wave link on `survey_projects`
| Column | Type | Notes |
|---|---|---|
| `series_id` | uuid null fk → rerun_series | **NEW** column — a wave belongs to a series. Distinct from the pre-existing `rerun_series_id`, which keeps its legacy root-project-pointer meaning until the Phase-2 backfill. |
| `rerun_number` | int (existing) | the wave number — **REUSED as the single wave-number field**; the ordering utility (§6) writes it. There is NO new `wave_no` column (it read `rerun_number` all along, incl. the compliance waiver §9). |
| `wave_order` | int null | manual drag override; null → order by date |
| `compliance_required_override` | bool null | force compliance back on for a specific wave (§8/§9) |

`is_rerun` is **derived**: `series_id is not null OR rerun_series_id is not null` (covers new series waves and legacy lineage) — no stored duplicate.

### 4.3 Read model
Replace/extend the `rerun_status` view so `/reruns` reads from `rerun_series` (effective next date = last wave's fielding/rerun date + cadence; overdue / needs-definition flags preserved). Legacy `rerun_meta` is migrated then deprecated.

## 5. Type model (approved: separate flag, not an enum change)

- `project_type` enum stays `PS` / `B2B` (the value `Rerun` is retained only for legacy rows — see §12 — and is **not** used for new work).
- "Rerun" is a separate dimension: a wave is a rerun because it links to a series; the UI shows a **`Rerun` chip** alongside the `PS`/`B2B` badge.
- **Filters** (board + list, just shipped): keep the Type control at B2B/PS; add a separate **Rerun** filter (all / reruns only / non-reruns). Legacy `Rerun`-typed rows still match a "Rerun" option until backfilled.

## 6. Wave numbering + drag reorder

- Default order: by **fielding/rerun date** (ascending) → `rerun_number` = position (original = Wave 1).
- **Manual drag** on the waves list sets an explicit `wave_order` that **overrides** date order; on drop, the whole series renumbers and any wave whose name embeds its number updates too. (Generalizes today's lineage renumber.)
- A single ordering utility computes `rerun_number` from (`wave_order` if any, else date); every link/unlink/drag re-runs it. Self-heals gaps. **The drag handle is distinct from the legacy cross-series move gesture** (see §18) so reorder can't accidentally detach a wave.

## 7. Future-wave defaults (the quiet mechanism — approved)

A dedicated **"Defaults for future waves"** section on the series record (NOT per-field toggles scattered on each wave). Stored in `rerun_series.future_defaults` (jsonb): `n_target`, `audience`, `money_model` (PS suppliers / B2B blasts), `template_id`, `compliance_waived` (default true), `captain_id` (default Sree), `co_captain_ids`, and any other carried fields.

- Editing defaults affects **only waves created afterward**.
- Existing waves are never touched by a defaults edit.
- (Considered and rejected for now: a per-field "↳ apply to future too" toggle on each wave — noisier; may revisit as a secondary shortcut.)

## 8. What a newly-created wave inherits

| Field | New wave value |
|---|---|
| Client · survey name · base type (B2B/PS) | inherited from series |
| Captain | **Sree = primary**; original captain → **co-captain** (history) |
| N target · audience · money model · template | from `future_defaults` |
| Compliance | **waived** for wave ≥ 2 unless `compliance_required_override` is set |
| Fielding/rerun · due · delivery dates | advanced by the cadence from the prior wave |
| Survey ID | blank → assigned at programming |
| N collected · N actual · stage/status | reset — wave starts fresh at the first stage |
| Wave # | next in sequence |

All fields remain editable on the wave afterward without affecting siblings or the series.

**Child rows carry too:** PS suppliers/launches, B2B blast config, and multi-segment N are child tables (not scalar columns), so the new wave copies them from the prior wave via the shared `lib/server/clone.ts` (which already resets run-data), not just the scalar insert. **Co-captains:** the original (wave-1) captain is seeded into `co_captain_ids` **once at promotion** and carried verbatim to every wave, so the history never degrades to "Sree is her own co-captain."

## 9. Compliance

Reruns/waves after wave 1 (the original) **skip the compliance gate** by default. This is **not** a client exemption — the client's `compliance_before/after_fielding` flag stays and still governs the relationship and **Wave 1**. The reason later waves skip it: a rerun wave is the **same survey Wave 1 already got compliance-approved for**, so subsequent waves don't need re-approval (David, 2026-08-10). The **only** thing that re-requires review on a specific wave is `compliance_required_override = true` on that wave. Implemented in the pure `complianceGate` (`lib/utils/compliance.ts`) keyed off `(rerun_number ?? 1) >= 2` (waive) with the per-wave override winning, threaded through its 3 enforcement sites + the connector `advance_project` gate. The compliance banner/panel shows a positive "not required — rerun wave (override to force)" state so an absent gate never reads as a bug.

## 10. Captain

On wave creation: `captain` = the series' configured rerun captain (**Sree** by default), and the wave's original/source captain is added to `co_captain_ids` so history is retained. Configurable per series via `future_defaults.captain_id`.

## 11. Lifecycle

**Create a series (enter rerun service):**
- **Promote a project** — "Put into rerun service" action on any project → choose cadence + set defaults → that project becomes **Wave 1**, series created.
- **One-time seed** — import the ~29 active series from the `Rerun_DS` tab (reference only; §13).
- **Assistant/connector** — "put BAM Consumer Study into monthly rerun."

**Add a wave:**
- **Auto** (when `service_mode='auto'`) — cron spawns the next wave before its rerun date, applying §8 inheritance.
- **Manual now** — "Create next wave" on the series.
- **Link existing** — attach an already-created standalone project as a wave (renumbers).

Entering rerun service is a deliberate human action (or seed); the *recurring waves* are the automatic part.

**Stop a rerun from continuing** — two controls, on the series record (header/Actions) and via the assistant/connector, both reversible:
- **Pause** (temporary) — `paused = true`: auto-spawning stops, the series stays live and shows as *Paused*, off the "due this week" counts + weekly digest until **Resume**. For a client on hold or a skipped cycle.
- **End rerun service** (permanent) — `in_service = false`: out of rerun service entirely — no more waves, off the radar + digest for good; past waves and the record are retained for history; **Re-activate** later if the client comes back.

(`service_mode` = auto/manual still exists in the model as the spawn setting — auto-spawn vs. add-by-hand — but it is not a "stop" control; Pause and End are.)

Edge case: if a next wave has already been auto-created but not yet fielded when the series is paused/ended, the app asks whether to also cancel that pending wave (normal Cancel flow) or leave it.

**Numbering (confirmed):** waves default to date order; a manual drag saves an explicit order that overrides date order and sticks. New auto-created waves append at the end (newest = highest wave #).

## 12. Visibility (nothing missed)

On the **Reruns page** (one screen): a **month view** of every series' scheduled/overdue waves across all clients — this is the correct, portfolio-level home for the cross-client list (it must NOT appear on an individual series record). Preserves the existing overdue / needs-definition radar flags.

**Weekly Rerun Digest email (in scope):** every **Monday 8:00am ET** (configurable) a digest goes to **Sree (sreerag@alpharoc.ai)**, cc **David (david@alpharoc.ai)**, summarizing the week's rerun calendar in three cuts — **overdue / needs action**, **fielding this week**, **delivering this week** — each line showing client — survey, wave #, cadence, and date, with a link to the Reruns page. Subject line front-loads the counts. Sent via the app's existing transactional-email path (Resend/SendGrid) on a weekly cron. Recipients/day/time live in config so they can change without a deploy.

## 13. Data & rollout

- **Clean going forward.** The app is the rerun source of truth; the sheet's rerun tabs are retired for this purpose. `Rerun_DS` is a **one-time reference** to (a) confirm the field set and (b) seed the ~29 active series.
- **Dedup cross-check (required, thorough).** Before seeding/creating, match each candidate against recently-created `survey_projects` (by client + survey name + template id + date proximity). Surface each suspected duplicate to David for a **per-item decision** rather than guessing. Better to spend time here than create duplicate waves.
- **Historical backfill deferred** — re-typing legacy `Rerun`-typed projects to their real B2B/PS + linking old delivered waves into series is a later pass, per David.

## 14. Connector + in-app AI (full parity — ask, report, search)

Rerun data is integrated into both AI surfaces. Because the claude.ai connector and the ✦ in-app assistant share the tool registry (`lib/mcp/registry.ts`), every capability is defined once and available in both. Numbers are computed deterministically server-side (like the ✦ Summary) so the AI narrates exact figures, never invented ones.

- **Search / list** — find series and waves by client, survey name, template id, cadence, in-service, or owner; filter to overdue / due-this-week / due-this-month.
- **Ask** — grounded natural-language questions: *"what reruns are due this week?"*, *"which series are overdue?"*, *"when's the next BAM Consumer Study wave and what wave # is it?"*, *"how many waves has RP3 had and what were their N-actuals?"*
- **Report** — date-windowed rollups: the rerun calendar for a month/quarter, all monthly PS reruns, waves delivered last quarter for a client, series with no cadence defined, on-time vs. late rate.
- **Act** (confirm-before-write, as today) — put a project into rerun service (cadence + defaults), edit future-wave defaults, create / log / link a wave, pause/resume or end/re-activate a series, and generate the weekly digest on demand.

New/extended tools: `search_reruns`, `get_rerun_series`, `rerun_calendar` (report), `put_in_rerun_service`, `set_rerun_defaults`, `log_wave` / `link_wave`, plus the existing `rerun_radar` updated to read the new model.

## 15. Out of scope / deferred (Phase 2)

- **Reruns-page expand-in-place UX** — David's idea: the one screen shows a **details card** per series that you **click into or expand in place to see just its waves**. Deferred polish once the model + flow are clean.
- **Historical backfill** (§13).

## 16. Rough phasing (for the plan)

1. Migration: `rerun_series` + wave-link columns + read-model view; migrate `rerun_meta`; separate `longitudinal` from auto-spawn.
2. Series record UI (fields + waves list w/ N collected + N actual, "Fielded/rerun date", clickable rows, drag-reorder→renumber) + future-defaults editor.
3. Lifecycle: "Put into rerun service", auto-spawn (§8 inheritance), manual create, link existing; compliance waiver; Sree-captain rule.
4. Type-model split (separate Rerun filter dimension; chip).
5. Reruns-page month visibility + **weekly digest email** (weekly cron + Resend/SendGrid template, config-driven recipients/time).
6. Connector + in-app AI parity — search/list, grounded Q&A, date-windowed reports, and act (confirm-before-write); shared via the tool registry.
7. One-time `Rerun_DS` seed + dedup cross-check (with David).
8. Guide update + adversarial review + ship.

## 17. Confirmed decisions (from review)

- **Field inheritance (§8):** confirmed as written.
- **Numbering (§6):** Option A — waves default to date order; a manual drag saves an explicit order that overrides date and sticks; new auto-created waves append at the end.
- **Ownership + notifications:** Sree owns each series and receives the **weekly digest**, cc David; recipients and send day/time are config-driven so they can change without a deploy. **No separate monthly reminder** — the weekly digest already covers every cadence (monthly, quarterly, ad-hoc), so a monthly nudge would be redundant.
- **Rollout:** two phases — Phase 1 = core (data model, series record, wave lifecycle incl. stop/pause, compliance/captain rules, month visibility, weekly digest, Rerun_DS seed + dedup, connector/AI parity); Phase 2 = expand-in-place Reruns UX + historical backfill (§15/§16).

## 18. v2 — review hardening (5-lens adversarial review, 2026-08-10)

Locked decisions:
- **Compliance:** waive on every wave ≥ 2 regardless of client flag; only a per-wave `compliance_required_override` re-requires it (§9).
- **`service_mode` + `auto_armed`:** column default is **`auto`** (matches "auto to continue"); a newly promoted series is armed immediately. The one-time seed loads all ~29 as `service_mode='auto'` but `auto_armed=false`, so the **first** wave after the load is **manual** — David/Sree review the calendar and create that first wave by hand (or hit a bulk "Arm reviewed series"), which flips `auto_armed=true` and auto runs forever after. The cron auto-spawns only when `service_mode='auto' AND auto_armed AND not paused AND in_service`.
- **Transition:** the digest + month view **union** the legacy `rerun_status` reruns during coexistence (nothing invisible pre-seed), de-dupe once a study is seeded, and the old `rerun-nudges` cron is **retired** (no double-email).
- **Empty-week digest:** still sends, subject shows `(0)`.

Corrections folded in (were spec/plan contradictions or blockers):
- Wave number = existing `rerun_number` (no `wave_no` column); `wave_order` is only the drag override (§4.2, §6).
- New wave→series FK = **new** `series_id`; legacy `rerun_series_id` keeps its root-pointer meaning; `is_rerun = series_id OR rerun_series_id not null` (§4.2).
- **Spawn idempotency:** unique `(series_id, rerun_number)` partial index; selection filters on the prior wave's `rerun_spawned_at is null`; the new wave gets a concrete next `rerun_date` (never blank) so the "next due" provably advances; the legacy `longitudinal` spawn path excludes `series_id is not null` (and seed clears/reconciles `longitudinal`) so no double-spawn. Test: two back-to-back cron runs → exactly one wave.
- **Child rows + co-captains** carried on spawn via `clone.ts`; original captain seeded once (§8).
- **Resume/Re-activate rebase:** store a resume anchor so a paused/ended-then-resumed series doesn't land instantly "overdue"; `effective_next = max(last_wave, resume_anchor) + cadence`.
- **Promote/seed migrate the whole legacy series** (set `series_id` on every existing wave, `next_wave_no = max(existing)+1`) so the record isn't just Wave 1 and the first spawn doesn't collide.
- **View timezone:** compute overdue/`days_to_next` against `America/New_York`, not UTC.
- **Type-split completeness:** remove `Rerun` from every *editable* type selector (render-only for legacy); dedicated teal-outline `↻ Rerun` chip (no color collision); waves-list uses a reduced column set in the narrow project rail (full 7-col only on the record) with `fmtNum` on N; extend the split to the **Calendar** filter (Sree's tool) and to connector/AI reports (count reruns by dimension, not `project_type`); migrate any saved view that stored Type=`Rerun`.
- **Source-of-truth IA:** the new series/month view is primary; the legacy sheet Radar is labelled "legacy (migrating)"; a seeded study is de-duped/badged to its series rather than shown twice; the legacy `rerun_meta` "Paused" control is hidden for seeded series.
- **Digest email:** one branded, table-based, inline-styled shell (navy `#010B40` / teal `#0076AF`), Gmail/Outlook-safe (no flex/inline-block pills), config'd base URL; subject < ~70 chars; DST note (arrives 7–8am ET). **Retire `rerun-nudges`.**
- **Edit-scoping trust:** distinct save toasts ("Wave 3 updated" vs "Future-wave defaults updated — affects new waves") + scope microcopy on both editors.
- **Month view:** pinned "Overdue / needs action" strip above the grid (never hidden), prev/next-month + today controls.
- **Pause/End pending-wave prompt** implemented in the route + MCP handlers (cancel-or-leave the already-spawned un-fielded wave).
- **Seed:** unique key `(client_id, survey_name)` (re-runnable), name-normalized dedup (`baseRerunName`), and base_type/service_mode resolution with a per-item David decision for ambiguous rows; add anchor columns/fallback for Rerun_DS "fielding start"/"last delivery" so a seed-only series (no linked wave yet) still computes a due date.
- **Empty/loading/error states** for the new record + month view; consistent create/link/"mark collected" lexicon in UI + MCP.
- **Guide** pulled out of the ship task → gated post-ship task (#60), matching David's instruction.
- **RLS note:** reruns visibility assumes the analyst role; a read policy is required before any future non-analyst (sales) role can see the page/digest.
