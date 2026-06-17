# Compliance Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag clients with compliance requirements (before-fielding / after-fielding) and block a survey from being fielded or delivered until the matching compliance review is approved — with an audited analyst override — reusing the existing compliance-reviewer portal.

**Architecture:** Add per-client compliance flags + a per-project override to the existing tables. Reuse `question_submissions` for both reviews by adding a `phase` (`before_fielding` | `after_fielding`) and a `results_url`. A pure `lib/utils/compliance.ts` computes gate state from a project + its client flags + its submissions; both the detail-page stage checkboxes and the board drag consult it before advancing to Fielding (before-gate) or marking Delivered (after-gate). UI shows the flag in Admin → Accounts and a banner on the project page.

**Tech Stack:** Next.js 15, Supabase (Postgres + RLS), TanStack Query, Tailwind v4, vitest. SheetJS for the sync script.

**Spec:** `docs/superpowers/specs/2026-06-17-compliance-guardrails-design.md`

**Stage-model note (critical):** `getCheckboxesForColumn` / `deriveCurrentStage` in `lib/utils/stage.ts` mean: a project is *in* the Fielding column when `stage_edwin_qa = true` (EdWin QA done) and `stage_fielding = false`. "Delivered" = `stage_delivery = true`. So:
- **Before-fielding gate** fires when a transition would move the project to board_column **Fielding or later** (i.e. checking `stage_edwin_qa`, or dragging to Fielding/Data QA/Delivery).
- **After-fielding gate** fires when a transition would set **`stage_delivery = true`** (the final "Delivered" checkbox, or dragging to mark delivery complete).

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `supabase/migrations/037_compliance_flags.sql` | client flags, project override, submission `phase`+`results_url` | New |
| `lib/supabase/types.ts` | type the new columns | Modify |
| `lib/utils/compliance.ts` | pure gate-state logic (no React/DB) | New |
| `lib/utils/compliance.test.ts` | unit tests for the above | New |
| `lib/hooks/useClients.ts` | shared client fetch incl. compliance flags + a single-client hook + update mutation | New (extract from admin page) |
| `lib/hooks/useComplianceState.ts` | per-project hook: combines client flags + submissions → gate state | New |
| `components/project/ComplianceGateModal.tsx` | block/override modal | New |
| `components/project/ComplianceBanner.tsx` | project-page "review outstanding" banner | New |
| `components/project/PipelineProgress.tsx` | consult the gate before advancing; open modal | Modify |
| `components/board/Board.tsx` | consult the gate on drag to Fielding+/Delivered | Modify |
| `components/compliance/CompliancePanel.tsx` | support after-fielding (results) submission + show both phases | Modify |
| `components/compliance/SubmitQuestionsModal.tsx` | accept `phase` + `resultsUrl` | Modify |
| `app/api/submissions/route.ts` | accept `phase` + `results_url` on create | Modify |
| `app/(portal)/portal/review/[submissionId]/page.tsx` | show results link for after-fielding | Modify |
| `app/(app)/admin/page.tsx` + `app/(app)/clients/[id]/page.tsx` | compliance badge/filter + flag editor | Modify |
| `scripts/seed-compliance.mjs` | one-time seed client flags from the Compliance tab | New |
| `scripts/compliance-diff.mjs` | true-up sheet ↔ app, report conflicts | New |
| `USER_GUIDE.md` | document the feature | Modify |

---

## Task 1: Migration — compliance columns

**Files:**
- Create: `supabase/migrations/037_compliance_flags.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Compliance guardrails: per-client requirement flags, a per-project override,
-- and a phase + results link on submissions so the existing reviewer portal can
-- handle both the before-fielding (questions) and after-fielding (results) reviews.

alter table public.clients
  add column if not exists compliance_before_fielding boolean not null default false,
  add column if not exists compliance_after_fielding  boolean not null default false,
  add column if not exists compliance_contact text,
  add column if not exists compliance_notes text;

-- Per-project override: null = follow the client; true = force compliance; false = skip.
alter table public.survey_projects
  add column if not exists compliance_override boolean;

-- Reuse question_submissions for both reviews.
alter table public.question_submissions
  add column if not exists phase text not null default 'before_fielding',
  add column if not exists results_url text;

alter table public.question_submissions
  drop constraint if exists question_submissions_phase_check;
alter table public.question_submissions
  add constraint question_submissions_phase_check check (phase in ('before_fielding','after_fielding'));

create index if not exists submissions_project_phase_idx
  on public.question_submissions (project_id, phase, version desc);
```

