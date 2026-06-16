# Deliverables Depository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a central depository for final client deliverables into survey-ops-tracker — capture by forwarded email or in-app upload, auto-route to the right Shared Drive `Client / Project` folder (or stage uncertain ones), dedup, and log every filing.

**Architecture:** All logic lives in the Next.js app (the "brain"); the existing Shared Drive stores files; Supabase stores the index/audit. A pure-function **matcher** resolves client/project from email context against canonical Tracker data. A **DriveClient interface** (real `googleapis` impl + in-memory fake) makes filing logic unit-testable. One shared **ingest core** is exposed via two thin routes: a session-auth upload route and a `WEBHOOK_SECRET` email route.

**Tech Stack:** Next.js 15 (App Router) · TypeScript · Supabase (Postgres + RLS via `my_role()`) · `googleapis` (Drive, **new dep**) · `@anthropic-ai/sdk` (Phase 3) · Resend (`sendAndLog`) · Vitest.

**Scope note:** This document fully details **Phase 1 (Core)** — independently shippable working software (in-app upload → Drive filing + matcher + dedup + audit log + folder backfill). **Phase 2 (email transport + review queue UI + "Filed ✓" reply)** and **Phase 3 (weekly QA report + AI matcher tier)** are outlined at the end and will each get their own full plan once Phase 1 lands and is reviewed.

**Spec:** `docs/superpowers/specs/2026-06-15-deliverables-depository-design.md`

---

## File Structure (Phase 1)

**New files:**
- `supabase/migrations/033_deliverables.sql` — enums, `deliverables` table, RLS, `clients.drive_folder_id`, `survey_projects.drive_folder_id`, indexes.
- `lib/deliverables/naming.ts` — folder/file name builders, ISO→dot date, sanitize, forwarded-send-date parser.
- `lib/deliverables/links.ts` — deliverable-link detection + URL normalization.
- `lib/deliverables/dedup.ts` — SHA-256 helper.
- `lib/deliverables/matcher.ts` — layered tiers 1–4 + confidence (pure function).
- `lib/deliverables/ingest.ts` — shared ingest core (`processDeliverableItem`).
- `lib/deliverables/types.ts` — shared TS types for the domain.
- `lib/drive/types.ts` — `DriveClient` interface.
- `lib/drive/google.ts` — real Drive impl (service account, Shared Drive aware).
- `lib/drive/fake.ts` — in-memory `DriveClient` for tests.
- `lib/hooks/useDeliverables.ts` — TanStack Query hooks (list + upload).
- `components/deliverables/DeliverablesPanel.tsx` — project-page panel (Attach + list).
- `app/api/deliverables/upload/route.ts` — session-auth multipart upload route.
- `app/api/deliverables/ingest/route.ts` — `WEBHOOK_SECRET` email-ingest route (logic built + tested now; the live Apps Script transport is Phase 2).
- `scripts/map-drive-folders.mjs` — one-time client→folder backfill (CSV review).
- Test files colocated (`*.test.ts`) and `__tests__/` for components.

**Modified files:**
- `lib/supabase/types.ts` — add `deliverables` table types + enums + the two new columns (hand-maintained).
- `app/(app)/projects/[id]/page.tsx` — mount `<DeliverablesPanel projectId=... />`.
- `components/shared/AppMenu.tsx` — add a **Deliverables** nav link (full index page is Phase 2; Phase 1 links to a simple placeholder list).
- `package.json` — add `googleapis`.
- `.env.local.example` — document new env vars.
- `USER_GUIDE.md` — add a "Deliverables" section.

---

## Task 1: Add the `googleapis` dependency

**Files:**
- Modify: `survey-ops-tracker/package.json`

- [ ] **Step 1: Install**

Run (in `survey-ops-tracker/`): `npm install googleapis@144`
Expected: `googleapis` appears in `dependencies`, `package-lock.json` updated.

- [ ] **Step 2: Verify it imports**

Run: `node -e "require('googleapis'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add googleapis for Drive integration"
```

---

## Task 2: Migration 033 — schema + RLS

Migrations are applied **manually** in the Supabase SQL editor (see `SUPABASE_SETUP.md`); there is no CLI. So this task writes the SQL and the hand-maintained types; the human applies it. Numbering continues from 032.

**Files:**
- Create: `supabase/migrations/033_deliverables.sql`
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 033: Deliverables depository.
-- Drive holds files; this table is the searchable index + audit. Analyst-only
-- RLS (mirrors 030) — external compliance reviewers must never read it.

create type public.deliverable_source as enum ('email','upload');
create type public.deliverable_kind   as enum ('file','link');
create type public.deliverable_status as enum ('filed','review','duplicate','unsorted');

-- client → Shared Drive top-level folder (resolved by ID, never by display name)
alter table public.clients
  add column if not exists drive_folder_id text;

-- cached project subfolder id, so we never re-create or re-search
alter table public.survey_projects
  add column if not exists drive_folder_id text;

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id),
  project_id uuid references public.survey_projects(id),
  kind public.deliverable_kind not null,
  drive_file_id text,                 -- the file, or the shortcut/bookmark for a link
  drive_folder_id text,
  file_name text,                     -- final name as stored in Drive
  original_file_name text,
  file_hash text,                     -- SHA-256 of bytes (null for links)
  source_url text,                    -- original link for kind='link'
  mime_type text,
  size_bytes bigint,
  source public.deliverable_source not null,
  status public.deliverable_status not null,
  match_confidence numeric,
  match_method text,                  -- 'code'|'contact_email'|'domain'|'name'|'ai'|'upload_context'
  match_candidates jsonb not null default '[]',
  duplicate_of uuid references public.deliverables(id),
  gmail_message_id text,
  email_subject text,
  email_from text,
  email_date timestamptz,
  forwarded_by text,
  filed_by uuid references public.profiles(id),
  filed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

-- idempotency + dedup
create unique index deliverables_gmail_msg_idx
  on public.deliverables (gmail_message_id) where gmail_message_id is not null;
create unique index deliverables_file_dedup_idx
  on public.deliverables (file_hash, drive_folder_id)
  where file_hash is not null and drive_folder_id is not null and status <> 'duplicate';
create unique index deliverables_link_dedup_idx
  on public.deliverables (source_url, drive_folder_id)
  where source_url is not null and drive_folder_id is not null and status <> 'duplicate';
create index deliverables_status_idx  on public.deliverables (status) where deleted_at is null;
create index deliverables_project_idx on public.deliverables (project_id) where deleted_at is null;
create index deliverables_client_idx  on public.deliverables (client_id) where deleted_at is null;
create index deliverables_filed_idx   on public.deliverables (filed_at desc) where deleted_at is null;

-- RLS: analyst-only (mirror migration 030). Inserts happen via service-role
-- (ingest core) which bypasses RLS; analysts may also read/write in-app.
alter table public.deliverables enable row level security;
create policy "analysts full access deliverables" on public.deliverables
  for all to authenticated
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
```

- [ ] **Step 2: Apply it**

In the Supabase dashboard → SQL Editor, run `033_deliverables.sql`. Confirm the table exists:
Run in SQL editor: `select count(*) from public.deliverables;`
Expected: `0` (no error).

- [ ] **Step 3: Update hand-maintained types**

In `lib/supabase/types.ts`, add to `Enums`:

```typescript
deliverable_source: 'email' | 'upload'
deliverable_kind: 'file' | 'link'
deliverable_status: 'filed' | 'review' | 'duplicate' | 'unsorted'
```

Add a `deliverables` entry under `Tables` with `Row`/`Insert`/`Update` matching the columns above (follow the shape of the existing `question_submissions` table block). Add `drive_folder_id: string | null` to the `clients` and `survey_projects` `Row`/`Insert`/`Update` blocks.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/033_deliverables.sql lib/supabase/types.ts
git commit -m "feat(deliverables): migration 033 — deliverables table, RLS, drive_folder_id columns"
```

