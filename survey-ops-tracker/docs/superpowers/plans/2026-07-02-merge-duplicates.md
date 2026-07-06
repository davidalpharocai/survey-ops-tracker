# Merge duplicate projects & clients — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an analyst merge two duplicate projects (or two duplicate clients) into one from inside the app, via a confirm/preview where they pick the survivor and resolve conflicting fields; the loser is soft-deleted.

**Architecture:** Structural work (re-pointing child-table foreign keys + soft-deleting the loser) runs in an atomic `security definer` Postgres RPC per type. Field conflict-resolution + array-union run as a normal typed `update` from the UI right before the RPC (keeps the RPC free of per-column type juggling). A shared preview modal drives both flows.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + RLS, `public.my_role()` = 'analyst' for internal users), TanStack Query v5, Tailwind v4. Spec: `docs/superpowers/specs/2026-07-02-merge-duplicates-design.md`.

**Conventions:** Run `npx next build` and `npx vitest run` **from the `survey-ops-tracker/` directory**. David applies SQL migrations manually in the Supabase SQL editor (the app degrades gracefully until then). Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File structure

- Create `survey-ops-tracker/supabase/migrations/044_merge.sql` — `clients.deleted_at`; `merge_projects` + `merge_clients` RPCs.
- Create `survey-ops-tracker/lib/utils/merge.ts` — pure helpers: mergeable-field lists, conflict detection, survivor-update builder (incl. array union). + `merge.test.ts`.
- Create `survey-ops-tracker/lib/hooks/useMerge.ts` — `useMergeProjects`, `useMergeClients` (apply survivor update → call RPC → invalidate).
- Create `survey-ops-tracker/components/merge/MergeModal.tsx` — the preview (survivor toggle, per-field conflict picks, "what combines" summary, Merge button).
- Create `survey-ops-tracker/components/merge/MergeButton.tsx` — the `Merge…` entry point + search picker for the other record.
- Modify `survey-ops-tracker/lib/hooks/useClients.ts` — exclude soft-deleted clients from `useClients`.
- Modify `survey-ops-tracker/app/(app)/projects/[id]/page.tsx` — add `MergeButton` to the header.
- Modify `survey-ops-tracker/app/(app)/clients/[id]/page.tsx` — add `MergeButton` to the header.
- Modify `survey-ops-tracker/lib/supabase/types.ts` — add `clients.deleted_at`.
- Modify `survey-ops-tracker/USER_GUIDE.md` — document merge (ships with the feature).

---

## Task 1: Migration — `clients.deleted_at` + merge RPCs

