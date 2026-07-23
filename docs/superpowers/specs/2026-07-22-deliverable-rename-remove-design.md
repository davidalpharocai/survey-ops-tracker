# Deliverable rename & remove — design

**Date:** 2026-07-22
**Status:** Approved (pending spec review)

## Problem

The project record's **Deliverables** tab (`DeliverablesPanel`) lists filed
deliverables read-only. There is no way to fix an ugly auto-generated display
name (e.g. `2026.06.14 — crosstabs_FINAL_v3(2).pdf`) or to remove a record that
was filed against the wrong project or is otherwise unwanted. Analysts have to
live with whatever name the ingest pipeline produced and cannot prune the list.

This adds two per-row capabilities to that panel:

1. **Edit display name** — an in-app label override.
2. **Remove record** — an in-app soft-delete.

## Scope decisions (confirmed with David)

- **Rename = in-app label only.** A new `display_name` override column. The real
  Google Drive file is never renamed. Reversible: clear the override → the list
  falls back to the auto name. Zero Drive-API risk.
- **Remove = in-app soft-delete only.** Sets `deleted_at`; the row drops off the
  index/list. The underlying file stays in the client's Shared Drive folder. No
  Drive trashing.
- **No `project_activity` log** for rename/remove in v1. The soft-deleted row
  (with `filed_by`/`filed_at` intact) is the audit trail; activity-feed noise
  isn't worth it. Trivial to add later.
- **Analyst-only**, enforced by existing RLS on `deliverables` (migration 034)
  plus a `requireAnalyst()` check in the API route (mirrors the resolve route).

## Data

**Migration `062_deliverable_display_name.sql`:**

```sql
alter table public.deliverables
  add column if not exists display_name text;
```

`display_name` nullable. `null` = "use the auto name." No other schema change —
`deleted_at` already exists (migration 034) and the list query already filters
`deleted_at is null`.

## Display resolution

The shown name becomes `display_name ?? file_name ?? original_file_name`
everywhere the list renders it. `display_name` is added to:

- the `useDeliverables` select list, and
- the `DeliverableRow` type in `lib/hooks/useDeliverables.ts`.

`DeliverablesPanel` computes a single `shownName(d)` helper and uses it for the
link text, the rename input seed, and the remove-confirm text.

## Name normalization (pure helper)

Extract a pure function so it can be unit-tested and shared by the route:

```ts
// lib/deliverables/display-name.ts
export function normalizeDisplayName(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  if (trimmed === '') return null          // empty → reset to auto name
  return trimmed.slice(0, 200)             // hard cap
}
```

Note: this is a display label, not a filename, so it deliberately does **not**
run `sanitizeName` (which strips `\ / : * ? " < > |`) — those characters are
fine in a label and would surprise the user if silently removed.

## API — `app/api/deliverables/[id]/route.ts` (new)

Analyst-gated via an inline `requireAnalyst()` helper — the codebase's
established convention (the resolve and upload routes each inline the same
~8-line helper; the upload route documents it as "same pattern as
parse-questionnaire"). Uses the admin client for writes (RLS already gates
read/write to analysts; admin client keeps parity with the resolve route).

- **`PATCH { display_name }`**
  - `normalizeDisplayName(body.display_name)` → stores the string or `null`.
  - 404 if the row is missing or already `deleted_at`.
  - Updates `display_name` only. Returns `{ ok: true }`.
- **`DELETE`**
  - Reuses `dismissDeliverable()` from `lib/deliverables/resolve.ts` (sets
    `deleted_at = now()`) so there is one soft-delete path.
  - 404 if the row is missing or already `deleted_at`.
  - Does **not** touch Drive. Returns `{ ok: true }`.

Both share the same `dbUpdate` cast pattern already in the resolve route.

## UI — `DeliverablesPanel`

Per-row, hover-revealed actions after the source/status badges:

- **Pencil (`ti-edit` / "Rename")** → swaps the row into an inline text input
  seeded with the current shown name. Save (button or Enter) calls PATCH; Cancel
  (button or Esc) reverts. Empty/whitespace input clears the override.
- **✕ (`ti-x` / "Remove")** → inline danger confirm reading
  *"Remove **{name}**? The file stays in the client's Drive folder."* with
  Remove / Keep. Remove calls DELETE.
- **"Reset to auto name"** link renders only when the row has a `display_name`
  override; clicking it PATCHes `display_name: ''` (→ `null`).

Two new mutations in `lib/hooks/useDeliverables.ts`:

- `useRenameDeliverable(projectId)` — `PATCH /api/deliverables/:id`
- `useRemoveDeliverable(projectId)` — `DELETE /api/deliverables/:id`

Both invalidate `['deliverables', projectId]` on success and surface a toast on
success/error, matching the existing `useUploadDeliverable` pattern.

Actions are hidden by default and revealed on row hover, keeping the list as
minimal as it is today.

## Out of scope (v1)

- Renaming or trashing the underlying Drive file.
- Activity-feed entries for rename/remove.
- Bulk select / bulk remove.
- Undo/restore UI for soft-deleted records (the row is recoverable in the DB by
  clearing `deleted_at`, but no button for it yet).

## Testing

- **Unit** (`lib/deliverables/display-name.test.ts`): `normalizeDisplayName`
  — trims/collapses whitespace, empty → `null`, `null`/`undefined` → `null`,
  caps at 200 chars, leaves interior punctuation untouched.
- **Component** (`__tests__/components/deliverables/DeliverablesPanel.test.tsx`):
  - shown name prefers `display_name` over `file_name`;
  - pencil opens the inline input; Save fires the rename mutation with the typed
    value; Esc cancels without firing;
  - ✕ opens the confirm; Remove fires the remove mutation; Keep cancels;
  - "reset to auto name" appears only with an override and PATCHes empty.

## Files touched

- `supabase/migrations/062_deliverable_display_name.sql` (new)
- `lib/deliverables/display-name.ts` (new) + `.test.ts` (new)
- `lib/hooks/useDeliverables.ts` (edit: type + select + 2 mutations)
- `app/api/deliverables/[id]/route.ts` (new)
- `components/deliverables/DeliverablesPanel.tsx` (edit)
- `__tests__/components/deliverables/DeliverablesPanel.test.tsx` (edit)