---

## Task 3: Naming helpers (TDD)

**Files:**
- Create: `lib/deliverables/naming.ts`
- Test: `lib/deliverables/naming.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { sanitizeName, isoToDot, projectFolderName, deliverableFileName, originalSendDate } from './naming'

describe('deliverables/naming', () => {
  it('isoToDot turns an ISO date into YYYY.MM.DD', () => {
    expect(isoToDot('2026-06-10')).toBe('2026.06.10')
    expect(isoToDot('2026-06-10T14:03:00Z')).toBe('2026.06.10')
  })

  it('sanitizeName strips path-hostile characters', () => {
    expect(sanitizeName('Top/line: "final"?')).toBe('Top-line- -final--')
    expect(sanitizeName('  a   b  ')).toBe('a b')
  })

  it('projectFolderName = name_code_date', () => {
    expect(projectFolderName('Q2 Consumer Tracker', 'PR00112', '2026-06-10'))
      .toBe('Q2 Consumer Tracker_PR00112_2026.06.10')
  })

  it('deliverableFileName prefixes the dotted date', () => {
    expect(deliverableFileName('2026-06-10', 'Topline.pdf')).toBe('2026.06.10 — Topline.pdf')
  })

  it('originalSendDate prefers the forwarded header block, falls back to the message date', () => {
    const fwd = 'See attached.\n\n---------- Forwarded message ---------\nFrom: a@b.com\nDate: Mon, Jun 1, 2026 at 9:14 AM\nSubject: x\n'
    expect(originalSendDate(fwd, '2026-06-15T00:00:00Z').slice(0, 10)).toBe('2026-06-01')
    expect(originalSendDate('no block here', '2026-06-15T00:00:00Z')).toBe('2026-06-15T00:00:00Z')
  })
})
```

- [ ] **Step 2: Run it, verify failure**

Run: `npx vitest run lib/deliverables/naming.test.ts`
Expected: FAIL ("Cannot find module './naming'").

- [ ] **Step 3: Implement**

```typescript
// lib/deliverables/naming.ts
export function sanitizeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

export function isoToDot(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '.')
}

export function projectFolderName(projectName: string, projectCode: string, deliveredISO: string): string {
  return `${sanitizeName(projectName)}_${projectCode}_${isoToDot(deliveredISO)}`
}

export function deliverableFileName(dateISO: string, originalName: string): string {
  return `${isoToDot(dateISO)} — ${sanitizeName(originalName)}`
}

// Prefer the original "Date:" inside a "Forwarded message" block; else the fallback (the message's own Date).
export function originalSendDate(body: string, fallbackISO: string): string {
  const m = body.match(/Forwarded message[\s\S]{0,400}?\n\s*Date:\s*(.+)/i)
  if (m) {
    const d = new Date(m[1].trim())
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return fallbackISO
}
```

- [ ] **Step 4: Run it, verify pass**

Run: `npx vitest run lib/deliverables/naming.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/deliverables/naming.ts lib/deliverables/naming.test.ts
git commit -m "feat(deliverables): folder/file naming + forwarded-date helpers"
```

---

## Task 4: Link detection + URL normalization (TDD)