**Files:**
- Create: `survey-ops-tracker/supabase/migrations/044_merge.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Merge duplicate projects/clients. Structural re-pointing + soft-delete of the
-- loser, atomically. Field conflict-resolution is applied by the UI (a normal
-- typed update on the survivor) before these run.

-- Clients gain soft-delete (projects already have deleted_at).
alter table public.clients add column if not exists deleted_at timestamptz;

-- ---- merge_projects ----
create or replace function public.merge_projects(p_survivor uuid, p_loser uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  survivor_code text;
  loser_code text;
  ver_offset int;
begin
  if public.my_role() <> 'analyst' then raise exception 'Not authorized'; end if;
  if p_survivor = p_loser then raise exception 'Cannot merge a project into itself'; end if;
  if not exists (select 1 from survey_projects where id = p_survivor and deleted_at is null)
    then raise exception 'Survivor project not found'; end if;
  if not exists (select 1 from survey_projects where id = p_loser and deleted_at is null)
    then raise exception 'Loser project not found'; end if;
  if exists (select 1 from project_segments where project_id in (p_survivor, p_loser))
    then raise exception 'Un-split segmented N before merging'; end if;

  -- Simple re-points (no unique constraints on project_id):
  update project_bids        set project_id = p_survivor where project_id = p_loser;
  update project_blasts       set project_id = p_survivor where project_id = p_loser;
  update project_steps        set project_id = p_survivor where project_id = p_loser;
  update project_activity     set project_id = p_survivor where project_id = p_loser;
  update project_data_changes set project_id = p_survivor where project_id = p_loser;
  update deliverables         set project_id = p_survivor where project_id = p_loser;
  update project_audit        set project_id = p_survivor where project_id = p_loser;

  -- question_submissions has unique(project_id, version) — offset the loser's
  -- versions past the survivor's max so they don't collide.
  select coalesce(max(version), 0) into ver_offset
    from question_submissions where project_id = p_survivor;
  update question_submissions set project_id = p_survivor, version = version + ver_offset
    where project_id = p_loser;

  -- project_recipients has unique(project_id, email, role) — drop loser rows that
  -- would duplicate the survivor's, then re-point the rest.
  delete from project_recipients l
    where l.project_id = p_loser
      and exists (select 1 from project_recipients s
                  where s.project_id = p_survivor and s.email = l.email and s.role = l.role);
  update project_recipients set project_id = p_survivor where project_id = p_loser;

  -- project_seen holds transient per-user "new assignment" flags — no value in
  -- carrying them across a merge; just drop the loser's.
  delete from project_seen where project_id = p_loser;

  update survey_projects set deleted_at = now() where id = p_loser;

  select project_code into survivor_code from survey_projects where id = p_survivor;
  select project_code into loser_code   from survey_projects where id = p_loser;
  insert into project_audit(project_id, field, new_value, changed_by)
    values (p_survivor, 'merged_in', coalesce(loser_code, p_loser::text), actor);
  insert into project_audit(project_id, field, new_value, changed_by)
    values (p_loser, 'merged_into', coalesce(survivor_code, p_survivor::text), actor);
end $$;

-- ---- merge_clients ----
create or replace function public.merge_clients(p_survivor uuid, p_loser uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  survivor_name text;
begin
  if public.my_role() <> 'analyst' then raise exception 'Not authorized'; end if;
  if p_survivor = p_loser then raise exception 'Cannot merge a client into itself'; end if;
  if not exists (select 1 from clients where id = p_survivor and deleted_at is null)
    then raise exception 'Survivor client not found'; end if;
  if not exists (select 1 from clients where id = p_loser and deleted_at is null)
    then raise exception 'Loser client not found'; end if;

  select name into survivor_name from clients where id = p_survivor;

  -- Re-point the loser's projects, then fix their denormalized firm name text
  -- (keeps any " - Contact" suffix).
  update survey_projects set client_id = p_survivor where client_id = p_loser;
  update survey_projects
    set client = survivor_name ||
      (case when position(' - ' in coalesce(client, '')) > 0
            then substring(client from position(' - ' in client)) else '' end)
    where client_id = p_survivor;

  update profiles        set client_id = p_survivor where client_id = p_loser;
  update deliverables    set client_id = p_survivor where client_id = p_loser;
  update client_contacts set client_id = p_survivor where client_id = p_loser;
  update client_notes    set client_id = p_survivor where client_id = p_loser;

  update clients set deleted_at = now() where id = p_loser;
end $$;

grant execute on function public.merge_projects(uuid, uuid) to authenticated;
grant execute on function public.merge_clients(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Hand the SQL to David to run in the Supabase SQL editor.** He replies "success". (Do not proceed to depend on it in prod until applied; the UI guards below tolerate its absence by surfacing the mutation error via toast.)

- [ ] **Step 3: Verify in Supabase** with two throwaway projects: create two dummy projects, add a bid to each, run `select public.merge_projects('<survivorId>','<loserId>')`, then confirm both bids now sit on the survivor and the loser has `deleted_at` set and two `project_audit` rows (`merged_in` / `merged_into`) exist.

- [ ] **Step 4: Commit**

```bash
git add survey-ops-tracker/supabase/migrations/044_merge.sql
git commit -m "feat(merge): migration — clients.deleted_at + merge_projects/merge_clients RPCs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add `clients.deleted_at` to the DB types + exclude soft-deleted clients