- [ ] **Step 2: Hand to David to run**

This project applies SQL manually in the Supabase SQL editor (David runs it, replies "success"). Do NOT attempt to run it from CI. Mark this step done once confirmed.

- [ ] **Step 3: Commit**

```bash
git add survey-ops-tracker/supabase/migrations/037_compliance_flags.sql
git commit -m "feat(compliance): migration — client flags, project override, submission phase+results_url"
```

---

## Task 2: Types

**Files:**
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: Add the columns to the generated types**

In `clients` Row/Insert/Update add: `compliance_before_fielding: boolean`, `compliance_after_fielding: boolean`, `compliance_contact: string | null`, `compliance_notes: string | null` (optional `?` in Insert/Update).
In `survey_projects` Row/Insert/Update add: `compliance_override: boolean | null`.
In `question_submissions` Row/Insert/Update add: `phase: string` (default in Insert) and `results_url: string | null`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (or `npx next build`). Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add survey-ops-tracker/lib/supabase/types.ts
git commit -m "feat(compliance): types for new compliance columns"
```

---

## Task 3: Pure gate logic (TDD)

**Files:**
- Create: `lib/utils/compliance.ts`
- Test: `lib/utils/compliance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  beforeFieldingRequired, afterFieldingRequired,
  beforeFieldingMet, afterFieldingMet,
  complianceGate, type ClientCompliance, type SubmissionLite,
} from './compliance'

const client = (o: Partial<ClientCompliance> = {}): ClientCompliance => ({
  compliance_before_fielding: false, compliance_after_fielding: false, ...o,
})
const sub = (phase: string, status: string): SubmissionLite => ({ phase, status })

describe('compliance requirement', () => {
  it('uses client flags when override is null', () => {
    expect(beforeFieldingRequired(client({ compliance_before_fielding: true }), null)).toBe(true)
    expect(afterFieldingRequired(client({ compliance_after_fielding: true }), null)).toBe(true)
    expect(beforeFieldingRequired(client(), null)).toBe(false)
  })
  it('override=false skips compliance even if the client requires it', () => {
    expect(beforeFieldingRequired(client({ compliance_before_fielding: true }), false)).toBe(false)
    expect(afterFieldingRequired(client({ compliance_after_fielding: true }), false)).toBe(false)
  })
  it('override=true forces both even if the client requires neither', () => {
    expect(beforeFieldingRequired(client(), true)).toBe(true)
    expect(afterFieldingRequired(client(), true)).toBe(true)
  })
  it('a missing client (null) means no requirement', () => {
    expect(beforeFieldingRequired(null, null)).toBe(false)
    expect(afterFieldingRequired(null, null)).toBe(false)
  })
})

describe('requirement met', () => {
  it('met only when an approved submission of that phase exists', () => {
    expect(beforeFieldingMet([sub('before_fielding', 'approved')])).toBe(true)
    expect(beforeFieldingMet([sub('before_fielding', 'pending_review')])).toBe(false)
    expect(beforeFieldingMet([sub('after_fielding', 'approved')])).toBe(false)
    expect(afterFieldingMet([sub('after_fielding', 'approved')])).toBe(true)
    expect(afterFieldingMet([])).toBe(false)
  })
})