**Files:**
- Create: `lib/deliverables/links.ts`
- Test: `lib/deliverables/links.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeUrl, isGoogleNative, extractDeliverableLinks } from './links'

describe('deliverables/links', () => {
  it('normalizeUrl drops hash + utm params + trailing slash', () => {
    expect(normalizeUrl('https://a.com/x/?utm_source=z&id=5#frag')).toBe('https://a.com/x/?id=5'.replace(/\/$/, ''))
  })

  it('detects deliverable links by known host, ignoring noise', () => {
    const body = `Report: https://app.occamdata.com/study/42
      Survey: https://edwin.alpharoc.ai/survey?source=PII_X
      Sheet: https://docs.google.com/spreadsheets/d/abc/edit
      Unsub: https://mailchimp.com/unsubscribe?u=1`
    expect(extractDeliverableLinks(body)).toEqual([
      'https://app.occamdata.com/study/42',
      'https://edwin.alpharoc.ai/survey?source=PII_X',
      'https://docs.google.com/spreadsheets/d/abc/edit',
    ])
  })

  it('flags Google-native links (for shortcut vs bookmark)', () => {
    expect(isGoogleNative('https://docs.google.com/spreadsheets/d/abc/edit')).toBe(true)
    expect(isGoogleNative('https://app.occamdata.com/study/42')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, verify failure**

Run: `npx vitest run lib/deliverables/links.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// lib/deliverables/links.ts
const DELIVERABLE_HOST_RE = [/(^|\.)occam/i, /edwin\.alpharoc\.ai$/i, /(^|\.)drive\.google\.com$/i, /(^|\.)docs\.google\.com$/i]

function host(u: string): string | null {
  try { return new URL(u).host.toLowerCase() } catch { return null }
}

export function isGoogleNative(u: string): boolean {
  const h = host(u) ?? ''
  return /(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(h)
}

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u.trim())
    url.hash = ''
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) url.searchParams.delete(p)
    return url.toString().replace(/\/$/, '')
  } catch {
    return u.trim()
  }
}

export function extractDeliverableLinks(body: string): string[] {
  const urls = body.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const h = host(raw)
    if (!h || !DELIVERABLE_HOST_RE.some((re) => re.test(h))) continue
    const key = normalizeUrl(raw)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}
```

- [ ] **Step 4: Run it, verify pass**

Run: `npx vitest run lib/deliverables/links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/deliverables/links.ts lib/deliverables/links.test.ts
git commit -m "feat(deliverables): deliverable-link detection + URL normalization"
```

---

## Task 5: SHA-256 dedup helper (TDD)

**Files:**
- Create: `lib/deliverables/dedup.ts`
- Test: `lib/deliverables/dedup.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { sha256 } from './dedup'

describe('deliverables/dedup', () => {
  it('hashes bytes deterministically', () => {
    const a = sha256(Buffer.from('hello'))
    expect(a).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(sha256(Buffer.from('hello'))).toBe(a)
    expect(sha256(Buffer.from('world'))).not.toBe(a)
  })
})
```

- [ ] **Step 2: Run it, verify failure**

Run: `npx vitest run lib/deliverables/dedup.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// lib/deliverables/dedup.ts
import { createHash } from 'crypto'

export function sha256(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
```

- [ ] **Step 4: Run it, verify pass**

Run: `npx vitest run lib/deliverables/dedup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/deliverables/dedup.ts lib/deliverables/dedup.test.ts
git commit -m "feat(deliverables): sha256 content-hash helper"
```

---

## Task 6: Domain types

**Files:**
- Create: `lib/deliverables/types.ts`

- [ ] **Step 1: Write the types** (no test — type-only module)

```typescript
// lib/deliverables/types.ts
export type ClientRec = { id: string; name: string; code: string | null }
export type ProjectRec = { id: string; client_id: string | null; project_code: string; project_name: string }
export type ContactRec = { email: string; client_id: string | null; project_id: string | null }

export type Candidate = { clientId: string | null; projectId: string | null; confidence: number; reason: string }

export type MatchInput = {
  subject: string
  body: string
  fromEmail: string
  clients: ClientRec[]
  projects: ProjectRec[]            // non-deleted only
  contacts: ContactRec[]            // project_recipients + known client contacts
  domainMap: Record<string, string> // emailDomain -> clientId
}

export type MatchMethod = 'code' | 'contact_email' | 'domain' | 'name' | 'none'
export type MatchResult = {
  clientId: string | null
  projectId: string | null
  confidence: number
  method: MatchMethod
  candidates: Candidate[]
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/deliverables/types.ts
git commit -m "feat(deliverables): shared domain types"
```

---

## Task 7: The matcher, tiers 1–4 (TDD)

**Files:**
- Create: `lib/deliverables/matcher.ts`
- Test: `lib/deliverables/matcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { matchDeliverable, normalizeName } from './matcher'
import type { MatchInput } from './types'

const base: Omit<MatchInput, 'subject' | 'body' | 'fromEmail'> = {
  clients: [
    { id: 'c-bam', name: 'Balyasny', code: 'Cl00012' },
    { id: 'c-a4a', name: 'Airlines 4 America (A4A)', code: 'Cl00003' },
  ],
  projects: [
    { id: 'p-1', client_id: 'c-bam', project_code: 'PR00112', project_name: 'Q2 Consumer Tracker' },
    { id: 'p-2', client_id: 'c-a4a', project_code: 'PR00040', project_name: 'TSA Poll' },
  ],
  contacts: [{ email: 'rspicer@airlines.org', client_id: 'c-a4a', project_id: 'p-2' }],
  domainMap: { 'airlines.org': 'c-a4a' },
}

describe('matchDeliverable', () => {
  it('tier 1: PR code in subject wins with ~certain confidence', () => {
    const r = matchDeliverable({ ...base, subject: 'Final deck PR00112', body: '', fromEmail: 'x@gmail.com' })
    expect(r.projectId).toBe('p-1')
    expect(r.clientId).toBe('c-bam')
    expect(r.method).toBe('code')
    expect(r.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it('tier 2: known contact email resolves client + its project', () => {
    const r = matchDeliverable({ ...base, subject: 'results', body: '', fromEmail: 'rspicer@airlines.org' })
    expect(r.clientId).toBe('c-a4a')
    expect(r.projectId).toBe('p-2')
    expect(r.method).toBe('contact_email')
  })

  it('tier 3: domain maps to client; shared domains are ignored', () => {
    const r = matchDeliverable({ ...base, subject: 'hi', body: '', fromEmail: 'new.person@airlines.org' })
    expect(r.clientId).toBe('c-a4a')
    expect(r.method).toBe('domain')

    const r2 = matchDeliverable({ ...base, subject: 'hi', body: '', fromEmail: 'someone@gmail.com' })
    expect(r2.method).toBe('none')
  })

  it('tier 4: project name in body resolves the project', () => {
    const r = matchDeliverable({ ...base, subject: 'deliverable', body: 'Attached is the Q2 Consumer Tracker topline', fromEmail: 'x@gmail.com' })
    expect(r.projectId).toBe('p-1')
    expect(r.method).toBe('name')
  })

  it('resolves the single project when only the client is known', () => {
    const onlyBam = { ...base, projects: [base.projects[0]] }
    const r = matchDeliverable({ ...onlyBam, subject: 'x', body: '', fromEmail: 'cfo@balyasny.com', domainMap: { 'balyasny.com': 'c-bam' } })
    expect(r.clientId).toBe('c-bam')
    expect(r.projectId).toBe('p-1') // only one project for the client
  })

  it('returns none when nothing matches', () => {
    const r = matchDeliverable({ ...base, subject: 'lunch?', body: 'see you at noon', fromEmail: 'friend@gmail.com' })
    expect(r.method).toBe('none')
    expect(r.clientId).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, verify failure**

Run: `npx vitest run lib/deliverables/matcher.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// lib/deliverables/matcher.ts
import type { Candidate, MatchInput, MatchMethod, MatchResult } from './types'

const CODE_RE = /\b(PR\d{5}|Cl\d{5})\b/i
const SHARED_DOMAINS = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com'])

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function domainOf(email: string): string {
  return (email.split('@')[1] ?? '').toLowerCase().trim()
}

export function matchDeliverable(input: MatchInput): MatchResult {
  const hay = `${input.subject}\n${input.body}`
  const nhay = ` ${normalizeName(hay)} `
  const candidates: Candidate[] = []

  // Tier 1 — explicit code
  const code = hay.match(CODE_RE)?.[1]?.toUpperCase()
  if (code?.startsWith('PR')) {
    const p = input.projects.find((p) => p.project_code.toUpperCase() === code)
    if (p) candidates.push({ clientId: p.client_id, projectId: p.id, confidence: 0.99, reason: `code:${code}` })
  } else if (code?.startsWith('CL')) {
    const c = input.clients.find((c) => (c.code ?? '').toUpperCase() === code)
    if (c) candidates.push({ clientId: c.id, projectId: null, confidence: 0.95, reason: `code:${code}` })
  }

  // Tier 2 — known contact email
  const from = input.fromEmail.toLowerCase().trim()
  const contact = input.contacts.find((c) => c.email.toLowerCase().trim() === from)
  if (contact?.clientId) candidates.push({ clientId: contact.clientId, projectId: contact.projectId, confidence: 0.9, reason: 'contact' })

  // Tier 3 — sender domain (skip shared)
  const dom = domainOf(from)
  if (dom && !SHARED_DOMAINS.has(dom) && input.domainMap[dom]) {
    candidates.push({ clientId: input.domainMap[dom], projectId: null, confidence: 0.8, reason: `domain:${dom}` })
  }

  // Tier 4 — name / project-name text
  for (const p of input.projects) {
    const pn = normalizeName(p.project_name)
    if (pn.length >= 4 && nhay.includes(` ${pn} `)) {
      candidates.push({ clientId: p.client_id, projectId: p.id, confidence: 0.75, reason: `pname:${p.project_code}` })
    }
  }
  for (const c of input.clients) {
    const cn = normalizeName(c.name)
    if (cn.length >= 3 && nhay.includes(` ${cn} `)) {
      candidates.push({ clientId: c.id, projectId: null, confidence: 0.6, reason: 'cname' })
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence)
  const best = candidates[0]
  if (!best) return { clientId: null, projectId: null, confidence: 0, method: 'none', candidates: [] }

  // Resolve a project within the chosen client if we don't have one yet.
  let projectId = best.projectId
  if (best.clientId && !projectId) {
    const withProj = candidates.find((c) => c.clientId === best.clientId && c.projectId)
    if (withProj) projectId = withProj.projectId
    else {
      const clientProjects = input.projects.filter((p) => p.client_id === best.clientId)
      if (clientProjects.length === 1) projectId = clientProjects[0].id
    }
  }

  const method: MatchMethod = best.reason.startsWith('code') ? 'code'
    : best.reason === 'contact' ? 'contact_email'
    : best.reason.startsWith('domain') ? 'domain'
    : 'name'

  return { clientId: best.clientId, projectId, confidence: best.confidence, method, candidates: candidates.slice(0, 3) }
}
```

- [ ] **Step 4: Run it, verify pass**

Run: `npx vitest run lib/deliverables/matcher.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/deliverables/matcher.ts lib/deliverables/matcher.test.ts
git commit -m "feat(deliverables): layered matcher (code/contact/domain/name)"
```

---

## Task 8: DriveClient interface + in-memory fake (TDD)

The interface lets the ingest core be unit-tested without real Drive. The fake models folders/files in memory.

**Files:**
- Create: `lib/drive/types.ts`
- Create: `lib/drive/fake.ts`
- Test: `lib/drive/fake.test.ts`

- [ ] **Step 1: Write the interface** (type-only)

```typescript
// lib/drive/types.ts
export type DriveChild = { id: string; name: string; mimeType: string }

export interface DriveClient {
  /** Find a direct child folder by exact name; null if absent. */
  findChildFolder(parentId: string, name: string): Promise<string | null>
  createFolder(parentId: string, name: string): Promise<string>
  /** Find a direct child of any type by exact name. */
  findChild(parentId: string, name: string): Promise<DriveChild | null>
  uploadFile(parentId: string, name: string, mimeType: string, bytes: Buffer): Promise<string>
  createShortcut(parentId: string, name: string, targetFileId: string): Promise<string>
  /** A small bookmark file for an external URL. */
  createBookmark(parentId: string, name: string, url: string): Promise<string>
  moveFile(fileId: string, newParentId: string): Promise<void>
}
```

- [ ] **Step 2: Write the failing test for the fake**

```typescript
import { describe, it, expect } from 'vitest'
import { FakeDrive } from './fake'

describe('FakeDrive', () => {
  it('creates and finds folders idempotently by name', async () => {
    const d = new FakeDrive('root')
    const a = await d.createFolder('root', 'Balyasny (BAM)')
    expect(await d.findChildFolder('root', 'Balyasny (BAM)')).toBe(a)
    expect(await d.findChildFolder('root', 'Nope')).toBeNull()
  })

  it('uploads, finds, and moves files', async () => {
    const d = new FakeDrive('root')
    const f1 = await d.createFolder('root', 'F1')
    const f2 = await d.createFolder('root', 'F2')
    const file = await d.uploadFile(f1, 'a.pdf', 'application/pdf', Buffer.from('x'))
    expect((await d.findChild(f1, 'a.pdf'))?.id).toBe(file)
    await d.moveFile(file, f2)
    expect(await d.findChild(f1, 'a.pdf')).toBeNull()
    expect((await d.findChild(f2, 'a.pdf'))?.id).toBe(file)
  })

  it('creates shortcuts and bookmarks', async () => {
    const d = new FakeDrive('root')
    const sc = await d.createShortcut('root', 'sheet', 'target-123')
    const bm = await d.createBookmark('root', 'study.url', 'https://occam/x')
    expect((await d.findChild('root', 'sheet'))?.id).toBe(sc)
    expect((await d.findChild('root', 'study.url'))?.id).toBe(bm)
  })
})
```

- [ ] **Step 3: Run it, verify failure**

Run: `npx vitest run lib/drive/fake.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the fake**

```typescript
// lib/drive/fake.ts
import type { DriveChild, DriveClient } from './types'

type Node = { id: string; name: string; mimeType: string; parentId: string }
const FOLDER = 'application/vnd.google-apps.folder'

export class FakeDrive implements DriveClient {
  private nodes = new Map<string, Node>()
  private seq = 0
  constructor(public rootId = 'root') {}

  private id(): string { return `id-${++this.seq}` }
  private childrenOf(parentId: string): Node[] { return [...this.nodes.values()].filter((n) => n.parentId === parentId) }

  async findChildFolder(parentId: string, name: string): Promise<string | null> {
    const hit = this.childrenOf(parentId).find((n) => n.mimeType === FOLDER && n.name === name)
    return hit?.id ?? null
  }
  async createFolder(parentId: string, name: string): Promise<string> {
    const id = this.id()
    this.nodes.set(id, { id, name, mimeType: FOLDER, parentId })
    return id
  }
  async findChild(parentId: string, name: string): Promise<DriveChild | null> {
    const hit = this.childrenOf(parentId).find((n) => n.name === name)
    return hit ? { id: hit.id, name: hit.name, mimeType: hit.mimeType } : null
  }
  async uploadFile(parentId: string, name: string, mimeType: string, _bytes: Buffer): Promise<string> {
    const id = this.id()
    this.nodes.set(id, { id, name, mimeType, parentId })
    return id
  }
  async createShortcut(parentId: string, name: string, _targetFileId: string): Promise<string> {
    const id = this.id()
    this.nodes.set(id, { id, name, mimeType: 'application/vnd.google-apps.shortcut', parentId })
    return id
  }
  async createBookmark(parentId: string, name: string, _url: string): Promise<string> {
    const id = this.id()
    this.nodes.set(id, { id, name, mimeType: 'text/uri-list', parentId })
    return id
  }
  async moveFile(fileId: string, newParentId: string): Promise<void> {
    const n = this.nodes.get(fileId)
    if (n) n.parentId = newParentId
  }
}
```

- [ ] **Step 5: Run it, verify pass**

Run: `npx vitest run lib/drive/fake.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/drive/types.ts lib/drive/fake.ts lib/drive/fake.test.ts
git commit -m "feat(deliverables): DriveClient interface + in-memory fake"
```

---

## Task 9: Real Google Drive client

Verified manually (needs real creds), so no unit test; we typecheck it and exercise it in the Task 14 smoke test.

**Files:**
- Create: `lib/drive/google.ts`

- [ ] **Step 1: Implement**

```typescript
// lib/drive/google.ts
import 'server-only'
import { google } from 'googleapis'
import { Readable } from 'stream'
import type { DriveChild, DriveClient } from './types'

const FOLDER = 'application/vnd.google-apps.folder'

function driveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY')
  const creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  return google.drive({ version: 'v3', auth })
}

const COMMON = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const

export class GoogleDrive implements DriveClient {
  private drive = driveClient()

  async findChildFolder(parentId: string, name: string): Promise<string | null> {
    const child = await this.findChild(parentId, name)
    return child && child.mimeType === FOLDER ? child.id : null
  }

  async createFolder(parentId: string, name: string): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: { name, mimeType: FOLDER, parents: [parentId] },
      fields: 'id',
      supportsAllDrives: true,
    })
    return res.data.id!
  }

  async findChild(parentId: string, name: string): Promise<DriveChild | null> {
    const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`
    const res = await this.drive.files.list({ q, fields: 'files(id,name,mimeType)', pageSize: 1, ...COMMON })
    const f = res.data.files?.[0]
    return f ? { id: f.id!, name: f.name!, mimeType: f.mimeType! } : null
  }

  async uploadFile(parentId: string, name: string, mimeType: string, bytes: Buffer): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: { name, parents: [parentId] },
      media: { mimeType, body: Readable.from(bytes) },
      fields: 'id',
      supportsAllDrives: true,
    })
    return res.data.id!
  }

  async createShortcut(parentId: string, name: string, targetFileId: string): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.shortcut', parents: [parentId], shortcutDetails: { targetId: targetFileId } },
      fields: 'id',
      supportsAllDrives: true,
    })
    return res.data.id!
  }

  async createBookmark(parentId: string, name: string, url: string): Promise<string> {
    // A .url internet-shortcut file pointing at the external link.
    const body = `[InternetShortcut]\r\nURL=${url}\r\n`
    return this.uploadFile(parentId, name.endsWith('.url') ? name : `${name}.url`, 'application/internet-shortcut', Buffer.from(body, 'utf8'))
  }

  async moveFile(fileId: string, newParentId: string): Promise<void> {
    const cur = await this.drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true })
    const prev = (cur.data.parents ?? []).join(',')
    await this.drive.files.update({ fileId, addParents: newParentId, removeParents: prev, fields: 'id', supportsAllDrives: true })
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/drive/google.ts
git commit -m "feat(deliverables): real googleapis Drive client (Shared Drive aware)"
```

---

## Task 10: Ingest core (TDD with the fake)

The core takes already-resolved DB data + a `DriveClient` (dependency injection) so it's fully unit-testable. It ensures folders, files/shortcuts/bookmarks, dedups, and returns a row to insert. **It does not touch Supabase directly** — the caller passes in the resolved data and persists the returned record. This keeps the unit test pure.

**Files:**
- Create: `lib/deliverables/ingest.ts`
- Test: `lib/deliverables/ingest.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { fileDeliverable, type FileInput, type FolderResolver } from './ingest'
import { FakeDrive } from '@/lib/drive/fake'