**Files:**
- Modify: `survey-ops-tracker/lib/supabase/types.ts` (clients `Row`/`Insert`/`Update`)
- Modify: `survey-ops-tracker/lib/hooks/useClients.ts:8-18` (the `useClients` list query)

- [ ] **Step 1: Add `deleted_at` to the clients type.** In `types.ts`, in the `clients` table `Row` add `deleted_at: string | null` after `created_at: string`; in `Insert` and `Update` add `deleted_at?: string | null`.

- [ ] **Step 2: Exclude deleted clients from the list query.** In `useClients.ts`, change the query to:

```ts
const { data, error } = await supabase
  .from('clients')
  .select('*')
  .is('deleted_at', null)
  .order('name')
```

- [ ] **Step 3: Verify build.** Run (from `survey-ops-tracker/`): `npx next build` — Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add survey-ops-tracker/lib/supabase/types.ts survey-ops-tracker/lib/hooks/useClients.ts
git commit -m "feat(merge): clients.deleted_at type + hide soft-deleted clients from the list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Pure merge helpers (field lists, conflict detection, survivor-update builder)

**Files:**
- Create: `survey-ops-tracker/lib/utils/merge.ts`
- Test: `survey-ops-tracker/lib/utils/merge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { conflicts, buildSurvivorUpdate, PROJECT_MERGE_FIELDS } from './merge'

const A = { due_date: '2026-07-20', budget: 6000, salesperson: 'Alex', n_target: 500, linked_documents: ['a'], co_captain_ids: ['x'] }
const B = { due_date: '2026-07-25', budget: 6000, salesperson: 'Jenna', n_target: 500, linked_documents: ['b'], co_captain_ids: ['x', 'y'] }

describe('conflicts', () => {
  it('returns only fields whose values differ', () => {
    const c = conflicts(A, B, PROJECT_MERGE_FIELDS).map(f => f.key)
    expect(c).toContain('due_date')
    expect(c).toContain('salesperson')
    expect(c).not.toContain('budget')   // equal
    expect(c).not.toContain('n_target') // equal
  })
})

describe('buildSurvivorUpdate', () => {
  it('applies picks and unions array columns', () => {
    // survivor = A; pick loser's due_date + salesperson
    const upd = buildSurvivorUpdate(A, B, { due_date: 'loser', salesperson: 'loser' })
    expect(upd.due_date).toBe('2026-07-25')
    expect(upd.salesperson).toBe('Jenna')
    expect(upd.budget).toBeUndefined()               // not a conflict → untouched
    expect(upd.linked_documents?.sort()).toEqual(['a', 'b'])   // union
    expect(upd.co_captain_ids?.sort()).toEqual(['x', 'y'])     // union, de-duped
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/utils/merge.test.ts`
Expected: FAIL ("Cannot find module './merge'").

- [ ] **Step 3: Write the implementation**

