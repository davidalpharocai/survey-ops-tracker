# Deliverable rename & remove Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let analysts rename a deliverable's display label and remove (soft-delete) a deliverable record from the project record's Deliverables tab.

**Architecture:** A nullable `display_name` override column on `deliverables` (Drive file never touched). A new `PATCH`/`DELETE` route at `/api/deliverables/[id]` (analyst-gated, admin-client writes). `PATCH` normalizes and stores the label; `DELETE` reuses the existing `dismissDeliverable()` soft-delete. The `DeliverablesPanel` gains hover-revealed pencil (inline rename) and ✕ (danger confirm) actions, wired through two new React Query mutations.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + RLS), React Query, Vitest + Testing Library.

**Working directory:** All paths below are relative to `survey-ops-tracker/`. Run all commands from that directory.

---

### Task 1: Add the `display_name` column (migration)

**Files:**
- Create: `supabase/migrations/062_deliverable_display_name.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 062: Deliverable display-name override.
-- Analysts can rename what the tracker shows for a deliverable without touching
-- the real file in the client's Shared Drive. null = fall back to the auto name
-- (file_name / original_file_name). This is a display label, not a filename.
alter table public.deliverables
  add column if not exists display_name text;
```

- [ ] **Step 2: Regenerate Supabase types so `display_name` is known to TS**

Run: `npx supabase gen types typescript --local > lib/supabase/types.ts`
Expected: `lib/supabase/types.ts` now contains `display_name: string | null` on the `deliverables` Row/Insert/Update types.

If the local Supabase stack is not running and cannot be started, instead hand-edit `lib/supabase/types.ts`: add `display_name: string | null` to the `deliverables` `Row`, and `display_name?: string | null` to its `Insert` and `Update` shapes. Search the file for the existing `deliverables:` table block and mirror the style of adjacent nullable text columns (e.g. `file_name`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/062_deliverable_display_name.sql lib/supabase/types.ts
git commit -m "feat(deliverables): add display_name override column (migration 062)"
```

---

### Task 2: `normalizeDisplayName` pure helper

Normalizes user input for the display label: collapse whitespace, trim, empty → `null` (reset to auto name), cap at 200 chars. Deliberately does **not** strip filename-illegal characters — this is a label, not a filename.

**Files:**
- Create: `lib/deliverables/display-name.ts`
- Test: `lib/deliverables/display-name.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeDisplayName } from './display-name'

