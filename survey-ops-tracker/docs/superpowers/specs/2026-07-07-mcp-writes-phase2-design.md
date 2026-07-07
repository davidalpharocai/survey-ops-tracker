# Claude Connector — Phase 2 (Writes, History & Suggestions) Design

**Date:** 2026-07-07 · **Status:** scope approved by David (2026-07-07). Hardened through **two** adversarial passes — a 3-lens safety/correctness review (21 findings, incl. 1 critical compliance bypass) and a 2-lens completeness/forward-proofing review (22 findings) — all folded in. Builds on the shipped Phase 1 connector.

## Goal

Let a connected analyst **do and ask** everything they'd reasonably want in plain chat: create/update projects, move stages, log money, manage to-dos/notes/contacts, **ask what we did before**, and get **client-aware suggestions**. Every mutation is **previewed and confirmed**, runs the **same rules the UI enforces**, is **audited as "<user> via Claude,"** **cannot bypass a compliance gate**, and **cannot silently clobber a concurrent edit or double-count money**.

**Decisions locked (David):** (1) preview-then-confirm on all edits/creates; (2) v1 = the full write surface + history/suggestions; (3) never via the connector: delete, merge, permission/role changes. Duplicate handling is **conversational** ("there's already a project under X — proceed?"), not a hard wall.

## Architecture — grounding facts (verified against code)

1. **DB triggers keep integrity automatically** on any service-role write: PR##### assignment (insert-only), client auto-create/link off the `client` text, `actual_spend` recompute (`sync_blast_spend`), segment-total recompute (`sync_segment_totals`), voter flags, `updated_at`, and `project_audit` rows (028 insert / 035 update-diff / 029 step+bid / 043 blast). The **035 diff trigger is data-driven** — it audits every non-skip column, so new fields are covered automatically.

2. **Two rules are UI-only and MUST be re-enforced in the tool** (service-role bypasses RLS + React):
   - **Compliance gate** — `lib/utils/compliance.ts` `complianceGate(GateInput)` (pure). `getProjectDetail` returns only the *derived* summary, so a **new `loadGateInput(projectId)` helper** must fetch the raw client flags, `question_submissions {phase,status}`, and `compliance_override` to feed it.
   - **`board_column` ↔ `stage_*` coupling** — `getCheckboxesForColumn()` derives the six booleans for a **non-final** advance (it hardcodes `stage_delivery=false`). **Marking Delivered is a distinct action** (see `advance_project`) — never use `getCheckboxesForColumn` for it.