function resolver(drive: FakeDrive): FolderResolver {
  return {
    sharedDriveId: 'root',
    clientFolderId: async () => drive.createFolderIfMissing('root', 'Balyasny (BAM)'),
    projectFolderName: () => 'Q2 Consumer Tracker_PR00112_2026.06.10',
    needsReviewFolderName: '00_Needs Review',
    unsortedFolderName: '_Unsorted',
  }
}

describe('fileDeliverable', () => {
  it('files a confident attachment into Client/Project and returns a filed record', async () => {
    const drive = new FakeDrive('root')
    const input: FileInput = {
      kind: 'file', confident: true, hasProject: true,
      original_file_name: 'Topline.pdf', mimeType: 'application/pdf',
      bytes: Buffer.from('pdf'), dateISO: '2026-06-10',
    }
    const rec = await fileDeliverable(drive, resolver(drive), input)
    expect(rec.status).toBe('filed')
    expect(rec.kind).toBe('file')
    expect(rec.drive_file_id).toBeTruthy()
    // file lives in the project folder, named with the dotted date
    const clientFolder = await drive.findChildFolder('root', 'Balyasny (BAM)')
    const projFolder = await drive.findChildFolder(clientFolder!, 'Q2 Consumer Tracker_PR00112_2026.06.10')
    expect((await drive.findChild(projFolder!, '2026.06.10 — Topline.pdf'))?.id).toBe(rec.drive_file_id)
  })

  it('stages an unconfident item in 00_Needs Review', async () => {
    const drive = new FakeDrive('root')
    const input: FileInput = { kind: 'file', confident: false, hasProject: false, original_file_name: 'x.pdf', mimeType: 'application/pdf', bytes: Buffer.from('x'), dateISO: '2026-06-10' }
    const rec = await fileDeliverable(drive, resolver(drive), input)
    expect(rec.status).toBe('review')
    const staging = await drive.findChildFolder('root', '00_Needs Review')
    expect((await drive.findChild(staging!, '2026.06.10 — x.pdf'))?.id).toBe(rec.drive_file_id)
  })

  it('files a Google-native link as a shortcut', async () => {
    const drive = new FakeDrive('root')
    const input: FileInput = { kind: 'link', confident: true, hasProject: true, source_url: 'https://docs.google.com/spreadsheets/d/abc/edit', dateISO: '2026-06-10', original_file_name: 'Q2 Sheet' }
    const rec = await fileDeliverable(drive, resolver(drive), input)
    expect(rec.status).toBe('filed')
    expect(rec.kind).toBe('link')
    expect(rec.drive_file_id).toBeTruthy()
  })
})
```

> Note: this test uses one small fake-only convenience, `createFolderIfMissing` (it wraps existing methods). Add it to `FakeDrive` in this task — see Step 3.

- [ ] **Step 2: Run it, verify failure**

Run: `npx vitest run lib/deliverables/ingest.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (ingest core + the fake convenience)

