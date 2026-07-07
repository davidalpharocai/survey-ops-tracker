# Claude Connector — Phase 2 (Writes) Design

**Date:** 2026-07-07 · **Status:** direction + scope approved by David (2026-07-07). Hardened after a 3-lens adversarial review (write-safety / codebase-fit / protocol-ops; 21 findings folded in, incl. 1 critical compliance-gate bypass). Builds on the shipped Phase 1 connector.

## Goal

Let a connected analyst **create and update records** through their own Claude — projects, statuses/stages, field/money edits, notes/to-dos, clients/contacts — safely. Every mutation is **previewed and confirmed** before it commits, runs the **same business rules the app's UI enforces**, is **audited as "<user> via Claude,"** and **cannot bypass a compliance gate**.

**Decisions locked (David, 2026-07-07):** (1) preview-then-confirm on all edits/creates; (2) v1 = the full write surface; (3) never via the connector: delete, merge, permission/role changes.

## Architecture

Extends the existing `/api/mcp` server — same OAuth, analyst gate (`withMcpAuth`), `logged()` wrapper, and `lib/mcp/data.ts` resolvers. Four grounding facts (verified against code):

1. **DB triggers keep integrity automatically** on any service-role write: PR##### assignment (insert-only), client auto-create/link off the `client` text, `actual_spend` recompute (`sync_blast_spend`), segment-total recompute (`sync_segment_totals`), voter flags, `updated_at`, and `project_audit` rows (028 insert / 035 update-diff / 029 step+bid / 043 blast). Tools write the right columns and inherit these.

2. **Two rules are UI-only and MUST be re-enforced in the tool:**
   - **Compliance gate** — `lib/utils/compliance.ts` `complianceGate(GateInput)` is a pure function. `GateInput` = `{ targetColumn, willMarkDelivered, client:{compliance_before_fielding,compliance_after_fielding}, override, submissions:[{phase,status}] }`. **`getProjectDetail` returns only the *derived* compliance summary, not these raw inputs** — so a **new shared helper `loadGateInput(projectId)`** (mirroring the client-side `useComplianceState`) must fetch the client compliance flags, the project's `question_submissions {phase,status}`, and `compliance_override`, and feed them to `complianceGate`.
   - **`board_column` ↔ `stage_*` coupling** — `lib/utils/stage.ts` `getCheckboxesForColumn()` derives the six booleans for a *non-final* column advance (it **hardcodes `stage_delivery=false`**). Marking **Delivered** is a *distinct* action (see `advance_project` below) — never use `getCheckboxesForColumn` for it.

3. **Attribution:** audit triggers stamp `changed_by = coalesce(nullif(auth.email(),''),'system')`; under service-role `auth.email()` is null → 'system'. Migration 046 amends those expressions to **prefer a transaction-local GUC**: `coalesce(nullif(current_setting('app.actor',true),''), nullif(auth.email(),''),'system')` (backward-compatible — unset GUC reads null and falls through). **Every write that fires an audit trigger** (survey_projects insert/update, project_steps/bids/blasts insert) goes through a `SECURITY DEFINER` RPC that does `set_config('app.actor', '<email> via Claude', true)` **in the same transaction** as the write (a split set_config+write across two supabase-js calls would NOT survive the connection pooler). RPCs **must not** re-check `my_role()` (null under service-role — would wrongly reject); the `withMcpAuth` analyst gate is the authorization.

4. **A guaranteed connector audit trail for *every* write** (project- and client-scoped): migration 046 adds a **`detail jsonb`** column to `mcp_tool_calls`, and write tools record `{ target, changed:{field:[old,new]} }` (or created values). This is the single reliable log — important because `clients`, `client_contacts`, `client_notes`, and `project_data_changes` have **no** audit triggers, so a client **rename** (which rewrites `survey_projects.client` across many rows) would otherwise be invisible.