3. **Attribution — one rule: every write that fires an audit trigger goes through a `SECURITY DEFINER` RPC** that does `set_config('app.actor', '<email> via Claude', true)` **in the same transaction** as the write. Migration 046 amends the audit actor expression to prefer that GUC. This covers: survey_projects insert/update (create/update/status/stage/scoping tools), project_steps insert+update (add/complete step), project_bids + project_blasts insert, **and the client rename** (which rewrites `survey_projects.client` across rows — those diff rows *are* audited, so the rename must be an attributed RPC, not a plain write). RPCs **must not** re-check `my_role()` (null under service-role). Writes that fire **no** audit trigger (`add_note`→project_data_changes, `create_client`, `add_client_note`→client_notes, contacts) are plain service-role writes with `created_by` on the row (email local-part, matching the app's `email.split('@')[0]`) + the `mcp_tool_calls` detail log below.

4. **A queryable audit substrate for every connector write.** Migration 046 adds to `mcp_tool_calls`: **`detail jsonb`** (`{target, changed:{field:[old,new]}}` or created values), **`project_id`/`client_id`** (nullable, populated from the resolved target — indexed, so "everything the connector changed on PR00123" is one query), and **`error_code`/`error_message`** (set on failure). This is the authoritative record for writes on tables without audit triggers (clients, client_contacts, client_notes, project_data_changes).

## Preview-then-confirm + concurrency (core safety)

Every edit/create/status tool takes `confirm: boolean` (default false):
- **false → dry run:** resolve target, validate, run the gate, return a structured **preview** (resolved record, exact `field: old → new`, warnings, and the record's current **`updated_at`**). Writes nothing.
- **true → commit:** re-validate, re-run the gate, write via the attributed RPC.

The server **re-runs all gate/whitelist/segment checks on confirm**, so guardrails hold even if a client jumps to `confirm:true`. **Pure appends** (`add_next_step`, `add_note`, `add_client_note`) commit directly.

**Optimistic concurrency (lost-update guard):** the preview returns the target's `updated_at`; `confirm` accepts an optional `expected_updated_at`, and `mcp_write_project` **rejects with "changed since you looked — re-check"** if it no longer matches. Turns silent last-write-wins clobbering (a real risk as more teammates connect) into a visible reconcile.

**`create_project` duplicate handling is conversational.** The dry run returns any existing project under the **same client** or with a **similar name**, phrased for Claude to ask *"There's already a project under **<client>** ("<name>", PR00123) — do you want to proceed?"* If a potential duplicate exists, committing requires `proceed_despite_duplicate:true`, which Claude sets **only after the user says yes** — so a skipped preview can't silently spawn a duplicate, but a genuinely-new project goes through with one confirmation.

## The tools (writes)

All: analyst-gated; resolve via a **write-safe resolver** (adds `project_type != 'Internal'`); scope `deleted_at is null`; log to `mcp_tool_calls` (detail + target + error); attributed. Refs to steps/contacts are resolved from ids/labels returned by `get_project`/`get_client`.

| Tool | Args | Confirm | Notes |
|---|---|---|---|
| `add_next_step` | `project`, `text` | No | append `project_steps` (attributed RPC) |
| `complete_next_step` | `project`, `step_ref`, `done:bool` | No | toggle `done` + `completed_at`/`completed_by`; mirrors the checkbox |
| `edit_next_step` | `project`, `step_ref`, `text` | Yes | edit step text |
| `add_note` | `project`, `text` | No | project data-change log (`project_data_changes`) |
| `link_document` | `project`, `url`, `name?` | Yes | best-effort title via `/api/doc-title`; **append** to `linked_documents` (never overwrite) |
| `update_project` | `project`, `fields{…}`, `confirm?`, `expected_updated_at?` | Yes | whitelist below; refuse N if segmented; normalize `client`; **`compliance_override` not allowed here** |
| `set_requested_by` | `project`, `contact_ref` | Yes | resolve a contact **within the project's client**; write `requested_by_contact_id` + `requested_by_name` snapshot |
| `set_bid_budget` | `project`, `amount`, `note?`, `confirm?`, `idem_key?` | Yes | append `project_bids` = new allowed $/bid (latest = current). *(renamed from log_bid for clarity)* |
| `log_blast` | `project`, `delivered`, `bid`, `blast_cost`, `note?`, `confirm?`, `idem_key?` | Yes | append `project_blasts`; **idempotency enforced** (below) — a dup doubles `actual_spend` |
| `set_project_status` | `project`, `status` (Open/Hold/Closed), `confirm?` | Yes | patch `{status}` |
| `advance_project` | `project`, `to_column` **xor** `mark_delivered:true`, `override_reason?`, `confirm?` | Yes | must be phase=Active; `to_column`→`getCheckboxesForColumn`+`willMarkDelivered=false`; `mark_delivered`→all six `stage_*`=true+`board_column='Delivery'`+`willMarkDelivered=true`; run `complianceGate`, block unless satisfied or `override_reason` (stamps `latest_next_steps`) |
| `approve_scoping` | `project`, `confirm?` | Yes | phase='Active', board_column='Submitted', submitted_date=today, `getCheckboxesForColumn('Submitted')` |
| `move_to_scoping` | `project`, `confirm?` | Yes | **only** phase='Scoping' + scoping_stage=existing ?? 'Awaiting Approval'; keep board_column + stage_* |
| `set_compliance_override` | `project`, `value` (on/off/auto), `reason` (**required**), `confirm?` | Yes | sets `compliance_override` **and** stamps `latest_next_steps` — a gate change always carries a logged reason |
| `update_client` | `client`, `fields{compliance_*?, compliance_contact?, compliance_notes?}`, `confirm?` | Yes | non-rename fields |
| `rename_client` | `client`, `new_name`, `confirm?` | Yes | **single atomic attributed RPC** (`mcp_rename_client`): update `clients.name` + set-based rewrite of `survey_projects.client` in one tx |
| `create_client` | `name`, `compliance_*?`, `confirm?` | Yes | normalize through `client_firm_name()` (strip ' - Contact'); UNIQUE name → return existing on conflict; `code` null |
| `create_project` | `project_name`, `client`, `project_type?`, `captain?`, `salesperson?`, `due_date?`, `n_target?`, `skip_scoping?`, `confirm?`, `proceed_despite_duplicate?` | Yes | conversational dup (above); `skip_scoping`→Active/Submitted/today, else DB defaults; omit `project_code`/`client_id`; insert inside `mcp_create_project` RPC |
| `add_contact` | `client`, `first_name`, `last_name`, `email?`, `title?`, `phone?`, `confirm?` | Yes | require first+last; `created_by` (column added in 046) |
| `edit_contact` | `client`, `contact_ref`, `fields{…}`, `confirm?` | Yes | correct a contact |
| `archive_contact` | `client`, `contact_ref`, `archived:bool`, `confirm?` | Yes | retire/restore (soft; no hard delete) |
| `add_client_note` | `client`, `text` | No | append `client_notes` |
| `set_client_preference` | `client`, `preference`, `reason?` | Yes | records an explicit going-forward steer (see Suggestions) |

**Never exposed:** delete/soft-delete/restore, merge, role/permission changes, direct writes to computed/system columns, mutation of `project_type='Internal'` records, and editing/deleting logged blasts/bids (corrections happen in-app — stated in the user doc).

### `update_project` field whitelist

**Editable:** `project_name`, `client` (text → drives `client_id`; normalize), `project_type` (PS/B2B/Rerun), `captain_id` (via `captain`), `co_captain_ids`, `submitted_date`/`launch_date`/`due_date`/`deliver_date`, `n_target`/`n_collected`/`n_actual` (**only if not segmented**), `n_internal_target`, `audience_size`, `budget`, `salesperson`, `priority`, `blocked_by`, the boolean flags, `survey_tool_id`, `rerun_date`, `slack_channel_url`, `latest_next_steps` (append). *(`requested_by` via `set_requested_by`; `linked_documents` via `link_document`; status/stage/scoping/override via their dedicated tools.)*

**Forbidden:** `id`, `project_code`, `client_id`, `created_at`, `updated_at`, `actual_spend` (use `log_blast`), the six `stage_*` individually, `board_column`, `status`/`phase`/`scoping_stage`, `compliance_override`, `segment_count` + N when segmented, `deleted_at`, and all sync/rerun-series/integration bookkeeping. *(`objective`/`category` are Internal-only → not exposed, since write tools reject Internal.)*

The **`mcp_write_project` RPC** — the real security boundary — enumerates the full column set it will touch (the editable list **plus** `status`, `phase`, `scoping_stage`, `board_column`, the six `stage_*`, `submitted_date`, `compliance_override`, `requested_by_contact_id`/`requested_by_name`, `linked_documents`) with per-column typed casts and **no dynamic identifier interpolation**; only keys **present** in the patch are written (`p_patch ? 'col'`; `jsonb_typeof='null'` = explicit null).

## History, suggestions & learning

Read tools so Claude can answer "what did we do last time?" and suggest client-aware defaults. No ML — the connector exposes history + patterns; the user's Claude reasons; suggestions sharpen automatically as data grows.

- **`get_me()`** — the caller's `team_members {name, initials, role}` (via `profiles.email → team_members`). Unlocks "what's overdue **for me**" / "**my** projects"; also let `pipeline_summary`/`search_projects` accept `mine:true`.
- **`get_client_history(client)`** — every past & current project with: type, N target/collected/actual, budget, actual spend, **objective/category**, fielding window (launch→deliver), captain, salesperson, dates, status/outcome, **deliverables summary**, **linked_documents URLs**, compliance flags; plus **derived patterns** (typical N, common type, avg fielding duration, cadence, recurring contacts) and **stated preferences** (from `set_client_preference`). Capped to the most-recent N projects with patterns computed over all. Powers "what did we do last time for Coatue?" and default suggestions.
- **`get_project_history(project)`** — a project's prior **waves** (via `rerun_series_id`) for "how did last quarter's wave compare?"
- **`get_project`** (Phase 1) already resolves closed/past projects; migration surfaces `linked_documents` + step ids in its output.

**Past-survey Q&A:** questionnaire *content* lives in Google Docs, not our DB — so `get_client_history`/`get_project` return the **linked questionnaire URLs**, and the server instructions tell Claude to hand those to the user's **Drive connector** to answer "what questions did we ask last time."

**Learning that's explicit + team-shared:** history captures *implicit* patterns, but a user's steer ("use PS not B2B for Coatue going forward") wouldn't show until enough new projects shift the average, and claude.ai memory is per-user. `set_client_preference(client, preference, reason?)` records that steer as a tagged `client_notes` row (team-shared, no new table), which `get_client_history` surfaces as "stated preferences" — so a correction one analyst makes informs everyone's Claude. Server instructions tell Claude to offer to save a preference when a user explicitly overrides a suggestion "going forward."

## Teaching Claude to use it well

- **MCP server instructions** — passed as the **2nd (`serverOptions`) arg** of `createMcpHandler` (the current `route.ts` passes `{}` there; instructions in the 3rd/Config arg are silently dropped). Content: preview before mutating and get the user's OK before `confirm:true`; ask before proceeding on a possible duplicate; for "what did we do last time" use `get_client_history`/`get_project_history` and hand questionnaire URLs to the Drive connector; before creating a project for an existing client, call `get_client_history` and offer typical defaults; resolve "me/my" via `get_me`; to record an interaction (e.g. "we emailed the client") use `add_note`; corrections to a logged blast/bid happen in the app; if a tool says N is segmented, don't fight it; offer to save a `set_client_preference` when the user overrides a suggestion going forward.
- **MCP prompts** (best-effort): "morning pipeline review," "log this week's blast," "create a project from this brief."

## Migration 046

1. **Amend audit actor** in the connector-reachable functions (028 insert, 035 update-diff, 029 step+bid, 043 blast) to `coalesce(nullif(current_setting('app.actor',true),''), nullif(auth.email(),''),'system')` (backward-compatible).
2. `alter table client_contacts add column created_by text`.
3. `alter table mcp_tool_calls add column detail jsonb, add column project_id uuid, add column client_id uuid, add column error_code text, add column error_message text` + index on `(project_id)` and `(client_id)`.
4. `alter table project_blasts add column idem_key text` and same for `project_bids`; **unique partial index** on `(project_id, idem_key) where idem_key is not null`.
5. **`SECURITY DEFINER` RPCs** (`set search_path = public`; grant to service role; no `my_role()` check), each `set_config('app.actor', p_actor, true)` then the write, one transaction:
   - `mcp_write_project(p_id, p_patch jsonb, p_actor, p_expected_updated_at timestamptz default null)` — present-key whitelisted update; rejects on `expected_updated_at` mismatch. Used by update/status/advance/scoping/requested_by/link_document/compliance_override tools (each computes its coupled patch in TS).
   - `mcp_create_project(p_patch jsonb, p_actor)` — insert; returns the row (insert trigger stamps actor from GUC).
   - `mcp_add_step`, `mcp_complete_step`, `mcp_edit_step`, `mcp_set_bid_budget`, `mcp_log_blast` — attributed child writes; `mcp_log_blast`/`mcp_set_bid_budget` insert with `idem_key`, treating a unique-violation as a **successful no-op** (return the existing row).
   - `mcp_rename_client(p_id, p_new_name, p_actor)` — atomic: update `clients.name` + set-based rewrite of `survey_projects.client` in one tx.
   (No-audit-trigger writes — `add_note`, `add_client_note`, `create_client`, `update_client` non-rename, contacts, `set_client_preference` — are plain service-role writes with `created_by` + detail log.)
6. No new tables (two columns on blasts/bids, five on mcp_tool_calls, one on client_contacts, indexes).

## Idempotency

`log_blast`/`set_bid_budget` accept `idem_key`; the unique partial index makes dedup **race-safe** (a concurrent double-fire hits the constraint → no-op). **Load-bearing for `log_blast`** (sync_blast_spend sums all blasts → a dup doubles spend). Server instructions tell Claude to pass a stable `idem_key` per intended blast.

## Security summary

- Analyst-gated; write tools re-enforce whitelists, the compliance gate, Internal-exclusion, segmented-N refusal, and optimistic-lock.
- Preview-then-confirm on every edit/create/status; ambiguous targets never written; gate blocks surfaced; overrides always stamp `latest_next_steps`; `compliance_override` only via its reason-carrying tool.
- Project + rename writes → `project_audit` attributed "<user> via Claude"; **every** connector write additionally in `mcp_tool_calls` (detail + target + error), queryable by project/client.
- `create_project` surfaces duplicates conversationally; `create_client` normalizes to firm name; multi-step writes (advance, create, rename) are single atomic RPCs.
- Nothing destructive reachable; computed columns unwritable; logged blasts/bids corrected in-app.

## Forward-looking & extensibility

- **Single source of truth (key drift risk):** the compliance gate + stage coupling are duplicated from the UI. **Going forward, push shared rules into the DB (triggers/RPCs)** so app + connector inherit them; any new UI-only rule must be mirrored into the connector's write path in the same change. Safeguard: a shared test running `complianceGate` fixtures against both paths.
- **Adding an editable field is a deliberate 3-touch change** (tool whitelist + TS validation + `mcp_write_project` cast) — the intentional tradeoff for "no dynamic SQL." New *audited* columns are picked up by the data-driven 035 trigger automatically; only new **enums** (statuses/stages) need a TS touch.
- **Uniform tool shape** (resolve→validate→gate→attributed RPC→detail-log) makes new tools cheap (`close_project`, bulk edits, undo) without new infra.
- **Bulk / multi-record writes** deferred; when added, per-record gates + one combined preview.
- **Undo** feasible later from `project_audit` + `mcp_tool_calls.detail`.
- **Notifications:** connector writes fire the same triggers as the app but don't post to Slack/digest; wiring that in is a deliberate future step.
- **Suggestion quality compounds** on live data (no retraining); `set_client_preference` gives it explicit, team-shared steering.
- **Versioning:** tool names/args are a public contract with users' Claude configs — additive changes safe; renames/removals breaking (hence `set_bid_budget` named right now).

## Out of scope (Phase 2)

Delete/merge/restore, role changes, the internal-project surface, bulk writes, editing segmented-N breakdowns, editing/deleting logged blasts/bids, and a manual `project_activity` writer (use `add_note`).

## Rollout

1. Migration 046 (David runs it).
2. Deploy. No new env vars.
3. Smoke test via a connected Claude: `get_me` + "what's overdue for me"; "what did we do last time for <client>" (get_client_history returns stats + patterns + questionnaire URLs); create a dummy project (dup preview → proceed → PR-code + linked client → audit "you via Claude"); update N (preview shows updated_at → confirm); a stale `expected_updated_at` is rejected; advance a compliance-required client into Fielding (blocked → override with reason) and `mark_delivered` an after-fielding client with no approval (blocked); `log_blast` twice with the same `idem_key` (counts once); complete a next step; link a doc; add/edit/archive a contact; rename a client (projects update atomically; audited to user); set a client preference and see it in `get_client_history`. Verify in app + logs, then soft-delete the dummy in-app.
4. Update `USER_GUIDE.md` §10 + Connect page with "what you can ask Claude to *do* and *recall*," and note corrections happen in the app.

## Acceptance checklist

- Every edit/create/status tool refuses to write without `confirm:true` and returns an accurate preview incl. `updated_at`; a mismatched `expected_updated_at` is rejected.
- `advance_project(mark_delivered)` sets `stage_delivery=true` and runs the after-fielding gate; a required-but-unapproved client is blocked unless `override_reason` given; `advance_project` refuses on a Scoping project.
- `update_project` rejects N when segmented, forbidden/computed fields, and `compliance_override`; `set_compliance_override` requires + stamps a reason.
- `mcp_write_project` leaves absent fields untouched, sets explicit null when passed.
- `create_project` surfaces duplicates and needs `proceed_despite_duplicate:true` to commit over one; on commit gets a real PR##### + linked client, audited to the user.
- `log_blast`/`set_bid_budget` with a repeated `idem_key` count once (race-safe via unique index).
- `complete_next_step`, `link_document`, `edit_contact`, `archive_contact`, `set_requested_by`, `add_client_note`, `set_client_preference` all work and are logged.
- `rename_client` is atomic and attributed to the user.
- `get_me`, `get_client_history` (stats + patterns + preferences + questionnaire URLs), `get_project_history` (prior waves) return correctly; connector writes are queryable in `mcp_tool_calls` by project/client.
- Internal projects, delete, and merge are not reachable.