```ts
export type MergeField = { key: string; label: string }

// Scalar fields a user resolves in the preview (only differing ones surface).
export const PROJECT_MERGE_FIELDS: MergeField[] = [
  { key: 'project_name', label: 'Project name' },
  { key: 'project_type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'scoping_stage', label: 'Scoping stage' },
  { key: 'submitted_date', label: 'Submitted' },
  { key: 'launch_date', label: 'Launch date' },
  { key: 'due_date', label: 'Due date' },
  { key: 'deliver_date', label: 'Deliver date' },
  { key: 'n_target', label: 'N target' },
  { key: 'n_internal_target', label: 'N internal target' },
  { key: 'n_actual', label: 'N actual' },
  { key: 'audience_size', label: 'Audience size' },
  { key: 'salesperson', label: 'Salesperson' },
  { key: 'priority', label: 'Priority' },
  { key: 'budget', label: 'Total budget' },
  { key: 'category', label: 'Category' },
  { key: 'objective', label: 'Objective' },
  { key: 'longitudinal', label: 'Longitudinal' },
  { key: 'voter_survey_qa', label: 'Voter survey QA' },
  { key: 'citation_language_needed', label: 'Citation language' },
  { key: 'row_level_data', label: 'Row-level data' },
  { key: 'terminations', label: 'Terminations' },
]

export const CLIENT_MERGE_FIELDS: MergeField[] = [
  { key: 'name', label: 'Client name' },
  { key: 'code', label: 'Client ID' },
  { key: 'compliance_before_fielding', label: 'Compliance before fielding' },
  { key: 'compliance_after_fielding', label: 'Compliance after fielding' },
  { key: 'compliance_contact', label: 'Compliance contact' },
  { key: 'compliance_notes', label: 'Compliance notes' },
]

// Array columns that always UNION (never a pick).
const PROJECT_ARRAY_FIELDS = ['linked_documents', 'co_captain_ids'] as const

type Row = Record<string, unknown>

/** Fields (from `fields`) whose values differ between survivor and loser. */
export function conflicts(survivor: Row, loser: Row, fields: MergeField[]): MergeField[] {
  return fields.filter(f => !valuesEqual(survivor[f.key], loser[f.key]))
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null)
}

/**
 * The `update` payload for the survivor: for each conflicting field where the
 * user picked 'loser', take the loser's value; union the array columns.
 * `picks` maps fieldKey -> 'survivor' | 'loser'.
 */
export function buildSurvivorUpdate(
  survivor: Row,
  loser: Row,
  picks: Record<string, 'survivor' | 'loser'>
): Row {
  const update: Row = {}
  for (const [key, choice] of Object.entries(picks)) {
    if (choice === 'loser') update[key] = loser[key] ?? null
  }
  for (const key of PROJECT_ARRAY_FIELDS) {
    const s = (survivor[key] as unknown[] | null) ?? []
    const l = (loser[key] as unknown[] | null) ?? []
    if (s.length || l.length) update[key] = Array.from(new Set([...s, ...l]))
  }
  return update
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/utils/merge.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add survey-ops-tracker/lib/utils/merge.ts survey-ops-tracker/lib/utils/merge.test.ts
git commit -m "feat(merge): pure helpers for conflict detection + survivor-update building

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Merge mutation hooks

**Files:**
- Create: `survey-ops-tracker/lib/hooks/useMerge.ts`

Each hook: (1) apply the survivor field/array update (skip if empty), (2) call the RPC, (3) invalidate caches. The `buildSurvivorUpdate` output comes from the modal.

- [ ] **Step 1: Write the implementation**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'

type MergeArgs = { survivorId: string; loserId: string; survivorUpdate: Record<string, unknown> }

export function useMergeProjects() {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ survivorId, loserId, survivorUpdate }: MergeArgs) => {
      if (Object.keys(survivorUpdate).length > 0) {
        const { error } = await supabase.from('survey_projects').update(survivorUpdate).eq('id', survivorId)
        if (error) throw error
      }
      const { error } = await supabase.rpc('merge_projects', { p_survivor: survivorId, p_loser: loserId })
      if (error) throw error
    },
    onError: (e: unknown) => toast(`Couldn't merge — ${(e as Error).message ?? 'please try again.'}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['internal-projects'] })
      qc.invalidateQueries({ queryKey: ['project'] })
    },
  })
}