describe('complianceGate', () => {
  const reqBoth = client({ compliance_before_fielding: true, compliance_after_fielding: true })
  it('blocks advancing to Fielding when before-fielding required and not met', () => {
    const g = complianceGate({ targetColumn: 'Fielding', willMarkDelivered: false, client: reqBoth, override: null, submissions: [] })
    expect(g.blocked).toBe(true)
    expect(g.phase).toBe('before_fielding')
  })
  it('allows Fielding once before-fielding is approved', () => {
    const g = complianceGate({ targetColumn: 'Fielding', willMarkDelivered: false, client: reqBoth, override: null, submissions: [sub('before_fielding', 'approved')] })
    expect(g.blocked).toBe(false)
  })
  it('blocks marking Delivered when after-fielding required and not met', () => {
    const g = complianceGate({ targetColumn: 'Delivery', willMarkDelivered: true, client: reqBoth, override: null, submissions: [sub('before_fielding', 'approved')] })
    expect(g.blocked).toBe(true)
    expect(g.phase).toBe('after_fielding')
  })
  it('does not gate stages before Fielding', () => {
    const g = complianceGate({ targetColumn: 'Doc Programming', willMarkDelivered: false, client: reqBoth, override: null, submissions: [] })
    expect(g.blocked).toBe(false)
  })
  it('never blocks when nothing is required', () => {
    const g = complianceGate({ targetColumn: 'Delivery', willMarkDelivered: true, client: client(), override: null, submissions: [] })
    expect(g.blocked).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/utils/compliance.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { STAGE_ORDER, type BoardColumn } from './stage'

export interface ClientCompliance {
  compliance_before_fielding: boolean
  compliance_after_fielding: boolean
}
export interface SubmissionLite {
  phase: string
  status: string
}

export function beforeFieldingRequired(client: ClientCompliance | null, override: boolean | null): boolean {
  if (override === true) return true
  if (override === false) return false
  return !!client?.compliance_before_fielding
}
export function afterFieldingRequired(client: ClientCompliance | null, override: boolean | null): boolean {
  if (override === true) return true
  if (override === false) return false
  return !!client?.compliance_after_fielding
}

const approvedOf = (subs: SubmissionLite[], phase: string) =>
  subs.some(s => s.phase === phase && s.status === 'approved')

export const beforeFieldingMet = (subs: SubmissionLite[]) => approvedOf(subs, 'before_fielding')
export const afterFieldingMet = (subs: SubmissionLite[]) => approvedOf(subs, 'after_fielding')

const FIELDING_IDX = STAGE_ORDER.indexOf('Fielding')

export interface GateInput {
  targetColumn: BoardColumn
  willMarkDelivered: boolean
  client: ClientCompliance | null
  override: boolean | null
  submissions: SubmissionLite[]
}
export interface GateResult {
  blocked: boolean
  phase: 'before_fielding' | 'after_fielding' | null
  message: string
}

export function complianceGate(input: GateInput): GateResult {
  const { targetColumn, willMarkDelivered, client, override, submissions } = input
  // After-fielding gate: marking the final Delivered box.
  if (willMarkDelivered && afterFieldingRequired(client, override) && !afterFieldingMet(submissions)) {
    return { blocked: true, phase: 'after_fielding',
      message: 'This client requires an after-fielding compliance review (questions + results) before delivery, and it has not been approved yet.' }
  }
  // Before-fielding gate: advancing into Fielding or later.
  const targetIdx = STAGE_ORDER.indexOf(targetColumn)
  if (targetIdx >= FIELDING_IDX && beforeFieldingRequired(client, override) && !beforeFieldingMet(submissions)) {
    return { blocked: true, phase: 'before_fielding',
      message: 'This client requires the questionnaire to be approved by compliance before the survey is fielded, and it has not been approved yet.' }
  }
  return { blocked: false, phase: null, message: '' }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/utils/compliance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add survey-ops-tracker/lib/utils/compliance.ts survey-ops-tracker/lib/utils/compliance.test.ts
git commit -m "feat(compliance): pure gate-state logic with tests"
```

---

## Task 4: Client + compliance-state hooks

**Files:**
- Create: `lib/hooks/useClients.ts`
- Create: `lib/hooks/useComplianceState.ts`

- [ ] **Step 1: `useClients.ts`** — shared client fetch (replaces the inline `useClients` in admin/page.tsx), a single-client hook, and an update mutation.

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

export type Client = Database['public']['Tables']['clients']['Row']

export function useClients() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name')
      if (error) throw error
      return data as Client[]
    },
  })
}

export function useClient(id: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      return data as Client | null
    },
    enabled: !!id,
  })
}

export function useUpdateClient() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Client> }) => {
      const { error } = await supabase.from('clients').update(updates).eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't save the client — please try again."),
    onSettled: (_d, _e, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      queryClient.invalidateQueries({ queryKey: ['client', id] })
    },
  })
}
```

- [ ] **Step 2: `useComplianceState.ts`** — combine a project's client flags + submissions into gate state.

```ts
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { ClientCompliance, SubmissionLite } from '@/lib/utils/compliance'

export interface ComplianceState {
  client: ClientCompliance | null
  override: boolean | null
  submissions: SubmissionLite[]
  contact: string | null
  notes: string | null
}

// clientName is the project's firm-level client text; match the clients row by name.
export function useComplianceState(projectId: string, clientName: string, override: boolean | null) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['compliance-state', projectId, clientName],
    queryFn: async (): Promise<ComplianceState> => {
      const firm = clientName.split(' - ')[0].trim()
      const { data: c } = await supabase
        .from('clients')
        .select('compliance_before_fielding, compliance_after_fielding, compliance_contact, compliance_notes')
        .eq('name', firm)
        .maybeSingle()
      const { data: subs } = await supabase
        .from('question_submissions')
        .select('phase, status')
        .eq('project_id', projectId)
      return {
        client: c ? { compliance_before_fielding: c.compliance_before_fielding, compliance_after_fielding: c.compliance_after_fielding } : null,
        override,
        submissions: (subs ?? []) as SubmissionLite[],
        contact: c?.compliance_contact ?? null,
        notes: c?.compliance_notes ?? null,
      }
    },
    enabled: !!projectId && !!clientName,
    staleTime: 15_000,
  })
}
```

- [ ] **Step 3:** Update `app/(app)/admin/page.tsx` to import `useClients` from the new hook (delete the local `useClients`). Run `npx next build`; expected pass.

- [ ] **Step 4: Commit**

```bash
git add survey-ops-tracker/lib/hooks/useClients.ts survey-ops-tracker/lib/hooks/useComplianceState.ts "survey-ops-tracker/app/(app)/admin/page.tsx"
git commit -m "feat(compliance): client + compliance-state hooks"
```

---

## Task 5: Gate modal + detail-page guardrail

**Files:**
- Create: `components/project/ComplianceGateModal.tsx`
- Modify: `components/project/PipelineProgress.tsx`

- [ ] **Step 1: `ComplianceGateModal.tsx`** — explains the block; offers Override (typed reason) or Cancel.

```tsx
'use client'
import { useState } from 'react'

export function ComplianceGateModal({
  message, contact, onCancel, onOverride,
}: {
  message: string
  contact: string | null
  onCancel: () => void
  onOverride: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-md flex flex-col gap-3 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-foreground">Compliance review required</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>
        {contact && <p className="text-xs text-muted-foreground">Compliance contact: <span className="text-foreground">{contact}</span></p>}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Override reason (recorded in the audit log)
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Why are you proceeding without approval?"
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring" />
        </label>
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-3 py-2">Cancel</button>
          <button onClick={() => reason.trim() && onOverride(reason.trim())} disabled={!reason.trim()}
            className="text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors">
            Override &amp; proceed
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the gate into `PipelineProgress.tsx`.** Compute the target column for the stage being toggled, call `complianceGate`, and if blocked open the modal; the override path writes an audit entry then proceeds.

  - Add props: `PipelineProgress` already receives `project`. Add a `useComplianceState(project.id, project.client, project.compliance_override ?? null)` call and import `complianceGate` + `deriveColumn` is already local.
  - In `toggleStage`, after computing `newState` and `newColumn`, before `updateProject.mutate`, compute:
    ```ts
    const willMarkDelivered = newState.stage_delivery === true && !project.stage_delivery
    const gate = complianceGate({ targetColumn: newColumn, willMarkDelivered, client: cs?.client ?? null, override: project.compliance_override ?? null, submissions: cs?.submissions ?? [] })
    if (gate.blocked) { setGate({ ...gate, proceed: () => applyMove(newState, newColumn) }); return }
    applyMove(newState, newColumn)
    ```
    where `applyMove` is the existing `updateProject.mutate({ id, updates: { ...newState, board_column } })`.
  - On override: call `applyMove` AND write an audit row via a `latest_next_steps`-style stamped note is NOT right — instead insert into `project_audit` through a tiny helper. Simplest: `updateProject.mutate` with a sentinel field the audit trigger logs. Since the generic audit trigger (035) only logs real column changes, add the override note explicitly:
    ```ts
    await supabase.from('project_audit').insert({
      project_id: project.id, field: '(compliance override)',
      old_value: gate.phase, new_value: reason, changed_by: currentUserEmail ?? 'system',
    })
    ```
    (Get `currentUserEmail` from the existing `useCurrentMember`/auth context used elsewhere on the page; if not present, omit `changed_by` to let the default apply.)

- [ ] **Step 3: Build + manual check**

Run: `npx next build`. Expected: pass. Manually: a project whose client requires before-fielding can't be advanced to Fielding without approval; override with a reason proceeds and logs.

- [ ] **Step 4: Commit**

```bash
git add survey-ops-tracker/components/project/ComplianceGateModal.tsx survey-ops-tracker/components/project/PipelineProgress.tsx
git commit -m "feat(compliance): stage gate + override modal on the project page"
```

---

## Task 6: Board drag guardrail

**Files:**
- Modify: `components/board/Board.tsx`

- [ ] **Step 1:** In `handleDragEnd`, before applying the move, run the same gate for drag-to-Fielding-or-later. The board has many cards and doesn't fetch per-client flags; fetch a lightweight compliance map once.

  - Add a query in `Board` for clients requiring compliance: `select name, compliance_before_fielding, compliance_after_fielding from clients where compliance_before_fielding or compliance_after_fielding`, build a `Map<firmName, ClientCompliance>`.
  - Add a query for approved-before-fielding submissions per project (`select project_id, phase, status from question_submissions where status = 'approved'`), build `Map<projectId, SubmissionLite[]>`.
  - In `handleDragEnd`, compute `firm = project.client.split(' - ')[0].trim()`, look up the client compliance + submissions, and call `complianceGate({ targetColumn: newColumn, willMarkDelivered: false, client, override: project's override (not on SlimProject — add `compliance_override` to SLIM_PROJECT_COLUMNS in useProjects.ts), submissions })`. Note: dragging never sets `stage_delivery=true` (Delivery column ≠ delivered), so `willMarkDelivered` is always false for drag — only the before-fielding gate applies on the board.
  - If blocked: revert the optimistic move (don't call `onMoveProject`), and `toast(gate.message + ' Open the project to review or override.')`. (Override on the board is out of scope — direct the user to the project page.)

- [ ] **Step 2:** Add `compliance_override` to `SLIM_PROJECT_COLUMNS` in `lib/hooks/useProjects.ts` so the board has it.

- [ ] **Step 3: Build.** Run `npx next build`; expected pass.

- [ ] **Step 4: Commit**

```bash
git add survey-ops-tracker/components/board/Board.tsx survey-ops-tracker/lib/hooks/useProjects.ts
git commit -m "feat(compliance): block drag into Fielding without before-fielding approval"
```

---

## Task 7: After-fielding (results) review

**Files:**
- Modify: `app/api/submissions/route.ts`, `components/compliance/SubmitQuestionsModal.tsx`, `components/compliance/CompliancePanel.tsx`, `app/(portal)/portal/review/[submissionId]/page.tsx`

- [ ] **Step 1:** `app/api/submissions/route.ts` — accept optional `phase` (default `before_fielding`) and `results_url` in the POST body and write them to the new submission row. (Read the file first; add the two fields to the insert object and the request body type. Keep existing validation.)

- [ ] **Step 2:** `SubmitQuestionsModal.tsx` — accept optional props `phase?: 'before_fielding' | 'after_fielding'` and `resultsUrl?: string`. When `phase === 'after_fielding'`, show a read-only line "Results: {resultsUrl}" and include both in the create-submission fetch body. (Reuses the same question list; for after-fielding, default the questions to the latest approved before-fielding submission's questions — fetch them, or allow re-upload.)

- [ ] **Step 3:** `CompliancePanel.tsx` — split display by phase and add the after-fielding action:
  - Group submissions into "Before fielding (questions)" and "After fielding (questions + results)".
  - Add a second button **"Send results to compliance"**, enabled only when: the client requires after-fielding (pass `requiresAfter` as a prop from the project page via `useComplianceState`), `project.n_actual != null` (results are in), a compliance contact exists, and there's no pending/approved after-fielding submission. It opens `SubmitQuestionsModal` with `phase="after_fielding"` and `resultsUrl={project deliverable link}` (the project's `deliverable` field / first linked doc — pass it in as a prop).
  - The existing dispatch/recall/decision flow works unchanged (it operates on a submission id regardless of phase).

- [ ] **Step 4:** `portal/review/[submissionId]/page.tsx` — when the submission's `phase === 'after_fielding'`, render a prominent "Results for review" link (`results_url`) above the questions, with copy explaining the reviewer is approving the questions **and** the results. (Read the file; add a conditional block; reviewers already see the questions.)

- [ ] **Step 5: Build + manual check.** Run `npx next build`. Manually: with an after-fielding client and N Actual set, "Send results to compliance" creates an after_fielding submission; the portal shows the results link; approval satisfies the Delivery gate.

- [ ] **Step 6: Commit**

```bash
git add survey-ops-tracker/app/api/submissions/route.ts survey-ops-tracker/components/compliance/SubmitQuestionsModal.tsx survey-ops-tracker/components/compliance/CompliancePanel.tsx "survey-ops-tracker/app/(portal)/portal/review/[submissionId]/page.tsx"
git commit -m "feat(compliance): after-fielding results review (phase + results_url)"
```

---

## Task 8: Project-page banner + recipient seeding

**Files:**
- Create: `components/project/ComplianceBanner.tsx`
- Modify: `app/(app)/projects/[id]/page.tsx`, `components/compliance/RecipientsManager.tsx`

- [ ] **Step 1: `ComplianceBanner.tsx`** — given `useComplianceState`, show an amber banner when a required review is outstanding: "Before-fielding compliance review outstanding for {firm}" / "After-fielding results review outstanding" with the contact + notes, and a link/anchor to the Compliance Review panel. Render nothing when nothing is outstanding or nothing is required.

- [ ] **Step 2:** Render `<ComplianceBanner project={project} />` near the top of the project page Overview (below the setup banner). For internal projects (`project_type === 'Internal'`) render nothing (they have no client) — the `InternalProjectView` path already returns early, so no change needed there.

- [ ] **Step 3:** `RecipientsManager.tsx` — when there are no `compliance` recipients yet and the client has a `compliance_contact`, show a one-click "Add {contact} as compliance contact" button that seeds the recipient(s) (split the contact on commas). Pass the client's contact down (fetch via `useComplianceState` or `useClient`).

- [ ] **Step 4: Build.** Run `npx next build`; expected pass.

- [ ] **Step 5: Commit**

```bash
git add survey-ops-tracker/components/project/ComplianceBanner.tsx "survey-ops-tracker/app/(app)/projects/[id]/page.tsx" survey-ops-tracker/components/compliance/RecipientsManager.tsx
git commit -m "feat(compliance): project banner + seed recipients from client contact"
```

---

## Task 9: Admin Accounts badge/filter + client-page editor

**Files:**
- Modify: `app/(app)/admin/page.tsx`, `app/(app)/clients/[id]/page.tsx`

- [ ] **Step 1: Accounts (admin).** Using `useClients` (now carries the flags):
  - **Replace the `Cl#####` code in each Accounts row with a compliance indicator** (per David): show a compliance chip when `compliance_before_fielding || compliance_after_fielding` — label "Compliance: before+after" / "before" / "after" — and nothing (or a muted "—") when not required. The client code no longer appears in the list (it moves to the client page, Step 2).
  - Add a filter chip alongside Client / Former / Prospect that filters to compliance clients. (Follow the existing bucket-chip + badge patterns in the file.)

- [ ] **Step 2: Client page.** On `clients/[id]`:
  - **Show the client's `Cl#####` code here** (relocated off the Accounts list) so it's still visible when you click into a client.
  - Add a "Compliance" card with editable controls bound to `useUpdateClient`: two checkboxes (`compliance_before_fielding`, `compliance_after_fielding`) and text inputs for `compliance_contact` (+ optional `compliance_notes`). Mirror the toggle/edit affordances used elsewhere (the dashed off-state FlagChip styling is a good reference).

- [ ] **Step 3: Build.** Run `npx next build`; expected pass.

- [ ] **Step 4: Commit**

```bash
git add "survey-ops-tracker/app/(app)/admin/page.tsx" "survey-ops-tracker/app/(app)/clients/[id]/page.tsx"
git commit -m "feat(compliance): Accounts badge/filter + client-page compliance editor"
```

---

## Task 10: Seed + sheet-diff scripts

**Files:**
- Create: `scripts/seed-compliance.mjs`, `scripts/compliance-diff.mjs`

- [ ] **Step 1: `seed-compliance.mjs`** — read the workbook's "Compliance" tab (buffer read like `inspect-workbook.mjs`), and for each row (header row is the SECOND row: `Client, Before Fielding, After Fielding, Not At All, Compliance Contact to Email, Comments`), match the client by firm name and PATCH `compliance_before_fielding`, `compliance_after_fielding`, `compliance_contact`, `compliance_notes`. Use the REST + `.env.local` pattern from `add-team-member.mjs`. Log matched/unmatched clients. Idempotent.

```js
// usage: node scripts/seed-compliance.mjs "<path to .xlsx>"
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
// ... env + api() helper copied from add-team-member.mjs ...
const wb = XLSX.read(readFileSync(process.argv[2]), { type: 'buffer' })
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Compliance'], { header: 1, blankrows: false, defval: '' })
// header is the row containing 'Client' in col 0
const hi = rows.findIndex(r => String(r[0]).trim() === 'Client')
const clients = await api('GET', '/clients?select=id,name')
for (const r of rows.slice(hi + 1)) {
  const firm = String(r[0]).trim()
  if (!firm) continue
  const match = clients.find(c => c.name.toLowerCase() === firm.toLowerCase())
  if (!match) { console.log('UNMATCHED client:', firm); continue }
  await api('PATCH', `/clients?id=eq.${match.id}`, {
    compliance_before_fielding: r[1] === true || String(r[1]).toUpperCase() === 'TRUE',
    compliance_after_fielding:  r[2] === true || String(r[2]).toUpperCase() === 'TRUE',
    compliance_contact: String(r[4] || '').trim() || null,
    compliance_notes:   String(r[5] || '').trim() || null,
  })
  console.log('Seeded:', firm)
}
```

- [ ] **Step 2: `compliance-diff.mjs`** — same read, but instead of writing, compare the tab to the app's current flags and print a diff (client, field, sheet value, app value) for any mismatch, so David can resolve conflicts. No writes.

- [ ] **Step 3:** Run the seed against David's export (sandbox disabled for file access) once migration 037 is applied: `node scripts/seed-compliance.mjs "C:/Users/david/Downloads/Survey Ops (1).xlsx"`. Report matched/unmatched.

- [ ] **Step 4: Commit**

```bash
git add survey-ops-tracker/scripts/seed-compliance.mjs survey-ops-tracker/scripts/compliance-diff.mjs
git commit -m "feat(compliance): seed + sheet-diff scripts for client compliance flags"
```

---

## Task 11: Docs + full verification

- [ ] **Step 1:** Update `USER_GUIDE.md`: how compliance flags work (per-client, before/after fielding), the two gates + override, where to set the flag (client page / Accounts), and the after-fielding "Send results to compliance" step.
- [ ] **Step 2:** Run the full suite: `npx vitest run` (expect all pass incl. the new compliance tests) and `npx next build` (expect pass).
- [ ] **Step 3: Commit**

```bash
git add survey-ops-tracker/USER_GUIDE.md
git commit -m "docs(compliance): user guide for compliance guardrails"
```

---

## Self-review (completed)

- **Spec coverage:** client flags (T1,T2,T9) ✓; app-edit + sheet-diff (T9,T10) ✓; Accounts badge/filter (T9) ✓; before-fielding gate at Fielding (T3,T5,T6) ✓; after-fielding gate at Delivery (T3,T5,T7) ✓; block-with-logged-override (T5) ✓; reuse portal + phase + results_url (T1,T7) ✓; recipient seeding (T8) ✓; banner (T8) ✓; per-project override (T1,T3,T5) ✓; internal separation (T8 note — internal projects have no client and use InternalProjectView) ✓.
- **Open dependency:** migration 037 must be run by David before Tasks 4-10 work against live data; the code degrades gracefully (no client row → not required).
- **Type consistency:** `ClientCompliance`/`SubmissionLite`/`complianceGate` names used identically across T3-T6. `phase` values `before_fielding`/`after_fielding` consistent across migration, types, logic, UI.