describe('normalizeDisplayName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeDisplayName('  Live   dashboard  ')).toBe('Live dashboard')
  })

  it('returns null for empty or whitespace-only input (reset to auto name)', () => {
    expect(normalizeDisplayName('')).toBeNull()
    expect(normalizeDisplayName('   ')).toBeNull()
  })

  it('returns null for null/undefined', () => {
    expect(normalizeDisplayName(null)).toBeNull()
    expect(normalizeDisplayName(undefined)).toBeNull()
  })

  it('caps length at 200 characters', () => {
    expect(normalizeDisplayName('x'.repeat(250))).toHaveLength(200)
  })

  it('leaves interior punctuation untouched (it is a label, not a filename)', () => {
    expect(normalizeDisplayName('Q3: buyers/sellers "final"')).toBe('Q3: buyers/sellers "final"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/deliverables/display-name.test.ts`
Expected: FAIL — cannot resolve `./display-name` / `normalizeDisplayName is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/deliverables/display-name.ts
export function normalizeDisplayName(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  if (trimmed === '') return null
  return trimmed.slice(0, 200)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/deliverables/display-name.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/deliverables/display-name.ts lib/deliverables/display-name.test.ts
git commit -m "feat(deliverables): normalizeDisplayName label helper"
```

---

### Task 3: `PATCH`/`DELETE` route at `/api/deliverables/[id]`

Thin glue over the admin client and the existing `dismissDeliverable()`. Analyst-gated with an inline `requireAnalyst()` — the codebase convention (see `app/api/deliverables/[id]/resolve/route.ts` and `app/api/deliverables/upload/route.ts`, which each inline this helper). No direct route test — logic is the pure helper (Task 2, tested) plus `dismissDeliverable` (already covered in `lib/deliverables/resolve.test.ts`).

**Files:**
- Create: `app/api/deliverables/[id]/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dismissDeliverable } from '@/lib/deliverables/resolve'
import { normalizeDisplayName } from '@/lib/deliverables/display-name'
import type { TablesUpdate } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

// Inline auth helper — same pattern as app/api/deliverables/[id]/resolve/route.ts
async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

function dbUpdate(admin: ReturnType<typeof createAdminClient>, rid: string, patch: Record<string, unknown>) {
  return admin.from('deliverables').update(patch as TablesUpdate<'deliverables'>).eq('id', rid)
}

// Guard: the row must exist and not already be soft-deleted.
async function liveDeliverable(admin: ReturnType<typeof createAdminClient>, id: string) {
  return (await admin.from('deliverables').select('id, deleted_at').eq('id', id).single()).data
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { display_name?: string | null }
  const admin = createAdminClient()

  const row = await liveDeliverable(admin, id)
  if (!row || row.deleted_at) return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 })

  await dbUpdate(admin, id, { display_name: normalizeDisplayName(body.display_name) })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const row = await liveDeliverable(admin, id)
  if (!row || row.deleted_at) return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 })

  await dismissDeliverable({
    updateDeliverable: async (rid, patch) => { await dbUpdate(admin, rid, patch) },
    now: new Date(),
  }, { id })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `TablesUpdate<'deliverables'>` errors on `display_name`, Task 1 Step 2 did not land — regenerate/patch types first.)

- [ ] **Step 3: Commit**

```bash
git add app/api/deliverables/[id]/route.ts
git commit -m "feat(deliverables): PATCH rename + DELETE soft-remove route"
```

---

### Task 4: Hook — `display_name` field + rename/remove mutations

**Files:**
- Modify: `lib/hooks/useDeliverables.ts`

- [ ] **Step 1: Add `display_name` to the row type**

In `lib/hooks/useDeliverables.ts`, add `display_name` to the `DeliverableRow` type (right after `original_file_name`):

```ts
export type DeliverableRow = {
  id: string
  file_name: string | null
  original_file_name: string | null
  display_name: string | null
  kind: 'file' | 'link'
  status: string
  source: 'email' | 'upload'
  drive_file_id: string | null
  source_url: string | null
  filed_at: string | null
}
```

- [ ] **Step 2: Add `display_name` to the select**

In the `useDeliverables` query, change the `.select(...)` string to include `display_name`:

```ts
        .select('id, file_name, original_file_name, display_name, kind, status, source, drive_file_id, source_url, filed_at')
```

- [ ] **Step 3: Add the two mutations**

Append to `lib/hooks/useDeliverables.ts`:

```ts
export function useRenameDeliverable(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, displayName }: { id: string; displayName: string }) => {
      const res = await fetch(`/api/deliverables/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Rename failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverables', projectId] }),
  })
}

export function useRemoveDeliverable(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/deliverables/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Remove failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverables', projectId] }),
  })
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/useDeliverables.ts
git commit -m "feat(deliverables): rename/remove hooks + display_name field"
```

---

### Task 5: Panel UI — inline rename + remove confirm

Add hover-revealed pencil/✕ per row, an inline rename input, an inline danger confirm, and a "reset to auto name" link when an override exists. Shown name resolves to `display_name ?? file_name ?? original_file_name`.

**Files:**
- Modify: `components/deliverables/DeliverablesPanel.tsx`
- Test: `__tests__/components/deliverables/DeliverablesPanel.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Replace the contents of `__tests__/components/deliverables/DeliverablesPanel.test.tsx` with:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DeliverablesPanel } from '@/components/deliverables/DeliverablesPanel'

const rename = vi.fn()
const remove = vi.fn()

vi.mock('@/lib/hooks/useDeliverables', () => ({
  useDeliverables: () => ({
    data: [
      {
        id: '1',
        file_name: '2026.06.10 — Topline.pdf',
        original_file_name: 'Topline.pdf',
        display_name: null,
        kind: 'file',
        status: 'filed',
        source: 'email',
        drive_file_id: 'd1',
        source_url: null,
        filed_at: '2026-06-10T00:00:00Z',
      },
      {
        id: '2',
        file_name: '2026.06.10 — bit.ly/x9f2',
        original_file_name: null,
        display_name: 'Live dashboard',
        kind: 'link',
        status: 'filed',
        source: 'upload',
        drive_file_id: 'bm1',
        source_url: 'https://app.occamdata.com/study/42',
        filed_at: '2026-06-10T00:00:00Z',
      },
    ],
    isLoading: false,
  }),
  useUploadDeliverable: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameDeliverable: () => ({ mutate: rename, isPending: false }),
  useRemoveDeliverable: () => ({ mutate: remove, isPending: false }),
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('DeliverablesPanel rename & remove', () => {
  it('shows the display_name override in preference to file_name', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    expect(screen.getByRole('link', { name: 'Live dashboard' })).toBeInTheDocument()
    expect(screen.queryByText('2026.06.10 — bit.ly/x9f2')).not.toBeInTheDocument()
  })

  it('renames via the pencil: opens an input and fires the mutation with the typed value', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    fireEvent.click(screen.getAllByLabelText('Rename')[0])
    const input = screen.getByDisplayValue('2026.06.10 — Topline.pdf')
    fireEvent.change(input, { target: { value: 'Final topline' } })
    fireEvent.click(screen.getByText('Save'))
    expect(rename).toHaveBeenCalledWith(
      { id: '1', displayName: 'Final topline' },
      expect.anything(),
    )
  })

  it('Escape cancels rename without firing the mutation', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    fireEvent.click(screen.getAllByLabelText('Rename')[0])
    const input = screen.getByDisplayValue('2026.06.10 — Topline.pdf')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(rename).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '2026.06.10 — Topline.pdf' })).toBeInTheDocument()
  })

  it('remove asks for confirmation, then fires the mutation on confirm', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    fireEvent.click(screen.getAllByLabelText('Remove deliverable')[0])
    expect(screen.getByText(/stays in the client/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(remove).toHaveBeenCalledWith('1', expect.anything())
  })

  it('shows "reset to auto name" only for rows with an override', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    expect(screen.getAllByText(/reset to auto name/i)).toHaveLength(1)
  })
})
```

Note: the mocks call `mutate` with `(vars, options)` (React Query's signature), so the tests assert `expect.anything()` as the second arg.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/components/deliverables/DeliverablesPanel.test.tsx`
Expected: FAIL — no `Rename`/`Remove` controls, no reset link, and `useRenameDeliverable`/`useRemoveDeliverable` referenced by the mock aren't imported by the component yet.

- [ ] **Step 3: Rewrite `DeliverablesPanel.tsx`**

Replace the file with:

```tsx
'use client'
import { useRef, useState } from 'react'
import {
  useDeliverables,
  useUploadDeliverable,
  useRenameDeliverable,
  useRemoveDeliverable,
  type DeliverableRow,
} from '@/lib/hooks/useDeliverables'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/utils/toast'

const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`
const shownName = (d: DeliverableRow) => d.display_name ?? d.file_name ?? d.original_file_name ?? 'Untitled'

export function DeliverablesPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useDeliverables(projectId)
  const upload = useUploadDeliverable(projectId)
  const rename = useRenameDeliverable(projectId)
  const remove = useRemoveDeliverable(projectId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [link, setLink] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    upload.mutate(
      { file },
      {
        onSuccess: (r) =>
          toast(r.status === 'duplicate' ? 'Already filed — skipped' : 'Filed ✓', 'success'),
        onError: (err) => toast(String((err as Error).message)),
      }
    )
  }

  function onLink() {
    if (!link.trim()) return
    upload.mutate(
      { link: link.trim() },
      {
        onSuccess: (r) => {
          setLink('')
          toast(r.status === 'duplicate' ? 'Already filed — skipped' : 'Filed ✓', 'success')
        },
        onError: (err) => toast(String((err as Error).message)),
      }
    )
  }

  function startEdit(d: DeliverableRow) {
    setConfirmingId(null)
    setEditingId(d.id)
    setEditValue(shownName(d))
  }

  function saveEdit(id: string, value: string) {
    setEditingId(null)
    rename.mutate(
      { id, displayName: value },
      {
        onSuccess: () => toast('Renamed ✓', 'success'),
        onError: (err) => toast(String((err as Error).message)),
      }
    )
  }

  function resetName(id: string) {
    rename.mutate(
      { id, displayName: '' },
      {
        onSuccess: () => toast('Reset to auto name ✓', 'success'),
        onError: (err) => toast(String((err as Error).message)),
      }
    )
  }

  function confirmRemove(id: string) {
    setConfirmingId(null)
    remove.mutate(id, {
      onSuccess: () => toast('Removed ✓', 'success'),
      onError: (err) => toast(String((err as Error).message)),
    })
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold flex items-center">
        Deliverables
        <InfoTooltip text="Final files/links sent to the client. Stored in the client's Shared Drive folder; this list is the index." />
      </h3>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
        >
          {upload.isPending ? 'Filing…' : '+ Attach deliverable'}
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="…or paste a deliverable link"
          className="text-xs px-2 py-1.5 rounded-lg border border-border flex-1 min-w-40 bg-background focus:outline-none focus:border-ring"
        />
        <button
          onClick={onLink}
          disabled={upload.isPending || !link.trim()}
          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
        >
          Add link
        </button>
      </div>

      <ul className="mt-3 space-y-1.5">
        {isLoading && <li className="text-xs text-muted-foreground">Loading…</li>}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <li className="text-xs text-muted-foreground">No deliverables filed yet.</li>
        )}
        {data?.map((d: DeliverableRow) => {
          const name = shownName(d)

          if (editingId === d.id) {
            return (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <span>{d.kind === 'link' ? '🔗' : '📄'}</span>
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(d.id, editValue)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 text-sm px-2 py-1 rounded-lg border border-border bg-background focus:outline-none focus:border-ring"
                />
                <button onClick={() => saveEdit(d.id, editValue)} className="text-xs px-2 py-1 rounded-lg border border-border hover:bg-muted">
                  Save
                </button>
                <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 rounded-lg border border-border hover:bg-muted">
                  Cancel
                </button>
              </li>
            )
          }

          if (confirmingId === d.id) {
            return (
              <li key={d.id} className="flex items-center gap-2 text-sm bg-destructive/10 rounded-lg px-2 py-1.5">
                <span className="flex-1 text-xs text-destructive">
                  Remove <b>{name}</b>? The file stays in the client&apos;s Drive folder.
                </span>
                <button onClick={() => confirmRemove(d.id)} className="text-xs px-2 py-1 rounded-lg border border-destructive text-destructive hover:bg-destructive/10">
                  Remove
                </button>
                <button onClick={() => setConfirmingId(null)} className="text-xs px-2 py-1 rounded-lg border border-border hover:bg-muted">
                  Keep
                </button>
              </li>
            )
          }

          return (
            <li key={d.id} className="group flex items-center gap-2 text-sm">
              <span>{d.kind === 'link' ? '🔗' : '📄'}</span>
              <a
                className="flex-1 truncate hover:underline"
                href={d.source_url ?? (d.drive_file_id ? driveUrl(d.drive_file_id) : '#')}
                target="_blank"
                rel="noreferrer"
              >
                {name}
              </a>
              {d.display_name && (
                <button
                  onClick={() => resetName(d.id)}
                  className="text-[11px] text-muted-foreground hover:underline"
                >
                  reset to auto name
                </button>
              )}
              <Badge variant="secondary">{d.source}</Badge>
              {d.status !== 'filed' && <Badge variant="outline">{d.status}</Badge>}
              <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  aria-label="Rename"
                  onClick={() => startEdit(d)}
                  className="text-xs px-1.5 py-1 rounded hover:bg-muted"
                >
                  ✎
                </button>
                <button
                  aria-label="Remove deliverable"
                  onClick={() => setConfirmingId(d.id)}
                  className="text-xs px-1.5 py-1 rounded hover:bg-muted"
                >
                  ✕
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/components/deliverables/DeliverablesPanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/deliverables/DeliverablesPanel.tsx __tests__/components/deliverables/DeliverablesPanel.test.tsx
git commit -m "feat(deliverables): inline rename + remove-confirm in project panel"
```

---

## Manual verification (after all tasks)

1. Apply migration 062 to the target DB (or confirm it's applied via the normal migration flow).
2. Open a project with filed deliverables → **Deliverables** tab.
3. Hover a row → pencil + ✕ appear. Click pencil, edit, Save → name updates, toast shows, list refreshes.
4. Reload → renamed label persists (`display_name` stored).
5. Click "reset to auto name" on that row → label reverts to the Drive-based auto name.
6. Click ✕ → confirm banner appears; click Keep → nothing changes; click ✕ then Remove → row disappears; reload confirms it's gone and the file is still in the client's Drive folder.
7. Confirm a non-analyst (compliance) user gets 401 from `PATCH`/`DELETE` (RLS + route guard).

## Notes for the implementer

- **Migration numbering:** 061 is the highest existing migration; this is 062. Do not renumber.
- **Icons:** the existing panel uses plain unicode glyphs (📄/🔗). The rename/remove buttons use `✎`/`✕` to match that lightweight style — no icon library is imported here.
- **`mutate` signature:** React Query's `mutate(vars, options)` — the component passes per-call `onSuccess`/`onError` for toasts, so the hook-level `onSuccess` (cache invalidation) and the call-level `onSuccess` (toast) both run.
- **No Drive calls:** neither route touches Google Drive. Removal is `deleted_at` only; rename is `display_name` only.