export function useMergeClients() {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ survivorId, loserId, survivorUpdate }: MergeArgs) => {
      if (Object.keys(survivorUpdate).length > 0) {
        const { error } = await supabase.from('clients').update(survivorUpdate).eq('id', survivorId)
        if (error) throw error
      }
      const { error } = await supabase.rpc('merge_clients', { p_survivor: survivorId, p_loser: loserId })
      if (error) throw error
    },
    onError: (e: unknown) => toast(`Couldn't merge — ${(e as Error).message ?? 'please try again.'}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
```

- [ ] **Step 2: Add the RPC names to the generated types (so `.rpc()` type-checks).** In `types.ts`, under `public` → `Functions`, add entries for `merge_projects` and `merge_clients` each with `Args: { p_survivor: string; p_loser: string }` and `Returns: undefined`. (If `Functions` is `{ [_ in never]: never }`, replace with the two entries.)

- [ ] **Step 3: Verify build.** Run: `npx next build` — Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add survey-ops-tracker/lib/hooks/useMerge.ts survey-ops-tracker/lib/supabase/types.ts
git commit -m "feat(merge): useMergeProjects/useMergeClients hooks + RPC types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Merge preview modal

**Files:**
- Create: `survey-ops-tracker/components/merge/MergeModal.tsx`
- Test: `survey-ops-tracker/components/merge/MergeModal.test.tsx`

Props: `{ kind: 'project' | 'client'; a: Row; b: Row; open: boolean; onClose: () => void }` where `a` is the record you started from and `b` is the one picked in the search. Internally: `survivorId` state (defaults to `a.id`), `picks` state (per conflicting field). Uses `conflicts`/`buildSurvivorUpdate` and the matching merge hook.

- [ ] **Step 1: Write the failing test** (renders differing fields, defaults survivor to `a`, calls the hook on Merge)

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MergeModal } from './MergeModal'

const mutate = vi.fn()
vi.mock('@/lib/hooks/useMerge', () => ({
  useMergeProjects: () => ({ mutate, isPending: false }),
  useMergeClients: () => ({ mutate, isPending: false }),
}))

const a = { id: 'A', project_name: 'Tracker', due_date: '2026-07-20', budget: 6000, project_code: 'PR001' }
const b = { id: 'B', project_name: 'Tracker', due_date: '2026-07-25', budget: 6000, project_code: 'PR002' }