Add to `lib/drive/fake.ts`:

```typescript
  // convenience for tests
  async createFolderIfMissing(parentId: string, name: string): Promise<string> {
    return (await this.findChildFolder(parentId, name)) ?? (await this.createFolder(parentId, name))
  }
```

Create `lib/deliverables/ingest.ts`:

```typescript
import 'server-only'
import type { DriveClient } from '@/lib/drive/types'
import { deliverableFileName } from './naming'
import { isGoogleNative } from './links'
import type { Enums } from '@/lib/supabase/types'

export type FolderResolver = {
  sharedDriveId: string
  /** ensure + return the client's top-level folder id */
  clientFolderId: () => Promise<string>
  /** name of the project subfolder, e.g. "Q2 Consumer Tracker_PR00112_2026.06.10" */
  projectFolderName: () => string
  needsReviewFolderName: string // "00_Needs Review"
  unsortedFolderName: string    // "_Unsorted"
}

export type FileInput = {
  kind: Enums<'deliverable_kind'>
  confident: boolean
  hasProject: boolean
  original_file_name: string
  dateISO: string
  // file
  mimeType?: string
  bytes?: Buffer
  // link
  source_url?: string
}

export type FiledRecord = {
  status: Enums<'deliverable_status'>
  kind: Enums<'deliverable_kind'>
  drive_file_id: string
  drive_folder_id: string
  file_name: string
}

async function ensureChildFolder(drive: DriveClient, parentId: string, name: string): Promise<string> {
  return (await drive.findChildFolder(parentId, name)) ?? (await drive.createFolder(parentId, name))
}

/** Decide the destination folder, then file the item there. */
export async function fileDeliverable(drive: DriveClient, r: FolderResolver, input: FileInput): Promise<FiledRecord> {
  let folderId: string
  let status: Enums<'deliverable_status'>

  if (!input.confident) {
    folderId = await ensureChildFolder(drive, r.sharedDriveId, r.needsReviewFolderName)
    status = 'review'
  } else {
    const clientId = await r.clientFolderId()
    if (input.hasProject) {
      folderId = await ensureChildFolder(drive, clientId, r.projectFolderName())
      status = 'filed'
    } else {
      folderId = await ensureChildFolder(drive, clientId, r.unsortedFolderName)
      status = 'unsorted'
    }
  }

  const name = deliverableFileName(input.dateISO, input.original_file_name)
  let driveFileId: string
  if (input.kind === 'link') {
    const url = input.source_url!
    driveFileId = isGoogleNative(url)
      ? await drive.createShortcut(folderId, name, googleFileId(url) ?? name)
      : await drive.createBookmark(folderId, name, url)
  } else {
    driveFileId = await drive.uploadFile(folderId, name, input.mimeType ?? 'application/octet-stream', input.bytes!)
  }

  return { status, kind: input.kind, drive_file_id: driveFileId, drive_folder_id: folderId, file_name: name }
}

/** Extract a Google Drive/Docs file id from a share URL, if present. */
export function googleFileId(url: string): string | null {
  return url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? null
}
```

- [ ] **Step 4: Run it, verify pass**

Run: `npx vitest run lib/deliverables/ingest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/deliverables/ingest.ts lib/drive/fake.ts lib/deliverables/ingest.test.ts
git commit -m "feat(deliverables): ingest core — folder resolution + file/shortcut/bookmark"
```

---

## Task 11: Data-loading helper for the matcher

A server-only helper that loads the matcher's `MatchInput` data from Supabase (clients, non-deleted projects, contacts, domain map). Pure DB read, so we test it against a mocked admin client.

**Files:**
- Create: `lib/deliverables/load.ts`
- Test: `lib/deliverables/load.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildDomainMap } from './load'

describe('buildDomainMap', () => {
  it('maps each contact domain to its client, skipping shared providers', () => {
    const map = buildDomainMap([
      { email: 'a@airlines.org', client_id: 'c1', project_id: null },
      { email: 'b@gmail.com', client_id: 'c2', project_id: null },
      { email: 'c@balyasny.com', client_id: 'c3', project_id: null },
    ])
    expect(map).toEqual({ 'airlines.org': 'c1', 'balyasny.com': 'c3' })
  })
})
```

- [ ] **Step 2: Run it, verify failure**

