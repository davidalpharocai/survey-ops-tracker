# Merge duplicate projects & clients — design

**Date:** 2026-07-02
**Status:** Design approved; ready for implementation plan.

## Goal

Let an analyst merge two duplicate records — two **projects** or two **clients** — into
one, from inside the app, with an explicit confirm/preview step. Consolidates all the
duplicate's data onto a chosen "survivor" and retires the other. Manual-initiated only for
v1 (no automatic duplicate detection).

## Decisions (locked)

1. Merge applies to **both projects and clients**.
2. **Always** a confirm/preview step before executing — no one-click merge.
3. **Entry point:** a `Merge…` action available from *either* record; the **survivor is chosen
   in the preview** (not fixed by where you started).
4. **Manual-only** for v1 — the user finds the other record via search. No proactive flagging.
5. **Loser** (the record merged away) is **soft-deleted** (recoverable), not hard-deleted.
6. **Field conflicts:** resolved **per field** in the preview (pick which value the survivor
   keeps). Only *differing* fields are shown.

## Flow

1. `Merge…` action on a project page (and client page).
2. **Record picker:** search the other record by name or code (`PR#####` / `Cl#####`),
   same-type only. Cannot pick itself.
3. **Preview** (see the approved mockup):
   - Two candidates side by side; a radio picks the **survivor** (defaults to the record you
     started from, switchable).
   - **Resolve differences:** one row per scalar field whose values differ — pick the value the
     survivor keeps (survivor's own value pre-selected). Matching fields are not shown.
   - **Everything else combines:** a read-only summary of the lists/logs that fold in
     (counts: `loser + survivor → total`).
   - Footer: note that the loser goes to Recently Deleted, audit-noted; `Cancel` / `Merge`.
4. On `Merge`, the UI calls one atomic DB function with `{ survivor_id, loser_id, overrides }`.

## What moves

### Projects
Re-point every child row from loser → survivor (all keyed by `project_id`):
`project_bids` (Bid Budget log), `project_blasts`, `project_steps`, `project_activity`,
`project_data_changes`, `project_audit`, `project_segments`, `deliverables`,
the submissions tables from migration 007 (compliance), and `project_seen`.

- **Scalar fields** on `survey_projects` (name, type, phase, status, scoping_stage, the four
  dates, n_target, n_internal_target, n_actual, audience_size, salesperson, captain_id,
  priority, blocked_by, survey_tool_id, budget, category, objective, the boolean flags, rerun
  fields, requested_by_contact_id): the survivor keeps its own value **unless overridden**
  per-field in the preview.
- **Array columns** (`linked_documents`, `co_captain_ids`): **union** (combine, de-duplicated).
- `actual_spend` is recomputed automatically by the existing `sync_blast_spend` trigger once
  the loser's blasts move over — no manual handling.

### Clients
Re-point from loser → survivor: `survey_projects.client_id`, `profiles.client_id` (portal
reviewers), `deliverables.client_id`, `client_contacts.client_id`, `client_notes.client_id`.
Also update `survey_projects.client` (denormalized name text) on the moved projects to the
survivor client's name. Survivor keeps its own compliance flags / name unless overridden.

### Loser disposition
Soft-delete the loser (`deleted_at = now()`), write a `merged into <code>` audit entry, and a
`merged in <code>` entry on the survivor. Child data has already moved, so restoring the loser
yields an empty shell — true one-click "undo merge" is explicitly out of scope for v1.

## Execution

Two **security-definer Postgres functions** (RPCs), one per type:
`merge_projects(p_survivor uuid, p_loser uuid, p_overrides jsonb)` and
`merge_clients(...)`. Each does all re-pointing + applies `p_overrides` to the survivor +
soft-deletes the loser **in a single transaction** (all-or-nothing; no half-merge). `p_overrides`
is a `{ column: value }` map built by the preview from the per-field picks. Functions validate:
both ids exist, are distinct, and (projects) neither is segmented.

The client UI:
- `useMergeProjects()` / `useMergeClients()` hooks call the RPC, then invalidate the relevant
  caches (`['projects']`, `['project', id]`, `['clients']`, `['client', id]`, child keys).
- A pure helper computes the field diff (which scalars differ) and assembles `overrides` from
  the user's picks — unit-testable without the DB.

## Data-model changes

- **Add `clients.deleted_at timestamptz`** (clients have no soft-delete today). Exclude
  `deleted_at is not null` from client lists, the client picker, and the merge picker. Optionally
  surface deleted clients in Admin → Recently Deleted (parity with projects) — nice-to-have,
  not required for v1.
- No other schema changes: all child tables already exist and are reassigned by the RPC.

## Edge cases & guards

- **Same-type only** (project↔project, client↔client); no cross-type merge; no self-merge.
- **Segmented projects:** if *either* project has `project_segments` rows, block the merge with
  a "un-split segments first" message (avoids exceeding the 2-segment cap and scrambling the
  summed N).
- **Permissions:** analyst-only (the RPC runs security-definer but is only exposed to the
  analyst UI; portal/compliance users never see the action).
- **Concurrency:** the transaction re-points by id; last-writer semantics are fine for this
  low-frequency, manually-confirmed action.

## Testing

- Pure helper: field-diff detection + `overrides` assembly (given two records + picks → correct
  override map; only-differing-fields surface).
- RPC behavior (against a test/local DB or fake): child rows re-point; survivor scalars apply
  overrides; arrays union; loser soft-deleted; audit rows written; segmented-project merge
  rejected.
- Component: preview renders differing fields, survivor toggle swaps which side is kept, Merge
  calls the hook with the right payload.

## Out of scope for v1

Automatic/proactive duplicate detection; one-click undo of a merge; per-item choice within the
combined lists (lists always fully combine); cross-type merges; a dedicated Duplicates screen
(may come later for bulk cleanup).