it('shows only differing fields and merges with the survivor + picks', () => {
  render(<MergeModal kind="project" a={a} b={b} open onClose={() => {}} />)
  expect(screen.getByText('Due date')).toBeInTheDocument()
  expect(screen.queryByText('Total budget')).not.toBeInTheDocument() // equal → hidden
  fireEvent.click(screen.getByRole('button', { name: /^Merge/ }))
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ survivorId: 'A', loserId: 'B' }),
    expect.anything()
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/merge/MergeModal.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```tsx
'use client'
import { useState } from 'react'
import { conflicts, buildSurvivorUpdate, PROJECT_MERGE_FIELDS, CLIENT_MERGE_FIELDS } from '@/lib/utils/merge'
import { useMergeProjects, useMergeClients } from '@/lib/hooks/useMerge'

type Row = Record<string, any>
type Props = { kind: 'project' | 'client'; a: Row; b: Row; open: boolean; onClose: () => void }

const COMBINES: Record<'project' | 'client', string[]> = {
  project: ['Bids & blasts', 'Next steps', 'Linked docs', 'Deliverables', 'Compliance submissions', 'Notes, activity & audit history'],
  client: ['Projects', 'Contacts', 'Notes', 'Portal reviewers', 'Deliverables'],
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

export function MergeModal({ kind, a, b, open, onClose }: Props) {
  const fields = kind === 'project' ? PROJECT_MERGE_FIELDS : CLIENT_MERGE_FIELDS
  const codeKey = kind === 'project' ? 'project_code' : 'code'
  const nameKey = kind === 'project' ? 'project_name' : 'name'
  const mergeProjects = useMergeProjects()
  const mergeClients = useMergeClients()
  const merge = kind === 'project' ? mergeProjects : mergeClients

  const [survivorId, setSurvivorId] = useState<string>(a.id)
  const [picks, setPicks] = useState<Record<string, 'survivor' | 'loser'>>({})

  if (!open) return null
  const survivor = survivorId === a.id ? a : b
  const loser = survivorId === a.id ? b : a
  const diff = conflicts(survivor, loser, fields)

  function doMerge() {
    const survivorUpdate = buildSurvivorUpdate(survivor, loser, picks)
    merge.mutate(
      { survivorId: survivor.id, loserId: loser.id, survivorUpdate },
      { onSuccess: onClose }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-card border border-border rounded-xl p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-foreground">Merge {kind}s</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">Pick which record survives. The other is soft-deleted (recoverable in Admin).</p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {[a, b].map(rec => (
            <button
              key={rec.id}
              onClick={() => { setSurvivorId(rec.id); setPicks({}) }}
              className={`text-left rounded-lg p-3 border ${survivorId === rec.id ? 'border-2 border-blue-500' : 'border-border'}`}
            >
              <span className={`text-[11px] ${survivorId === rec.id ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                {survivorId === rec.id ? 'Survivor' : 'Merges away'}
              </span>
              <span className="block text-sm text-foreground truncate">{fmt(rec[nameKey])}</span>
              <span className="block text-xs text-muted-foreground">{fmt(rec[codeKey])}</span>
            </button>
          ))}
        </div>

        {diff.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">Resolve differences ({diff.length})</p>
            <div className="flex flex-col gap-2">
              {diff.map(f => {
                const chosen = picks[f.key] ?? 'survivor'
                return (
                  <div key={f.key} className="grid grid-cols-[110px_1fr_1fr] gap-2 items-center text-sm">
                    <span className="text-muted-foreground">{f.label}</span>
                    {(['survivor', 'loser'] as const).map(side => {
                      const val = side === 'survivor' ? survivor[f.key] : loser[f.key]
                      const active = chosen === side
                      return (
                        <button
                          key={side}
                          onClick={() => setPicks(p => ({ ...p, [f.key]: side }))}
                          className={`text-center rounded px-2 py-1 truncate ${active ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500' : 'border border-border text-muted-foreground'}`}
                        >
                          {fmt(val)}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mb-4">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Everything else combines</p>
          <p className="text-xs text-muted-foreground">{COMBINES[kind].join(' · ')}</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5">Cancel</button>
          <button onClick={doMerge} disabled={merge.isPending} className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg">
            {merge.isPending ? 'Merging…' : `Merge into ${fmt(survivor[codeKey])}`}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/merge/MergeModal.test.tsx` — Expected: PASS. (If `@testing-library/react` isn't set up, follow the pattern in `__tests__/components/board/ProjectCard.test.tsx`.)

- [ ] **Step 5: Commit**

```bash
git add survey-ops-tracker/components/merge/MergeModal.tsx survey-ops-tracker/components/merge/MergeModal.test.tsx
git commit -m "feat(merge): preview modal — survivor pick, per-field conflicts, combine summary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `Merge…` button + search picker

**Files:**
- Create: `survey-ops-tracker/components/merge/MergeButton.tsx`

Renders a `Merge…` button; on click opens a small search popover to find the OTHER record (same kind), then opens `MergeModal` with `a = current record`, `b = picked record`. Search queries the matching table, excluding the current id and soft-deleted rows.

- [ ] **Step 1: Write the implementation**

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MergeModal } from './MergeModal'

type Row = Record<string, any>

export function MergeButton({ kind, record }: { kind: 'project' | 'client'; record: Row }) {
  const supabase = createClient()
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Row[]>([])
  const [other, setOther] = useState<Row | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const table = kind === 'project' ? 'survey_projects' : 'clients'
  const nameKey = kind === 'project' ? 'project_name' : 'name'
  const codeKey = kind === 'project' ? 'project_code' : 'code'

  useEffect(() => {
    if (!picking || q.trim().length < 2) { setResults([]); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const { data } = await supabase
        .from(table)
        .select('*')
        .is('deleted_at', null)
        .neq('id', record.id)
        .ilike(nameKey, `%${q.trim()}%`)
        .limit(8)
      setResults((data as Row[]) ?? [])
    }, 200)
  }, [q, picking, table, nameKey, record.id, supabase])

  return (
    <>
      <button
        onClick={() => setPicking(true)}
        className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
        title={`Merge this ${kind} with a duplicate`}
      >
        Merge…
      </button>

      {picking && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-24" onClick={() => setPicking(false)}>
          <div className="w-full max-w-md bg-card border border-border rounded-xl p-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium text-foreground mb-2">Find the duplicate {kind} to merge with</p>
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder={`Search ${kind} by name…`}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
            />
            <div className="mt-2 flex flex-col gap-1 max-h-[16rem] overflow-y-auto">
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => { setOther(r); setPicking(false); setQ('') }}
                  className="text-left rounded px-2 py-1.5 hover:bg-accent transition-colors"
                >
                  <span className="block text-sm text-foreground truncate">{r[nameKey]}</span>
                  <span className="block text-xs text-muted-foreground">{r[codeKey] ?? ''}</span>
                </button>
              ))}
              {q.trim().length >= 2 && results.length === 0 && (
                <p className="text-xs text-muted-foreground/60 px-2 py-2">No matches.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {other && <MergeModal kind={kind} a={record} b={other} open onClose={() => setOther(null)} />}
    </>
  )
}
```

- [ ] **Step 2: Verify build.** Run: `npx next build` — Expected: compiles clean.

- [ ] **Step 3: Commit**

```bash
git add survey-ops-tracker/components/merge/MergeButton.tsx
git commit -m "feat(merge): Merge… entry point with same-type search picker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Wire `MergeButton` into the project and client pages

**Files:**
- Modify: `survey-ops-tracker/app/(app)/projects/[id]/page.tsx` (header button row, near the ⚑/⏸/✕/🗑 buttons)
- Modify: `survey-ops-tracker/app/(app)/clients/[id]/page.tsx` (header row, next to "All clients →")

- [ ] **Step 1: Project page** — add the import `import { MergeButton } from '@/components/merge/MergeButton'` and render `<MergeButton kind="project" record={project} />` in the header button group.

- [ ] **Step 2: Client page** — add the import and render `<MergeButton kind="client" record={c} />` in the header row (the flex row containing the `ClientNameHeading` and "All clients →").

- [ ] **Step 3: Verify build.** Run: `npx next build` — Expected: compiles clean; `/projects/[id]` and `/clients/[id]` both build.

- [ ] **Step 4: Commit**

```bash
git add "survey-ops-tracker/app/(app)/projects/[id]/page.tsx" "survey-ops-tracker/app/(app)/clients/[id]/page.tsx"
git commit -m "feat(merge): add Merge… button to project and client pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: User guide + final verification

**Files:**
- Modify: `survey-ops-tracker/USER_GUIDE.md`

- [ ] **Step 1: Document merge** under section 7 (Project IDs & Admin) or the client-pages bullet: explain that a `Merge…` button on a project or client page finds a duplicate, shows a preview to pick the survivor and resolve differing fields, combines everything else, and soft-deletes the loser (recoverable in Admin). Note segmented-N projects must be un-split first.

- [ ] **Step 2: Full verification.** Run (from `survey-ops-tracker/`): `npx next build` and `npx vitest run`. Expected: build clean; all tests pass (including `merge.test.ts` and `MergeModal.test.tsx`).

- [ ] **Step 3: Manual smoke test in the deployed app** (after migration 044 is applied): create two dummy projects, add a bid/next-step to the loser, Merge them → confirm the survivor absorbs the child rows, differing fields resolve to the picks, and the loser lands in Admin → Recently Deleted. Repeat for two dummy clients.

- [ ] **Step 4: Commit + push**

```bash
git add survey-ops-tracker/USER_GUIDE.md
git commit -m "docs(merge): document the merge feature in the user guide

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

## Notes / decisions carried from the spec

- **Atomicity:** the RPC is one transaction (all child re-points + soft-delete). The survivor field-update runs just before it as a normal typed update; on the rare failure between them, re-running the merge is idempotent (overrides re-apply, child re-points are no-ops once moved).
- **Deleted clients:** `useClients` now filters `deleted_at is null`. If any other client picker/list surfaces during build (e.g., a client dropdown on project create), apply the same `.is('deleted_at', null)` filter.
- **Segmented projects** are blocked in the RPC (raises) and the error surfaces via the merge hook's toast.
- **Out of scope (v1):** auto duplicate detection, one-click undo, per-item choice within combined lists, cross-type merges, a dedicated Duplicates screen, showing live child-row counts in the combine summary (static category list for now).