Run: `npx vitest run lib/deliverables/load.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// lib/deliverables/load.ts
import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ClientRec, ContactRec, ProjectRec } from './types'

const SHARED_DOMAINS = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com'])

export function buildDomainMap(contacts: ContactRec[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const c of contacts) {
    if (!c.client_id) continue
    const dom = (c.email.split('@')[1] ?? '').toLowerCase().trim()
    if (!dom || SHARED_DOMAINS.has(dom) || map[dom]) continue
    map[dom] = c.client_id
  }
  return map
}

export async function loadMatchData(admin: ReturnType<typeof createAdminClient>): Promise<{
  clients: ClientRec[]; projects: ProjectRec[]; contacts: ContactRec[]; domainMap: Record<string, string>
}> {
  const [{ data: clients }, { data: projects }, { data: recips }] = await Promise.all([
    admin.from('clients').select('id, name, code'),
    admin.from('survey_projects').select('id, client_id, project_code, project_name').is('deleted_at', null).not('project_code', 'is', null),
    admin.from('project_recipients').select('email, project_id'),
  ])

  // attach client_id to each recipient via its project
  const projById = new Map((projects ?? []).map((p) => [p.id, p.client_id]))
  const contacts: ContactRec[] = (recips ?? []).map((r) => ({
    email: r.email,
    project_id: r.project_id,
    client_id: projById.get(r.project_id) ?? null,
  }))

  return {
    clients: (clients ?? []) as ClientRec[],
    projects: (projects ?? []) as ProjectRec[],
    contacts,
    domainMap: buildDomainMap(contacts),
  }
}
```

- [ ] **Step 4: Run it, verify pass**

Run: `npx vitest run lib/deliverables/load.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/deliverables/load.ts lib/deliverables/load.test.ts
git commit -m "feat(deliverables): load matcher data + domain map from Supabase"
```

---

## Task 12: Upload route (session-auth) + persistence

Wires the pieces for the **in-app upload path**: auth as analyst, resolve client/project from the page context (project known → confidence 1), dedup against the DB, file via `GoogleDrive`, persist the row, write an activity-log entry.

**Files:**
- Create: `app/api/deliverables/upload/route.ts`
- Test: `app/api/deliverables/upload/route.test.ts` (logic test of the persistence/dedup helper)

- [ ] **Step 1: Write a dedup helper + failing test**

Create `lib/deliverables/persist.ts`:

```typescript
import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'

/** Returns the existing deliverable id if this (hash|url, folder) already filed, else null. */
export async function findDuplicate(
  admin: ReturnType<typeof createAdminClient>,
  folderId: string,
  opts: { fileHash?: string | null; sourceUrl?: string | null }
): Promise<string | null> {
  let q = admin.from('deliverables').select('id').eq('drive_folder_id', folderId).neq('status', 'duplicate').is('deleted_at', null).limit(1)
  q = opts.fileHash ? q.eq('file_hash', opts.fileHash) : q.eq('source_url', opts.sourceUrl ?? '')
  const { data } = await q
  return data?.[0]?.id ?? null
}
```

Test `lib/deliverables/persist.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { findDuplicate } from './persist'

function adminReturning(rows: { id: string }[]) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'neq', 'is', 'limit']) chain[m] = vi.fn(() => chain)
  chain.then = (res: (v: { data: { id: string }[] }) => void) => res({ data: rows })
  return { from: vi.fn(() => chain) } as any
}

describe('findDuplicate', () => {
  it('returns the existing id when a row matches', async () => {
    expect(await findDuplicate(adminReturning([{ id: 'dup-1' }]), 'folder-1', { fileHash: 'abc' })).toBe('dup-1')
  })
  it('returns null when none match', async () => {
    expect(await findDuplicate(adminReturning([]), 'folder-1', { sourceUrl: 'https://x' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, verify failure**

Run: `npx vitest run lib/deliverables/persist.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper** (code shown in Step 1) and run:

Run: `npx vitest run lib/deliverables/persist.test.ts`
Expected: PASS.

- [ ] **Step 4: Implement the upload route**

```typescript
// app/api/deliverables/upload/route.ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GoogleDrive } from '@/lib/drive/google'
import { fileDeliverable, type FolderResolver } from '@/lib/deliverables/ingest'
import { findDuplicate } from '@/lib/deliverables/persist'
import { sha256 } from '@/lib/deliverables/dedup'
import { projectFolderName } from '@/lib/deliverables/naming'
// Mirror the auth import used at the top of app/api/parse-questionnaire/route.ts:
import { requireAnalyst } from '@/lib/auth/requireAnalyst'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const projectId = form.get('projectId') as string | null
  const file = form.get('file') as File | null
  const link = form.get('link') as string | null
  if (!projectId || (!file && !link)) return NextResponse.json({ error: 'projectId and a file or link are required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: project } = await admin
    .from('survey_projects')
    .select('id, client_id, project_code, project_name, deliver_date')
    .eq('id', projectId).is('deleted_at', null).single()
  if (!project?.client_id || !project.project_code) {
    return NextResponse.json({ error: 'Project must have a client and code before filing deliverables' }, { status: 422 })
  }

  const drive = new GoogleDrive()
  const sharedDriveId = process.env.DELIVERABLES_SHARED_DRIVE_ID!
  const dateISO = (project.deliver_date as string | null) ?? new Date().toISOString().slice(0, 10)

  const resolver: FolderResolver = {
    sharedDriveId,
    clientFolderId: () => ensureClientFolder(admin, drive, sharedDriveId, project.client_id!),
    projectFolderName: () => projectFolderName(project.project_name, project.project_code!, dateISO),
    needsReviewFolderName: '00_Needs Review',
    unsortedFolderName: '_Unsorted',
  }

  const bytes = file ? Buffer.from(await file.arrayBuffer()) : undefined
  const fileHash = bytes ? sha256(bytes) : null
  const folderId = await resolver.clientFolderId().then((cid) => drive.findChildFolder(cid, resolver.projectFolderName())) // may be null pre-create
  // Dedup check against the resolved project folder (create-or-find happens in fileDeliverable).
  const targetFolderId = folderId ?? (await ensureProjectFolder(drive, resolver))
  const dup = await findDuplicate(admin, targetFolderId, { fileHash, sourceUrl: link ?? null })
  if (dup) {
    return NextResponse.json({ status: 'duplicate', duplicate_of: dup })
  }

  const rec = await fileDeliverable(drive, resolver, {
    kind: file ? 'file' : 'link',
    confident: true,
    hasProject: true,
    original_file_name: file?.name ?? (link ?? 'link'),
    dateISO,
    mimeType: file?.type,
    bytes,
    source_url: link ?? undefined,
  })

  const { data: inserted, error } = await admin.from('deliverables').insert({
    client_id: project.client_id,
    project_id: project.id,
    kind: rec.kind,
    drive_file_id: rec.drive_file_id,
    drive_folder_id: rec.drive_folder_id,
    file_name: rec.file_name,
    original_file_name: file?.name ?? null,
    file_hash: fileHash,
    source_url: link ?? null,
    mime_type: file?.type ?? null,
    size_bytes: bytes?.length ?? null,
    source: 'upload',
    status: rec.status,
    match_confidence: 1,
    match_method: 'upload_context',
    filed_by: user.id,
    filed_at: new Date().toISOString(),
  }).select('id').single()
  if (error) return NextResponse.json({ error: 'Insert failed' }, { status: 500 })

  // Audit: log to project_activity (project is known here).
  await admin.from('project_activity').insert({
    project_id: project.id, type: 'deliverable', direction: 'outbound',
    subject: rec.file_name, snippet: `Filed deliverable: ${rec.file_name}`,
    source: 'deliverables', external_id: `deliverable:${inserted!.id}`,
    occurred_at: new Date().toISOString(),
  })

  return NextResponse.json({ status: rec.status, id: inserted!.id, drive_file_id: rec.drive_file_id })
}

// helpers
async function ensureClientFolder(admin: ReturnType<typeof createAdminClient>, drive: GoogleDrive, sharedDriveId: string, clientId: string): Promise<string> {
  const { data: client } = await admin.from('clients').select('drive_folder_id, name, code').eq('id', clientId).single()
  if (client?.drive_folder_id) return client.drive_folder_id
  const name = client?.code ? `${client.name} (${client.code})` : (client?.name ?? clientId)
  const created = (await drive.findChildFolder(sharedDriveId, name)) ?? (await drive.createFolder(sharedDriveId, name))
  await admin.from('clients').update({ drive_folder_id: created }).eq('id', clientId)
  return created
}

async function ensureProjectFolder(drive: GoogleDrive, r: FolderResolver): Promise<string> {
  const clientFolder = await r.clientFolderId()
  return (await drive.findChildFolder(clientFolder, r.projectFolderName())) ?? (await drive.createFolder(clientFolder, r.projectFolderName()))
}
```