**Row-level attribution:** on tables with a `created_by` column (`project_steps`, `project_bids`, `project_blasts`, `project_data_changes`, `client_notes`), write `created_by = <email local-part>` (e.g. `"david"`, matching the app's `email.split('@')[0]` convention so connector rows render identically to app rows). Migration 046 **adds `created_by text` to `client_contacts`** (it has none today) so `add_contact` can attribute too.

## Preview-then-confirm (core safety mechanism)

Every edit/create/status tool takes `confirm: boolean` (default false):
- **false → dry run:** resolve target, validate, run the compliance gate, return a structured **preview** (resolved record, exact `field: old → new`, warnings). Writes nothing.
- **true → commit:** re-validate, re-run the gate, write via the attributed RPC, return the result.

The server **re-runs all gate/whitelist/segment checks on confirm**, so data-integrity guardrails hold even if a client calls `confirm:true` without showing the preview. **Pure appends** (`add_next_step`, `add_note`) commit directly (additive + reversible). **`create_project` is the exception to confirm-trust:** an exact case-insensitive name match is **hard-blocked** and requires an explicit `allow_duplicate:true` (not just `confirm`), so a skipped preview can't silently spawn a duplicate.

## The tools

All: analyst-gated; resolve via a **write-safe resolver** that adds `project_type != 'Internal'` (the plain `resolveProject` doesn't filter Internal — write tools must reject Internal projects); scope `deleted_at is null`; log to `mcp_tool_calls` with the `detail` change-summary; actor `= <email> via Claude`.

| Tool | Args | Confirm | Rules |
|---|---|---|---|
| `add_next_step` | `project`, `text` | No | insert `project_steps` via `mcp_add_step` RPC (attributed) |
| `add_note` | `project`, `text` | No | insert `project_data_changes` (created_by; no audit trigger → detail-logged) |
| `update_project` | `project`, `fields{…}`, `confirm?` | Yes | whitelist (below); refuse N fields if segmented; normalize `client` text; **`compliance_override` NOT allowed here** |
| `log_bid` | `project`, `amount`, `note?`, `confirm?`, `idem_key?` | Yes | insert `project_bids` via `mcp_log_bid` RPC |
| `log_blast` | `project`, `delivered`, `bid`, `blast_cost`, `note?`, `confirm?`, `idem_key?` | Yes | insert `project_blasts` via `mcp_log_blast` RPC; `actual_spend` auto-recomputes. **Idempotency required** (below) — a duplicate blast doubles spend |
| `set_project_status` | `project`, `status` (Open/Hold/Closed), `confirm?` | Yes | enum-validate; patch `{status}` via `mcp_write_project` |
| `advance_project` | `project`, **either** `to_column` **or** `mark_delivered:true`, `override_reason?`, `confirm?` | Yes | **must be phase=Active** (else refuse → use `approve_scoping`); **`to_column`** → `getCheckboxesForColumn(to_column)` + `willMarkDelivered=false`; **`mark_delivered`** → set **all six `stage_*`=true (incl. `stage_delivery`)** + `board_column='Delivery'` + **`willMarkDelivered=true`**. Run `complianceGate`; block unless satisfied or `override_reason` given (stamps `latest_next_steps`) |
| `approve_scoping` | `project`, `confirm?` | Yes | phase='Active', board_column='Submitted', submitted_date=today, `getCheckboxesForColumn('Submitted')` |
| `move_to_scoping` | `project`, `confirm?` | Yes | **only** phase='Scoping', scoping_stage = existing ?? 'Awaiting Approval' — **keep** board_column + stage_* (matches the UI's "picks up where it left off") |
| `set_compliance_override` | `project`, `value` (on/off/auto), `reason` (**required**), `confirm?` | Yes | dedicated tool (not `update_project`); sets `compliance_override` **and** stamps `latest_next_steps` with the reason — disabling a gate always carries a logged justification |
| `update_client` | `client`, `fields{name?, compliance_*?, compliance_contact?, compliance_notes?}`, `confirm?` | Yes | if renaming, also sync denormalized `survey_projects.client` text (mirror `useRenameClient`); detail-logged |
| `create_client` | `name`, `compliance_*?`, `confirm?` | Yes | **normalize `name` through `client_firm_name()`** (strip any ' - Contact' suffix) so it matches the firm row projects auto-link to; UNIQUE name → return existing on conflict; `code` left null (comes from sheet) |
| `create_project` | `project_name`, `client`, `project_type?`, `captain?`, `salesperson?`, `due_date?`, `n_target?`, `skip_scoping?`, `confirm?`, `allow_duplicate?` | Yes | dup preview + **hard-block exact name match** unless `allow_duplicate:true`; `skip_scoping:true` → phase='Active', board_column='Submitted', submitted_date=today; else DB defaults (Scoping/New Inquiry/Submitted). Omit `project_code`/`client_id` (triggers assign); normalize `client`; insert inside `mcp_create_project` RPC so the `(created)` audit row is attributed |
| `add_contact` | `client`, `first_name`, `last_name`, `email?`, `title?`, `phone?`, `confirm?` | Yes | require first+last; insert `client_contacts` with `created_by` (column added in 046) |

**Never exposed:** delete/soft-delete/restore, merge, role/permission changes, direct writes to computed/system columns, and any mutation of `project_type='Internal'` records.

### `update_project` field whitelist

**Editable:** `project_name`, `client` (text; drives `client_id` via trigger — never set `client_id`; normalize via `normalizeClientText`), `project_type` (PS/B2B/Rerun), `captain_id` (via `captain` name/initials → resolve), `co_captain_ids`, `submitted_date`/`launch_date`/`due_date`/`deliver_date`, `n_target`/`n_collected`/`n_actual` (**only if not segmented** — else refuse), `n_internal_target`, `audience_size`, `budget`, `salesperson`, `priority` (none/high/urgent), `blocked_by` (none/client/internal), boolean flags (`longitudinal`, `voter_survey_qa`, `citation_language_needed`, `row_level_data`, `terminations`), `objective`, `category`, `slack_channel_url`, `latest_next_steps` (append via `autoStamp`).

**Forbidden (tool rejects):** `id`, `project_code`, `client_id`, `created_at`, `updated_at`, `actual_spend` (use `log_blast`), the six `stage_*` (set only as a coupled set via `advance_project`), `board_column` (use `advance_project`), `status`/`phase`/`scoping_stage` (use the dedicated status/scoping tools), **`compliance_override`** (use `set_compliance_override`), `segment_count` + N when segmented, `deleted_at`, and all sync/rerun/integration bookkeeping.

## Teaching Claude to use it well ("skills")

No separate Anthropic Skill. Ship with the connector:
- **MCP server instructions** — **passed as the 2nd (`serverOptions`) arg of `createMcpHandler`** (the current `route.ts` passes `{}` there and everything else in the 3rd `Config` arg, which has no `instructions` field — instructions there are silently dropped). Content: "Always preview before changing N/dates/status or creating records; show the preview and get the user's OK before re-calling with confirm:true. Never create a project without reviewing the duplicate list. Decode survey IDs with decode_survey_id. When the user says 'we're behind,' check pipeline_summary first. If a tool says N is segmented, don't fight it."
- **MCP prompts** (best-effort — claude.ai remote-connector prompt UI isn't guaranteed): "log this week's blast," "morning pipeline review."

## Migration 046

1. **Amend audit actor** in the four connector-reachable functions (028 insert marker, 035 update-diff, 029 step+bid, 043 blast) to `coalesce(nullif(current_setting('app.actor',true),''), nullif(auth.email(),''),'system')`. (`merge_projects` etc. out of scope.)
2. **`alter table client_contacts add column created_by text`**.
3. **`alter table mcp_tool_calls add column detail jsonb`** (per-write change-summary; the guaranteed connector audit trail).
4. **`SECURITY DEFINER` RPCs** (`set search_path = public`; grant execute to the service role; **no `my_role()` check**), each doing `set_config('app.actor', p_actor, true)` then the write, in one transaction:
   - `mcp_write_project(p_id uuid, p_patch jsonb, p_actor text)` — applies **only the keys present** in `p_patch` (`p_patch ? 'col'`), treating `jsonb_typeof(p_patch->'col')='null'` as an explicit set-to-null; per-column typed casts, **no dynamic identifier interpolation** (fixed whitelist). Used by `update_project`, `advance_project`, `set_project_status`, `approve_scoping`, `move_to_scoping`, `set_compliance_override` (the TS tool computes the coupled patch — incl. stage booleans — and passes it).
   - `mcp_create_project(p_patch jsonb, p_actor text)` — inserts survey_projects from present keys, returns the row (the insert trigger stamps the actor from the GUC — **no separate post-insert patch needed**).
   - `mcp_add_step`, `mcp_log_bid`, `mcp_log_blast` — attributed child inserts.
   (Writes with **no** audit trigger — `add_note`→project_data_changes, `create_client`, `update_client`, `add_contact`, `client_notes` — can be plain service-role writes with `created_by` on the row + the `mcp_tool_calls.detail` summary; no RPC needed.)
5. No new tables.

## Idempotency

`log_blast` and `log_bid` accept an optional `idem_key`; the tool rejects an append whose `(project_id, idem_key)` — or exact `(project_id, payload)` within 60s — already exists. **Load-bearing for `log_blast`:** `sync_blast_spend` sums all blasts, so a retried/double-fired blast silently doubles `actual_spend`. The server instructions tell Claude to pass a stable `idem_key` per intended blast.

## Security summary

- Analyst-gated (Phase 1); write tools additionally re-enforce field whitelists, the compliance gate, Internal-record exclusion, and segmented-N refusal.
- Preview-then-confirm on every edit/create/status; ambiguous targets never written; gate blocks surfaced; overrides (`advance_project` reason + `set_compliance_override`) always stamp `latest_next_steps`.
- `compliance_override` can only be changed through its dedicated reason-carrying tool — never as a silent field edit.
- Project writes flow into `project_audit` attributed "<user> via Claude" (GUC RPCs); **every** connector write (incl. client renames) is additionally recorded in `mcp_tool_calls.detail`.
- `create_project` hard-blocks exact-name duplicates; `create_client` normalizes to firm name to avoid orphan/split client rows.
- Nothing destructive (delete/merge/restore) reachable; computed columns unwritable; RPCs are `SECURITY DEFINER` without a redundant `my_role()` check.

## Out of scope (Phase 2)

Delete/merge/restore, role changes, the internal-project surface, bulk/multi-record writes in one call, and editing segmented-N breakdowns (direct N refused when segmented; segment editing stays in-app).

## Rollout

1. Migration 046 (David runs in Supabase SQL editor).
2. Deploy. No new env vars.
3. Smoke test via a connected Claude: create a dummy project (dup-check preview → PR-code + linked client → audit shows "you via Claude"); update N (preview → confirm); attempt to advance a compliance-required client into Fielding (blocked → override with reason) and to `mark_delivered` an after-fielding client with no approved submission (blocked); `log_blast` twice with the same `idem_key` (spend counts once); rename a client (projects' text updates; `mcp_tool_calls.detail` records it); add a note/step/contact. Confirm each in the app + logs, then soft-delete the dummy in-app.
4. Update `USER_GUIDE.md` §10 + Connect page with "what you can ask Claude to *do*" examples.

## Acceptance checklist

- Every edit/create/status tool refuses to write without `confirm:true` and returns an accurate preview.
- `advance_project(mark_delivered)` sets `stage_delivery=true` **and** runs the after-fielding gate; an after-fielding-required client with no approved submission is blocked unless `override_reason` is given.
- `advance_project` refuses on a phase='Scoping' project.
- `update_project` rejects N edits when segmented, rejects forbidden/computed fields, and rejects `compliance_override`; `set_compliance_override` requires a reason and stamps it.
- `mcp_write_project` leaves absent fields untouched and can set a field to null when explicitly passed null.
- `create_project` hard-blocks an exact-name duplicate without `allow_duplicate:true`; on confirm gets a real PR##### + linked client, audited to the user.
- `log_blast` with a repeated `idem_key` counts spend once.
- Connector project changes read "<user> via Claude" in `project_audit`; client changes appear in `mcp_tool_calls.detail`.
- Internal projects, delete, and merge are not reachable.