> The `survey_projects.drive_folder_id` cache is populated opportunistically in Phase 2 hardening; for Phase 1 we find-or-create by name each time (idempotent and correct).

- [ ] **Step 5: Verify compile + existing tests**

Run: `npx tsc --noEmit && npx vitest run lib/deliverables`
Expected: no type errors; all deliverables unit tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/deliverables/upload/route.ts lib/deliverables/persist.ts lib/deliverables/persist.test.ts
git commit -m "feat(deliverables): in-app upload route (auth, dedup, drive file, audit)"
```

---

## Task 13: Project-page UI — Attach + list

**Files:**
- Create: `lib/hooks/useDeliverables.ts`
- Create: `components/deliverables/DeliverablesPanel.tsx`
- Modify: `app/(app)/projects/[id]/page.tsx`
- Modify: `components/shared/AppMenu.tsx`
- Test: `__tests__/components/deliverables/DeliverablesPanel.test.tsx`

- [ ] **Step 1: Write the hook**

```typescript
// lib/hooks/useDeliverables.ts
'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

export type DeliverableRow = {
  id: string; file_name: string | null; original_file_name: string | null
  kind: 'file' | 'link'; status: string; source: 'email' | 'upload'
  drive_file_id: string | null; source_url: string | null; filed_at: string | null
}

export function useDeliverables(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['deliverables', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deliverables').select('id, file_name, original_file_name, kind, status, source, drive_file_id, source_url, filed_at')
        .eq('project_id', projectId).is('deleted_at', null).order('filed_at', { ascending: false })
      if (error) throw error
      return data as DeliverableRow[]
    },
  })
}

export function useUploadDeliverable(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { file?: File; link?: string }) => {
      const form = new FormData()
      form.append('projectId', projectId)
      if (payload.file) form.append('file', payload.file)
      if (payload.link) form.append('link', payload.link)
      const res = await fetch('/api/deliverables/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Upload failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverables', projectId] }),
  })
}
```

- [ ] **Step 2: Write the failing component test**

```tsx
// __tests__/components/deliverables/DeliverablesPanel.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DeliverablesPanel } from '@/components/deliverables/DeliverablesPanel'

vi.mock('@/lib/hooks/useDeliverables', () => ({
  useDeliverables: () => ({ data: [
    { id: '1', file_name: '2026.06.10 — Topline.pdf', kind: 'file', status: 'filed', source: 'email', drive_file_id: 'd1', source_url: null, filed_at: '2026-06-10T00:00:00Z', original_file_name: 'Topline.pdf' },
  ], isLoading: false }),
  useUploadDeliverable: () => ({ mutate: vi.fn(), isPending: false }),
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('DeliverablesPanel', () => {
  it('lists filed deliverables and shows the attach control', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    expect(screen.getByText('2026.06.10 — Topline.pdf')).toBeInTheDocument()
    expect(screen.getByText(/attach deliverable/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run it, verify failure**

Run: `npx vitest run __tests__/components/deliverables/DeliverablesPanel.test.tsx`
Expected: FAIL (component not found).

- [ ] **Step 4: Implement the panel**

```tsx
// components/deliverables/DeliverablesPanel.tsx
'use client'
import { useRef, useState } from 'react'
import { useDeliverables, useUploadDeliverable, type DeliverableRow } from '@/lib/hooks/useDeliverables'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/utils/toast'

const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`

export function DeliverablesPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useDeliverables(projectId)
  const upload = useUploadDeliverable(projectId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [link, setLink] = useState('')

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    upload.mutate({ file }, { onSuccess: (r) => toast(r.status === 'duplicate' ? 'Already filed — skipped' : 'Filed ✓', 'success'), onError: (err) => toast(String((err as Error).message)) })
  }
  function onLink() {
    if (!link.trim()) return
    upload.mutate({ link: link.trim() }, { onSuccess: () => { setLink(''); toast('Filed ✓', 'success') }, onError: (err) => toast(String((err as Error).message)) })
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold flex items-center">
        Deliverables
        <InfoTooltip text="Final files/links sent to the client. Stored in the client's Shared Drive folder; this list is the index." />
      </h3>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button onClick={() => fileRef.current?.click()} disabled={upload.isPending} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted">
          {upload.isPending ? 'Filing…' : '+ Attach deliverable'}
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste a deliverable link" className="text-xs px-2 py-1.5 rounded-lg border border-border flex-1 min-w-40 bg-background" />
        <button onClick={onLink} disabled={upload.isPending || !link.trim()} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted">Add link</button>
      </div>

      <ul className="mt-3 space-y-1.5">
        {isLoading && <li className="text-xs text-muted-foreground">Loading…</li>}
        {!isLoading && (data?.length ?? 0) === 0 && <li className="text-xs text-muted-foreground">No deliverables filed yet.</li>}
        {data?.map((d: DeliverableRow) => (
          <li key={d.id} className="flex items-center gap-2 text-sm">
            <span>{d.kind === 'link' ? '🔗' : '📄'}</span>
            <a className="flex-1 truncate hover:underline" href={d.drive_file_id ? driveUrl(d.drive_file_id) : d.source_url ?? '#'} target="_blank" rel="noreferrer">{d.file_name ?? d.original_file_name}</a>
            <Badge variant="secondary">{d.source}</Badge>
            {d.status !== 'filed' && <Badge variant="outline">{d.status}</Badge>}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: Run it, verify pass**

Run: `npx vitest run __tests__/components/deliverables/DeliverablesPanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Mount it on the project page + add nav**

In `app/(app)/projects/[id]/page.tsx`, import and render `<DeliverablesPanel projectId={project.id} />` in the left column near the existing CompliancePanel:

```tsx
import { DeliverablesPanel } from '@/components/deliverables/DeliverablesPanel'
// ...within the left column JSX:
<DeliverablesPanel projectId={project.id} />
```

In `components/shared/AppMenu.tsx`, add a nav link (a Phase-1 placeholder index page is created in Step 7):

```tsx
<Link href="/deliverables" className={itemClass} title="Deliverables depository — files & links sent to clients">
  <span>📦</span> Deliverables
</Link>
```

- [ ] **Step 7: Add a minimal `/deliverables` index page** (full index/QA is Phase 2/3)

Create `app/(app)/deliverables/page.tsx`:

```tsx
export const dynamic = 'force-dynamic'
export default function DeliverablesPage() {
  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-semibold">Deliverables</h1>
      <p className="text-sm text-muted-foreground mt-2">
        Attach deliverables from any project page. Email forwarding, the review queue, and the weekly QA report arrive in the next phases.
      </p>
    </div>
  )
}
```

- [ ] **Step 8: Verify build + full test suite**

Run: `npm run test && npm run build`
Expected: all tests PASS; production build succeeds (no type errors, no route conflicts).

- [ ] **Step 9: Commit**

```bash
git add lib/hooks/useDeliverables.ts components/deliverables/ app/(app)/deliverables/page.tsx app/(app)/projects/[id]/page.tsx components/shared/AppMenu.tsx __tests__/components/deliverables/
git commit -m "feat(deliverables): project-page Attach + list, nav entry, index placeholder"
```

---

## Task 14: Client→folder backfill script + env docs + manual smoke test

**Files:**
- Create: `scripts/map-drive-folders.mjs`
- Modify: `.env.local.example`
- Modify: `USER_GUIDE.md`

- [ ] **Step 1: Write the backfill script**

```javascript
// scripts/map-drive-folders.mjs
// One-time: list the Shared Drive's top-level folders, fuzzy-match to clients,
// emit scripts/drive-folder-mapping.csv for David to confirm. Does NOT write
// drive_folder_id automatically — review the CSV, then re-run with --apply.
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { writeFileSync, readFileSync, existsSync } from 'fs'

const SHARED_DRIVE_ID = process.env.DELIVERABLES_SHARED_DRIVE_ID
const apply = process.argv.includes('--apply')

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const creds = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'))
const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive'] })
const drive = google.drive({ version: 'v3', auth })

const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

async function main() {
  const { data: clients } = await admin.from('clients').select('id, name, code')
  const res = await drive.files.list({
    q: `'${SHARED_DRIVE_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  const folders = res.data.files ?? []

  if (apply && existsSync('scripts/drive-folder-mapping.csv')) {
    const rows = readFileSync('scripts/drive-folder-mapping.csv', 'utf8').split('\n').slice(1).filter(Boolean)
    let n = 0
    for (const row of rows) {
      const [clientId, , folderId] = row.split(',')
      if (clientId && folderId) { await admin.from('clients').update({ drive_folder_id: folderId.trim() }).eq('id', clientId.trim()); n++ }
    }
    console.log(`Applied ${n} mappings.`)
    return
  }

  const lines = ['client_id,client_name,folder_id,folder_name,confidence']
  for (const c of clients ?? []) {
    const exact = folders.find((f) => norm(f.name) === norm(c.name))
    const partial = exact ?? folders.find((f) => norm(f.name).includes(norm(c.name)) || norm(c.name).includes(norm(f.name)))
    const conf = exact ? 'exact' : partial ? 'partial' : 'none'
    lines.push(`${c.id},${JSON.stringify(c.name)},${partial?.id ?? ''},${JSON.stringify(partial?.name ?? '')},${conf}`)
  }
  writeFileSync('scripts/drive-folder-mapping.csv', lines.join('\n'))
  console.log(`Wrote scripts/drive-folder-mapping.csv (${(clients ?? []).length} clients). Review it, fix any 'partial'/'none' rows, then run with --apply.`)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Document env vars**

Append to `.env.local.example`:

```
# Deliverables depository
DELIVERABLES_SHARED_DRIVE_ID=0AB_Z5JdTWs9WUk9PVA
GOOGLE_SERVICE_ACCOUNT_KEY=base64-encoded-service-account-json
```

- [ ] **Step 3: USER_GUIDE.md section**

Add a "Deliverables" section to `USER_GUIDE.md`: what the depository is, how to attach a file/link on a project page, where files land in Drive (`Client / Project_PR#####_date`), and that email forwarding + the weekly report are coming in later phases.

- [ ] **Step 4: Manual smoke test** (requires the one-time human setup — see "Human setup" below)

1. Create the GCP service account, base64 its JSON key into `GOOGLE_SERVICE_ACCOUNT_KEY`, add the service account as Content Manager on the Shared Drive, set `DELIVERABLES_SHARED_DRIVE_ID`.
2. `node scripts/map-drive-folders.mjs` → review `scripts/drive-folder-mapping.csv` → `node scripts/map-drive-folders.mjs --apply`.
3. `npm run dev`, open a real project, Attach a small PDF.
4. Confirm: the file appears in Drive at `Client / {Project}_{PR#####}_{date} /`, the project page lists it, and a second upload of the same file returns "Already filed — skipped".

- [ ] **Step 5: Commit**

```bash
git add scripts/map-drive-folders.mjs .env.local.example USER_GUIDE.md
git commit -m "feat(deliverables): client→folder backfill script, env docs, user guide"
```

---

## Phase 1 Self-Review Checklist (run before handoff)

- [ ] All unit suites green: `npm run test`.
- [ ] Production build clean: `npm run build`.
- [ ] Smoke test (Task 14 Step 4) passed against real Drive.
- [ ] No `deliverables` rows readable by a `compliance` test user (manual REST check with a compliance JWT — there is no automated RLS harness in this repo; document the check in the PR).

---

## Phase 2 (next plan): Email transport + Review Queue + "Filed ✓"

Build once Phase 1 is merged. Each item becomes full TDD tasks in its own plan:

- **Google Group + backing inbox** (human setup): create `deliverables@alpharoc.ai` Group with Collaborative Inbox; deliver into an ops inbox.
- **Apps Script transport** (`scripts/apps-script/deliverables.gs`, documented, not in the Next build): time-driven trigger → POST message (subject/from/date/message-id/body/attachments) to `/api/deliverables/ingest` with the secret → label `filed`.
- **`/api/deliverables/ingest`** route (`WEBHOOK_SECRET`): itemize attachments + links, run `loadMatchData` + `matchDeliverable`, apply the 0.85 auto-file threshold, file-or-stage via the Phase-1 ingest core, persist rows (incl. `gmail_message_id` idempotency), reject non-`@alpharoc.ai` forwarders. Reuses every Phase-1 lib.
- **"Filed ✓" reply** via `sendAndLog` (one reply per forwarded message summarizing items + folder links; staged items link to the queue).
- **Review Queue UI** (`app/(app)/deliverables` upgraded): list `status='review'` rows with `match_candidates`, plain-language confidence (High/Med/Low), one-click resolve → `moveFile` into the chosen `Client/Project` folder + flip status.
- **Survey_projects.drive_folder_id caching** + folder auto-rename when `deliver_date` is set later.

## Phase 3 (next plan): Weekly QA report + AI matcher tier

- **AI fallback (matcher tier 5):** `lib/deliverables/ai-match.ts` using `@anthropic-ai/sdk` tool-use (model `claude-opus-4-8`), invoked only when tiers 1–4 are weak/conflicting; returns `{clientId, projectId, confidence, rationale}`.
- **Weekly cron** `app/api/cron/deliverables-qa/route.ts` (+ `vercel.json` entry, `CRON_SECRET`): filed-this-week, exact duplicates, near-duplicates (same project, similar name/size, different hash), stuck review items, low-confidence (<0.92) auto-files, anomalies (`_Unsorted`, clients with no `drive_folder_id`, same content in two clients).
- **Delivery:** `sendAndLog` digest to the team alias + a filterable **Deliverables QA page**.

---

## Human setup (one-time, all free — owner: David)

1. **GCP service account:** create a free Google Cloud project + service account; download JSON key; base64 it into `GOOGLE_SERVICE_ACCOUNT_KEY` (Vercel env + local). Add the service-account email as **Content Manager** on the Shared Drive (`0AB_Z5JdTWs9WUk9PVA`) only.
2. **Set** `DELIVERABLES_SHARED_DRIVE_ID` in Vercel + local.
3. **Run the folder backfill** (Task 14) and confirm the CSV.
4. **(Phase 2)** Create the `deliverables@alpharoc.ai` Google Group (Collaborative Inbox) + backing inbox; authorize the Apps Script; set `WEBHOOK_SECRET` in Script Properties.
