# Client Compliance Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-facing compliance portal to survey-ops-tracker: analysts upload a questionnaire, Claude parses it into structured questions, client compliance reviews (with open-text filter) and approves/rejects, with Resend email notifications and versioned resubmission.

**Architecture:** New Supabase tables (`clients`, `profiles`, `question_submissions`, `questions`, `project_recipients`, `notification_log`) with role-scoped RLS replacing today's open policies. Internal app gains a Compliance Review panel on the project page; a new `(portal)` route group serves external compliance users authenticated via Supabase magic links. Server-side API routes handle parsing (Claude), submission creation, decisions, and recipient provisioning; Resend sends notifications.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + Auth + Storage), @anthropic-ai/sdk, Resend, mammoth (.docx), xlsx (sheets), TanStack Query, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-compliance-portal-design.md`

**Working directory:** all paths relative to `survey-ops-tracker/` unless prefixed with `docs/`.

**Conventions to follow:** client components use React Query hooks (`lib/hooks/`) that call Supabase directly from the browser; server layouts do auth via `lib/supabase/server.ts`; dark slate theme (`bg-slate-950` page, `bg-slate-900` cards, `border-slate-800`); migrations are numbered SQL files in `supabase/migrations/` applied by pasting into the Supabase SQL editor.

---

### Task 1: Dependencies and environment variables

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `.env.local.example`

- [ ] **Step 1: Install new dependencies**

```bash
npm install resend mammoth xlsx
```

Expected: all three added to `dependencies` in package.json with no install errors.

- [ ] **Step 2: Add env vars to the example file**

Append to `.env.local.example`:

```
RESEND_API_KEY=your-resend-api-key
EMAIL_FROM=AlphaRoc Compliance <notifications@yourdomain.com>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Also add the same three vars with real values to `.env.local` (the user supplies `RESEND_API_KEY`; until a domain is verified in Resend, use `EMAIL_FROM=onboarding@resend.dev` and recipient = the user's own email).

- [ ] **Step 3: Verify build still passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.local.example
git commit -m "chore: add resend, mammoth, xlsx deps and portal env vars"
```

---

### Task 2: Migration 005 — clients table + client_id backfill

**Files:**
- Create: `supabase/migrations/005_clients.sql`

- [ ] **Step 1: Write the migration**

```sql
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

alter table public.survey_projects
  add column client_id uuid references public.clients(id);

-- Backfill from the existing free-text client column
insert into public.clients (name)
select distinct client from public.survey_projects
where client is not null and client <> ''
on conflict (name) do nothing;

update public.survey_projects sp
set client_id = c.id
from public.clients c
where sp.client = c.name;
```

- [ ] **Step 2: Apply the migration**

Paste the file contents into the Supabase SQL editor and run. (Same process used for migrations 001–004 — see `SUPABASE_SETUP.md`.)

Verify: `select count(*) from clients;` returns ≥ 1 (if any projects exist) and `select count(*) from survey_projects where client_id is null and client is not null and client <> '';` returns 0.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/005_clients.sql
git commit -m "feat(db): add clients table and backfill survey_projects.client_id"
```

---

### Task 3: Migration 006 — profiles, roles, helper functions

**Files:**
- Create: `supabase/migrations/006_profiles.sql`

- [ ] **Step 1: Write the migration**

```sql
create type public.profile_role as enum ('analyst', 'compliance');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.profile_role not null default 'analyst',
  client_id uuid references public.clients(id),
  created_at timestamptz default now(),
  constraint compliance_needs_client check (role <> 'compliance' or client_id is not null)
);

-- Backfill: every existing auth user is an internal analyst
insert into public.profiles (id, email, role)
select id, email, 'analyst' from auth.users
on conflict (id) do nothing;

-- Security-definer helpers so RLS policies can check role/client
-- without recursive RLS lookups
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as
$$ select role::text from public.profiles where id = auth.uid() $$;

create or replace function public.my_client_id()
returns uuid language sql stable security definer set search_path = public as
$$ select client_id from public.profiles where id = auth.uid() $$;

create or replace function public.project_client_id(pid uuid)
returns uuid language sql stable security definer set search_path = public as
$$ select client_id from public.survey_projects where id = pid $$;
```

Note: new internal analysts created later need a `profiles` row. Document this in `SUPABASE_SETUP.md` (Step 3 below). Compliance profiles are created automatically by the recipients API (Task 13).

- [ ] **Step 2: Apply in Supabase SQL editor**

Verify: `select email, role from profiles;` lists existing users as `analyst`.

- [ ] **Step 3: Document analyst provisioning**

Append to `SUPABASE_SETUP.md`:

```markdown
## Adding a new internal analyst

After creating the auth user (Dashboard → Authentication → Add user), run:

​```sql
insert into public.profiles (id, email, role)
select id, email, 'analyst' from auth.users where email = 'new.analyst@alpharoc.com';
​```
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/006_profiles.sql SUPABASE_SETUP.md
git commit -m "feat(db): add profiles with roles and RLS helper functions"
```

---

### Task 4: Migration 007 — submissions, questions, recipients, notification log

**Files:**
- Create: `supabase/migrations/007_submissions.sql`

- [ ] **Step 1: Write the migration**

```sql
create type public.submission_status as enum ('pending_review', 'approved', 'rejected');
create type public.question_type as enum ('open_text', 'single_select', 'multi_select', 'scale', 'other');
create type public.recipient_role as enum ('alpharoc', 'compliance');

create table public.question_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  version integer not null,
  status public.submission_status not null default 'pending_review',
  source_file_name text not null,
  source_file_path text not null,
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz default now(),
  unique (project_id, version)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.question_submissions(id) on delete cascade,
  order_num integer not null,
  text text not null,
  type public.question_type not null default 'other',
  is_open_text boolean not null default false,
  is_ai_followup boolean not null default false,
  section text,
  answer_options jsonb not null default '[]'
);

create table public.project_recipients (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  email text not null,
  name text,
  role public.recipient_role not null,
  created_at timestamptz default now(),
  unique (project_id, email, role)
);

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.question_submissions(id) on delete set null,
  recipient_email text not null,
  template text not null,
  resend_id text,
  sent_at timestamptz default now()
);

create index questions_submission_idx on public.questions (submission_id, order_num);
create index submissions_project_idx on public.question_submissions (project_id, version desc);
```

- [ ] **Step 2: Apply in Supabase SQL editor**

Verify: all four tables appear in the Table editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_submissions.sql
git commit -m "feat(db): add question_submissions, questions, recipients, notification_log"
```

---

### Task 5: Migration 008 — role-scoped RLS, portal view, storage bucket

**Files:**
- Create: `supabase/migrations/008_portal_rls.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============ Replace open policies with role-scoped ones ============

-- team_members: internal only now
drop policy "authenticated users can read team members" on public.team_members;
create policy "analysts read team members"
  on public.team_members for select to authenticated
  using (public.my_role() = 'analyst');

-- survey_projects: analysts keep full access; compliance gets NO direct
-- table access (they use the portal_projects view below)
drop policy "authenticated users can read projects" on public.survey_projects;
drop policy "authenticated users can insert projects" on public.survey_projects;
drop policy "authenticated users can update projects" on public.survey_projects;

create policy "analysts read projects"
  on public.survey_projects for select to authenticated
  using (public.my_role() = 'analyst');
create policy "analysts insert projects"
  on public.survey_projects for insert to authenticated
  with check (public.my_role() = 'analyst');
create policy "analysts update projects"
  on public.survey_projects for update to authenticated
  using (public.my_role() = 'analyst');

-- ============ New tables ============

alter table public.clients enable row level security;
alter table public.profiles enable row level security;
alter table public.question_submissions enable row level security;
alter table public.questions enable row level security;
alter table public.project_recipients enable row level security;
alter table public.notification_log enable row level security;

-- clients
create policy "analysts full read clients" on public.clients for select to authenticated
  using (public.my_role() = 'analyst');
create policy "analysts insert clients" on public.clients for insert to authenticated
  with check (public.my_role() = 'analyst');
create policy "compliance reads own client" on public.clients for select to authenticated
  using (id = public.my_client_id());

-- profiles: users read their own row; analysts read all
create policy "read own profile" on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "analysts read profiles" on public.profiles for select to authenticated
  using (public.my_role() = 'analyst');

-- question_submissions
create policy "analysts read submissions" on public.question_submissions for select to authenticated
  using (public.my_role() = 'analyst');
create policy "compliance reads own submissions" on public.question_submissions for select to authenticated
  using (public.my_role() = 'compliance'
         and public.project_client_id(project_id) = public.my_client_id());
create policy "compliance decides pending submissions" on public.question_submissions
  for update to authenticated
  using (public.my_role() = 'compliance'
         and status = 'pending_review'
         and public.project_client_id(project_id) = public.my_client_id())
  with check (public.project_client_id(project_id) = public.my_client_id());

-- Column-level safety: authenticated users may only update decision fields.
-- (Analysts never update submissions; new versions are new rows via service role.)
revoke update on public.question_submissions from authenticated;
grant update (status, reviewed_by, reviewed_at, review_note)
  on public.question_submissions to authenticated;

-- questions (insert happens via service role in API routes)
create policy "analysts read questions" on public.questions for select to authenticated
  using (public.my_role() = 'analyst');
create policy "compliance reads own questions" on public.questions for select to authenticated
  using (public.my_role() = 'compliance'
         and public.project_client_id(
           (select project_id from public.question_submissions qs where qs.id = submission_id)
         ) = public.my_client_id());

-- project_recipients: analysts only (managed in internal app)
create policy "analysts manage recipients" on public.project_recipients for all to authenticated
  using (public.my_role() = 'analyst')
  with check (public.my_role() = 'analyst');

-- notification_log: analysts read; writes via service role only
create policy "analysts read notification log" on public.notification_log for select to authenticated
  using (public.my_role() = 'analyst');

-- ============ Portal view: safe columns only ============
-- Owned by postgres => bypasses survey_projects RLS, so the WHERE clause
-- does the scoping. Exposes no budget/spend/internal fields.
create view public.portal_projects
with (security_barrier) as
select id, project_name, client_id, submitted_date, launch_date, due_date, created_at
from public.survey_projects
where public.my_role() = 'compliance'
  and client_id = public.my_client_id();

grant select on public.portal_projects to authenticated;

-- ============ Storage bucket for questionnaire files ============
insert into storage.buckets (id, name, public) values ('questionnaires', 'questionnaires', false)
on conflict (id) do nothing;

-- Path convention: {project_id}/{timestamp}-{filename}
create policy "analysts manage questionnaire files" on storage.objects
  for all to authenticated
  using (bucket_id = 'questionnaires' and public.my_role() = 'analyst')
  with check (bucket_id = 'questionnaires' and public.my_role() = 'analyst');

create policy "compliance reads own client files" on storage.objects
  for select to authenticated
  using (bucket_id = 'questionnaires'
         and public.my_role() = 'compliance'
         and public.project_client_id(((storage.foldername(name))[1])::uuid) = public.my_client_id());
```

- [ ] **Step 2: Apply in Supabase SQL editor**

Verify with manual RLS checks in the SQL editor:

```sql
-- As an analyst user (run while impersonating via Dashboard "Run as user" or just sanity-check policies exist):
select * from pg_policies where tablename in ('survey_projects','question_submissions','questions') order by tablename;
```

Expected: the policies listed above, no `authenticated users can ...` policies remaining on survey_projects/team_members.

- [ ] **Step 3: Configure Supabase Auth for the portal (Dashboard, manual)**

1. Authentication → URL Configuration → add `http://localhost:3000/auth/callback` and the production `https://<vercel-domain>/auth/callback` to Redirect URLs.
2. Authentication → Sign In / Up → ensure Email provider is enabled (magic links use it).

- [ ] **Step 4: Verify the app still works for analysts**

Run: `npm run dev`, log in as the existing analyst user, confirm the board loads (analyst policies must keep current behavior working).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/008_portal_rls.sql
git commit -m "feat(db): role-scoped RLS, portal_projects view, questionnaires bucket"
```

---

### Task 6: TypeScript types + service-role admin client

**Files:**
- Modify: `lib/supabase/types.ts`
- Create: `lib/supabase/admin.ts`

- [ ] **Step 1: Add new enums to `lib/supabase/types.ts`**

In the existing `Enums` section of `Database['public']`, add:

```ts
      profile_role: 'analyst' | 'compliance'
      submission_status: 'pending_review' | 'approved' | 'rejected'
      question_type: 'open_text' | 'single_select' | 'multi_select' | 'scale' | 'other'
      recipient_role: 'alpharoc' | 'compliance'
```

- [ ] **Step 2: Add new tables to the `Tables` section**

```ts
      clients: {
        Row: { id: string; name: string; created_at: string }
        Insert: { id?: string; name: string; created_at?: string }
        Update: { id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      profiles: {
        Row: { id: string; email: string; full_name: string | null; role: Database['public']['Enums']['profile_role']; client_id: string | null; created_at: string }
        Insert: { id: string; email: string; full_name?: string | null; role?: Database['public']['Enums']['profile_role']; client_id?: string | null; created_at?: string }
        Update: { id?: string; email?: string; full_name?: string | null; role?: Database['public']['Enums']['profile_role']; client_id?: string | null; created_at?: string }
        Relationships: []
      }
      question_submissions: {
        Row: { id: string; project_id: string; version: number; status: Database['public']['Enums']['submission_status']; source_file_name: string; source_file_path: string; submitted_by: string | null; submitted_at: string; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; created_at: string }
        Insert: { id?: string; project_id: string; version: number; status?: Database['public']['Enums']['submission_status']; source_file_name: string; source_file_path: string; submitted_by?: string | null; submitted_at?: string; reviewed_by?: string | null; reviewed_at?: string | null; review_note?: string | null; created_at?: string }
        Update: { id?: string; project_id?: string; version?: number; status?: Database['public']['Enums']['submission_status']; source_file_name?: string; source_file_path?: string; submitted_by?: string | null; submitted_at?: string; reviewed_by?: string | null; reviewed_at?: string | null; review_note?: string | null; created_at?: string }
        Relationships: []
      }
      questions: {
        Row: { id: string; submission_id: string; order_num: number; text: string; type: Database['public']['Enums']['question_type']; is_open_text: boolean; is_ai_followup: boolean; section: string | null; answer_options: Json }
        Insert: { id?: string; submission_id: string; order_num: number; text: string; type?: Database['public']['Enums']['question_type']; is_open_text?: boolean; is_ai_followup?: boolean; section?: string | null; answer_options?: Json }
        Update: { id?: string; submission_id?: string; order_num?: number; text?: string; type?: Database['public']['Enums']['question_type']; is_open_text?: boolean; is_ai_followup?: boolean; section?: string | null; answer_options?: Json }
        Relationships: []
      }
      project_recipients: {
        Row: { id: string; project_id: string; email: string; name: string | null; role: Database['public']['Enums']['recipient_role']; created_at: string }
        Insert: { id?: string; project_id: string; email: string; name?: string | null; role: Database['public']['Enums']['recipient_role']; created_at?: string }
        Update: { id?: string; project_id?: string; email?: string; name?: string | null; role?: Database['public']['Enums']['recipient_role']; created_at?: string }
        Relationships: []
      }
      notification_log: {
        Row: { id: string; submission_id: string | null; recipient_email: string; template: string; resend_id: string | null; sent_at: string }
        Insert: { id?: string; submission_id?: string | null; recipient_email: string; template: string; resend_id?: string | null; sent_at?: string }
        Update: { id?: string; submission_id?: string | null; recipient_email?: string; template?: string; resend_id?: string | null; sent_at?: string }
        Relationships: []
      }
```

Also add to the `Views` section (create the section if the file has `Views: { [_ in never]: never }`, replace it):

```ts
    Views: {
      portal_projects: {
        Row: { id: string; project_name: string; client_id: string; submitted_date: string | null; launch_date: string | null; due_date: string | null; created_at: string }
      }
    }
```

- [ ] **Step 3: Add `client_id` to the existing `survey_projects` Row/Insert/Update types**

```ts
          client_id: string | null        // Row
          client_id?: string | null       // Insert and Update
```

- [ ] **Step 4: Create `lib/supabase/admin.ts`** (service-role client, server-only)

```ts
import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

// Service-role client: bypasses RLS. Server-side code only.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

Install the guard package:

```bash
npm install server-only
```

- [ ] **Step 5: Verify typecheck/build**

Run: `npm run build`
Expected: success, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/types.ts lib/supabase/admin.ts package.json package-lock.json
git commit -m "feat: add portal table types and service-role admin client"
```

---

### Task 7: Question validation/normalization (TDD)

This is the shared shape between the Claude parser, the preview editor, and submission creation.

**Files:**
- Create: `lib/parsing/validate.ts`
- Test: `__tests__/lib/parsing/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeQuestions, type DraftQuestion } from '@/lib/parsing/validate'

const valid: DraftQuestion = {
  order_num: 1,
  text: 'What is your role?',
  section: 'Screener',
  type: 'single_select',
  is_open_text: false,
  is_ai_followup: false,
  answer_options: ['IC', 'Manager'],
}

describe('normalizeQuestions', () => {
  it('passes through valid questions', () => {
    const result = normalizeQuestions([valid])
    expect(result.ok).toBe(true)
    expect(result.questions).toHaveLength(1)
  })

  it('forces is_open_text=true when is_ai_followup=true', () => {
    const result = normalizeQuestions([
      { ...valid, type: 'other', is_open_text: false, is_ai_followup: true },
    ])
    expect(result.questions[0].is_open_text).toBe(true)
  })

  it('forces is_open_text=true when type is open_text', () => {
    const result = normalizeQuestions([
      { ...valid, type: 'open_text', is_open_text: false },
    ])
    expect(result.questions[0].is_open_text).toBe(true)
  })

  it('rejects empty question text', () => {
    const result = normalizeQuestions([{ ...valid, text: '   ' }])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/text/i)
  })

  it('rejects an empty list', () => {
    const result = normalizeQuestions([])
    expect(result.ok).toBe(false)
  })

  it('coerces unknown type to other', () => {
    const result = normalizeQuestions([
      { ...valid, type: 'weird' as DraftQuestion['type'] },
    ])
    expect(result.questions[0].type).toBe('other')
  })

  it('renumbers order_num sequentially from 1', () => {
    const result = normalizeQuestions([
      { ...valid, order_num: 5 },
      { ...valid, order_num: 9, text: 'Second?' },
    ])
    expect(result.questions.map(q => q.order_num)).toEqual([1, 2])
  })

  it('defaults missing answer_options to empty array', () => {
    const q = { ...valid } as Partial<DraftQuestion>
    delete q.answer_options
    const result = normalizeQuestions([q as DraftQuestion])
    expect(result.questions[0].answer_options).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run __tests__/lib/parsing/validate.test.ts`
Expected: FAIL — cannot resolve `@/lib/parsing/validate`.

- [ ] **Step 3: Implement `lib/parsing/validate.ts`**

```ts
export type QuestionType = 'open_text' | 'single_select' | 'multi_select' | 'scale' | 'other'

export type DraftQuestion = {
  order_num: number
  text: string
  section: string | null
  type: QuestionType
  is_open_text: boolean
  is_ai_followup: boolean
  answer_options: string[]
}

export type NormalizeResult = {
  ok: boolean
  questions: DraftQuestion[]
  errors: string[]
}

const VALID_TYPES: QuestionType[] = ['open_text', 'single_select', 'multi_select', 'scale', 'other']

export function normalizeQuestions(raw: DraftQuestion[]): NormalizeResult {
  const errors: string[] = []
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, questions: [], errors: ['No questions found'] }
  }

  const questions = raw.map((q, i) => {
    const text = typeof q.text === 'string' ? q.text.trim() : ''
    if (!text) errors.push(`Question ${i + 1}: empty text`)

    const type: QuestionType = VALID_TYPES.includes(q.type) ? q.type : 'other'
    const isAiFollowup = q.is_ai_followup === true
    // Domain rules: AI follow-ups are always open-text; open_text type implies the flag
    const isOpenText = isAiFollowup || type === 'open_text' || q.is_open_text === true

    return {
      order_num: i + 1,
      text,
      section: typeof q.section === 'string' && q.section.trim() ? q.section.trim() : null,
      type,
      is_open_text: isOpenText,
      is_ai_followup: isAiFollowup,
      answer_options: Array.isArray(q.answer_options)
        ? q.answer_options.filter(o => typeof o === 'string')
        : [],
    }
  })

  return { ok: errors.length === 0, questions, errors }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run __tests__/lib/parsing/validate.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/parsing/validate.ts __tests__/lib/parsing/validate.test.ts
git commit -m "feat: question normalization with open-text domain rules"
```

---

### Task 8: File text extraction

**Files:**
- Create: `lib/parsing/extract-text.ts`
- Test: `__tests__/lib/parsing/extract-text.test.ts`

- [ ] **Step 1: Write the failing tests** (csv + xlsx are testable in-memory; docx needs a real file so it's covered by manual E2E; pdf is passed straight to Claude, no extraction)

```ts
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { extractText, kindFromFilename } from '@/lib/parsing/extract-text'

describe('kindFromFilename', () => {
  it('maps extensions', () => {
    expect(kindFromFilename('q.docx')).toBe('docx')
    expect(kindFromFilename('q.xlsx')).toBe('sheet')
    expect(kindFromFilename('q.csv')).toBe('sheet')
    expect(kindFromFilename('q.pdf')).toBe('pdf')
    expect(kindFromFilename('q.txt')).toBe('unsupported')
  })
})

describe('extractText', () => {
  it('passes csv through as text', async () => {
    const csv = 'Q#,Question,Type\n1,What is your role?,Single select'
    const buf = Buffer.from(csv, 'utf-8')
    const text = await extractText(buf, 'questions.csv')
    expect(text).toContain('What is your role?')
  })

  it('extracts xlsx sheets as csv text', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Q#', 'Question', 'Type'],
      ['1', 'Why did you choose us?', 'Open end'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Survey')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const text = await extractText(buf, 'questions.xlsx')
    expect(text).toContain('Why did you choose us?')
    expect(text).toContain('Open end')
  })

  it('throws for unsupported extensions', async () => {
    await expect(extractText(Buffer.from('x'), 'notes.txt')).rejects.toThrow(/unsupported/i)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run __tests__/lib/parsing/extract-text.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/parsing/extract-text.ts`**

```ts
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

export type FileKind = 'docx' | 'sheet' | 'pdf' | 'unsupported'

export function kindFromFilename(filename: string): FileKind {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'docx' || ext === 'doc') return 'docx'
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'sheet'
  if (ext === 'pdf') return 'pdf'
  return 'unsupported'
}

// Returns plain text for docx/sheet files. PDFs are NOT handled here —
// they go to Claude as a native document block (see claude-parser.ts).
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const kind = kindFromFilename(filename)

  if (kind === 'docx') {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  if (kind === 'sheet') {
    if (filename.toLowerCase().endsWith('.csv')) {
      return buffer.toString('utf-8')
    }
    const wb = XLSX.read(buffer, { type: 'buffer' })
    return wb.SheetNames.map(name =>
      `--- Sheet: ${name} ---\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name])
    ).join('\n\n')
  }

  throw new Error(`Unsupported file type: ${filename}. Use .docx, .xlsx, .csv, or .pdf.`)
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run __tests__/lib/parsing/extract-text.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/parsing/extract-text.ts __tests__/lib/parsing/extract-text.test.ts
git commit -m "feat: questionnaire text extraction for docx/xlsx/csv"
```

---

### Task 9: Claude questionnaire parser

**Files:**
- Create: `lib/parsing/claude-parser.ts`
- Test: `__tests__/lib/parsing/claude-parser.test.ts`

- [ ] **Step 1: Write the failing tests** (mock the Anthropic client; test prompt rules and response handling)

```ts
import { describe, it, expect, vi } from 'vitest'
import { parseQuestionnaire, EXTRACTION_TOOL, SYSTEM_PROMPT } from '@/lib/parsing/claude-parser'

function mockAnthropicResponse(toolInput: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'record_questions', input: toolInput }],
      }),
    },
  }
}

describe('SYSTEM_PROMPT', () => {
  it('encodes the AI follow-up rule', () => {
    expect(SYSTEM_PROMPT).toMatch(/AI follow-up/i)
    expect(SYSTEM_PROMPT).toMatch(/open.?text/i)
  })
})

describe('EXTRACTION_TOOL', () => {
  it('requires the questions array with the right fields', () => {
    const props = EXTRACTION_TOOL.input_schema.properties.questions.items.properties
    for (const key of ['order_num', 'text', 'type', 'is_open_text', 'is_ai_followup', 'section', 'answer_options']) {
      expect(props).toHaveProperty(key)
    }
  })
})

describe('parseQuestionnaire', () => {
  it('returns normalized questions from a tool_use response', async () => {
    const client = mockAnthropicResponse({
      questions: [{
        order_num: 1, text: 'Why?', section: null, type: 'other',
        is_open_text: false, is_ai_followup: true, answer_options: [],
      }],
    })
    const result = await parseQuestionnaire(
      { kind: 'text', text: 'Q1. Why? [AI follow-up]' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    )
    expect(result.ok).toBe(true)
    // AI follow-up forced open-text by normalization
    expect(result.questions[0].is_open_text).toBe(true)
  })

  it('fails cleanly when no tool_use block comes back', async () => {
    const client = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'sorry' }] }) },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseQuestionnaire({ kind: 'text', text: 'x' }, client as any)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/extract/i)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run __tests__/lib/parsing/claude-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/parsing/claude-parser.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk'
import { normalizeQuestions, type NormalizeResult, type DraftQuestion } from './validate'

export const SYSTEM_PROMPT = `You extract survey questions from questionnaire documents for compliance review.

Extract EVERY question in document order. For each question determine:
- type: open_text (free-form written answer), single_select, multi_select, scale (rating/numeric scale), or other
- is_open_text: true for any question answered in the respondent's own words. Questionnaires often call these out explicitly: "open end", "open-end", "OE", "verbatim", "open text", "free response".
- is_ai_followup: true if the question is flagged as an AI follow-up / AI probe / dynamic follow-up. RULE: every AI follow-up question is ALWAYS is_open_text=true as well.
- section: the section heading the question appears under, if any
- answer_options: the list of answer choices for closed questions; [] for open-text

Do not invent questions. Do not skip questions. Preserve exact question wording.`

export const EXTRACTION_TOOL = {
  name: 'record_questions',
  description: 'Record the structured list of survey questions extracted from the document.',
  input_schema: {
    type: 'object' as const,
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            order_num: { type: 'integer' },
            text: { type: 'string' },
            section: { type: ['string', 'null'] },
            type: { type: 'string', enum: ['open_text', 'single_select', 'multi_select', 'scale', 'other'] },
            is_open_text: { type: 'boolean' },
            is_ai_followup: { type: 'boolean' },
            answer_options: { type: 'array', items: { type: 'string' } },
          },
          required: ['order_num', 'text', 'type', 'is_open_text', 'is_ai_followup'],
        },
      },
    },
    required: ['questions'],
  },
}

export type ParseInput =
  | { kind: 'text'; text: string }
  | { kind: 'pdf'; base64: string }

export async function parseQuestionnaire(
  input: ParseInput,
  client: Anthropic = new Anthropic()
): Promise<NormalizeResult> {
  const userContent =
    input.kind === 'pdf'
      ? [
          { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: input.base64 } },
          { type: 'text' as const, text: 'Extract all survey questions from this questionnaire.' },
        ]
      : [{ type: 'text' as const, text: `Extract all survey questions from this questionnaire:\n\n${input.text}` }]

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: 'record_questions' },
    messages: [{ role: 'user', content: userContent }],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { ok: false, questions: [], errors: ['Could not extract questions from the document'] }
  }

  const raw = (toolUse.input as { questions?: DraftQuestion[] }).questions ?? []
  return normalizeQuestions(raw)
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run __tests__/lib/parsing/claude-parser.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/parsing/claude-parser.ts __tests__/lib/parsing/claude-parser.test.ts
git commit -m "feat: Claude-based questionnaire question extraction"
```

---

### Task 10: Email templates and sender (TDD on templates)

**Files:**
- Create: `lib/email/templates.ts`
- Create: `lib/email/send.ts`
- Test: `__tests__/lib/email/templates.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { submissionCreatedEmail, decisionEmail } from '@/lib/email/templates'

describe('submissionCreatedEmail', () => {
  it('includes project, counts, and review link', () => {
    const email = submissionCreatedEmail({
      projectName: 'Cloud Survey',
      version: 2,
      questionCount: 24,
      openTextCount: 7,
      reviewUrl: 'https://app.example.com/portal/review/abc',
    })
    expect(email.subject).toContain('Cloud Survey')
    expect(email.html).toContain('24')
    expect(email.html).toContain('7')
    expect(email.html).toContain('https://app.example.com/portal/review/abc')
    expect(email.html).toContain('Version 2')
  })
})

describe('decisionEmail', () => {
  it('approved variant has no note section when note is empty', () => {
    const email = decisionEmail({
      projectName: 'Cloud Survey', version: 1, decision: 'approved', note: null,
    })
    expect(email.subject).toMatch(/approved/i)
    expect(email.html).not.toContain('Reviewer note')
  })

  it('rejected variant includes the reviewer note', () => {
    const email = decisionEmail({
      projectName: 'Cloud Survey', version: 1, decision: 'rejected', note: 'Q5 must go',
    })
    expect(email.subject).toMatch(/rejected/i)
    expect(email.html).toContain('Q5 must go')
  })

  it('escapes HTML in user-supplied note', () => {
    const email = decisionEmail({
      projectName: 'X', version: 1, decision: 'rejected', note: '<script>alert(1)</script>',
    })
    expect(email.html).not.toContain('<script>')
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run __tests__/lib/email/templates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/email/templates.ts`**

```ts
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const wrap = (body: string) => `
<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a2e;">
  <p style="font-size: 13px; color: #888; margin-bottom: 24px;">AlphaRoc Survey Compliance</p>
  ${body}
  <p style="font-size: 12px; color: #aaa; margin-top: 32px;">This is an automated notification from the AlphaRoc survey compliance system.</p>
</div>`

export function submissionCreatedEmail(args: {
  projectName: string
  version: number
  questionCount: number
  openTextCount: number
  reviewUrl: string
}): { subject: string; html: string } {
  return {
    subject: `Questions ready for compliance review — ${args.projectName}`,
    html: wrap(`
      <h2 style="font-size: 18px;">Question list submitted for your review</h2>
      <p>AlphaRoc has submitted <strong>Version ${args.version}</strong> of the question list for
      <strong>${esc(args.projectName)}</strong>.</p>
      <p>${args.questionCount} questions total, including ${args.openTextCount} open-text.</p>
      <p style="margin: 28px 0;">
        <a href="${args.reviewUrl}" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Review questions</a>
      </p>
      <p style="font-size: 13px; color: #666;">Or copy this link: ${args.reviewUrl}</p>
    `),
  }
}

export function decisionEmail(args: {
  projectName: string
  version: number
  decision: 'approved' | 'rejected'
  note: string | null
}): { subject: string; html: string } {
  const verb = args.decision === 'approved' ? 'approved' : 'rejected'
  const noteBlock = args.note
    ? `<p style="background: #f4f4f5; padding: 12px 16px; border-radius: 8px;"><strong>Reviewer note:</strong><br/>${esc(args.note)}</p>`
    : ''
  return {
    subject: `Compliance ${verb}: ${args.projectName} (v${args.version})`,
    html: wrap(`
      <h2 style="font-size: 18px;">Question list ${verb}</h2>
      <p>Client compliance has <strong>${verb}</strong> Version ${args.version} of the question list for
      <strong>${esc(args.projectName)}</strong>.</p>
      ${noteBlock}
      ${args.decision === 'rejected' ? '<p>Revise the questions and submit a new version from the project page.</p>' : '<p>The survey is cleared to launch.</p>'}
    `),
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run __tests__/lib/email/templates.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Implement `lib/email/send.ts`** (Resend + notification_log; failures logged, never thrown)

```ts
import 'server-only'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'

export type SendArgs = {
  to: string
  subject: string
  html: string
  template: string
  submissionId: string | null
}

// Sends one email and logs it. Returns false on failure — callers proceed
// regardless (a failed notification must never block a submission/decision).
export async function sendAndLog(args: SendArgs): Promise<boolean> {
  const admin = createAdminClient()
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to: args.to,
      subject: args.subject,
      html: args.html,
    })
    await admin.from('notification_log').insert({
      submission_id: args.submissionId,
      recipient_email: args.to,
      template: args.template,
      resend_id: error ? null : data?.id ?? null,
    })
    return !error
  } catch {
    await admin.from('notification_log').insert({
      submission_id: args.submissionId,
      recipient_email: args.to,
      template: `${args.template}:failed`,
    })
    return false
  }
}
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add lib/email/templates.ts lib/email/send.ts __tests__/lib/email/templates.test.ts
git commit -m "feat: Resend email templates and logged sender"
```

---

### Task 11: Parse API route

**Files:**
- Create: `app/api/parse-questionnaire/route.ts`

- [ ] **Step 1: Implement the route** — accepts multipart upload, verifies the caller is an analyst, stores the file, extracts, parses with Claude, returns the draft.

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractText, kindFromFilename } from '@/lib/parsing/extract-text'
import { parseQuestionnaire, type ParseInput } from '@/lib/parsing/claude-parser'

export const maxDuration = 120 // Claude parsing of long questionnaires takes time

async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function POST(request: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const projectId = formData.get('projectId') as string | null
  if (!file || !projectId) {
    return NextResponse.json({ error: 'file and projectId are required' }, { status: 400 })
  }

  const kind = kindFromFilename(file.name)
  if (kind === 'unsupported') {
    return NextResponse.json(
      { error: 'Unsupported file type. Use .docx, .xlsx, .csv, or .pdf (export Google Docs first).' },
      { status: 400 }
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // Store the source file (service role; bucket is private)
  const admin = createAdminClient()
  const path = `${projectId}/${Date.now()}-${file.name.replace(/[^\w.\- ]/g, '_')}`
  const { error: uploadError } = await admin.storage
    .from('questionnaires')
    .upload(path, buffer, { contentType: file.type || 'application/octet-stream' })
  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
  }

  // Extract + parse
  try {
    const input: ParseInput =
      kind === 'pdf'
        ? { kind: 'pdf', base64: buffer.toString('base64') }
        : { kind: 'text', text: await extractText(buffer, file.name) }

    const result = await parseQuestionnaire(input)
    if (!result.ok && result.questions.length === 0) {
      return NextResponse.json(
        { error: result.errors.join('; '), sourceFilePath: path, sourceFileName: file.name },
        { status: 422 }
      )
    }
    return NextResponse.json({
      questions: result.questions,
      warnings: result.errors,
      sourceFilePath: path,
      sourceFileName: file.name,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Parse failed'
    return NextResponse.json(
      { error: message, sourceFilePath: path, sourceFileName: file.name },
      { status: 422 }
    )
  }
}
```

Note the 422 responses still return `sourceFilePath` — the UI lets the analyst fall back to manual question entry against the already-uploaded file.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add app/api/parse-questionnaire/route.ts
git commit -m "feat: questionnaire upload + parse API route"
```

---

### Task 12: Submission creation API route

**Files:**
- Create: `app/api/submissions/route.ts`

- [ ] **Step 1: Implement the route** — creates the versioned submission + questions, emails compliance recipients.

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeQuestions, type DraftQuestion } from '@/lib/parsing/validate'
import { submissionCreatedEmail } from '@/lib/email/templates'
import { sendAndLog } from '@/lib/email/send'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'analyst') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as {
    projectId: string
    sourceFileName: string
    sourceFilePath: string
    questions: DraftQuestion[]
  }
  if (!body.projectId || !body.sourceFileName || !body.sourceFilePath) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const result = normalizeQuestions(body.questions)
  if (!result.ok) {
    return NextResponse.json({ error: result.errors.join('; ') }, { status: 400 })
  }

  const admin = createAdminClient()

  // Next version number
  const { data: latest } = await admin
    .from('question_submissions')
    .select('version')
    .eq('project_id', body.projectId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const version = (latest?.version ?? 0) + 1

  const { data: submission, error: subError } = await admin
    .from('question_submissions')
    .insert({
      project_id: body.projectId,
      version,
      source_file_name: body.sourceFileName,
      source_file_path: body.sourceFilePath,
      submitted_by: user.id,
    })
    .select()
    .single()
  if (subError || !submission) {
    return NextResponse.json({ error: subError?.message ?? 'Insert failed' }, { status: 500 })
  }

  const { error: qError } = await admin.from('questions').insert(
    result.questions.map(q => ({
      submission_id: submission.id,
      order_num: q.order_num,
      text: q.text,
      type: q.type,
      is_open_text: q.is_open_text,
      is_ai_followup: q.is_ai_followup,
      section: q.section,
      answer_options: q.answer_options,
    }))
  )
  if (qError) {
    await admin.from('question_submissions').delete().eq('id', submission.id)
    return NextResponse.json({ error: qError.message }, { status: 500 })
  }

  // Notify compliance recipients
  const { data: project } = await admin
    .from('survey_projects').select('project_name').eq('id', body.projectId).single()
  const { data: recipients } = await admin
    .from('project_recipients')
    .select('email')
    .eq('project_id', body.projectId)
    .eq('role', 'compliance')

  const openTextCount = result.questions.filter(q => q.is_open_text).length
  const email = submissionCreatedEmail({
    projectName: project?.project_name ?? 'Survey project',
    version,
    questionCount: result.questions.length,
    openTextCount,
    reviewUrl: `${process.env.NEXT_PUBLIC_APP_URL}/portal/review/${submission.id}`,
  })

  let emailFailures = 0
  for (const r of recipients ?? []) {
    const ok = await sendAndLog({
      to: r.email, subject: email.subject, html: email.html,
      template: 'submission_created', submissionId: submission.id,
    })
    if (!ok) emailFailures++
  }

  return NextResponse.json({
    submissionId: submission.id,
    version,
    notified: (recipients?.length ?? 0) - emailFailures,
    emailFailures,
  })
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add app/api/submissions/route.ts
git commit -m "feat: versioned submission creation with compliance notification"
```

---

### Task 13: Decision API route + recipients API route

**Files:**
- Create: `app/api/submissions/[id]/decision/route.ts`
- Create: `app/api/projects/[id]/recipients/route.ts`

- [ ] **Step 1: Implement the decision route.** The UPDATE runs with the **user-scoped** client so RLS enforces compliance role + client match + pending status. Emails go to AlphaRoc recipients afterward via service role.

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decisionEmail } from '@/lib/email/templates'
import { sendAndLog } from '@/lib/email/send'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { decision: 'approved' | 'rejected'; note?: string }
  if (body.decision !== 'approved' && body.decision !== 'rejected') {
    return NextResponse.json({ error: 'decision must be approved or rejected' }, { status: 400 })
  }
  if (body.decision === 'rejected' && !body.note?.trim()) {
    return NextResponse.json({ error: 'A note is required when rejecting' }, { status: 400 })
  }

  // User-scoped update: RLS allows this only for compliance users of the
  // project's client while status is pending_review.
  const { data: updated, error } = await supabase
    .from('question_submissions')
    .update({
      status: body.decision,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_note: body.note?.trim() || null,
    })
    .eq('id', id)
    .select('id, project_id, version')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json(
      { error: 'Submission not found, already decided, or not yours to review' },
      { status: 403 }
    )
  }

  // Notify AlphaRoc recipients (service role)
  const admin = createAdminClient()
  const { data: project } = await admin
    .from('survey_projects').select('project_name').eq('id', updated.project_id).single()
  const { data: recipients } = await admin
    .from('project_recipients')
    .select('email')
    .eq('project_id', updated.project_id)
    .eq('role', 'alpharoc')

  const email = decisionEmail({
    projectName: project?.project_name ?? 'Survey project',
    version: updated.version,
    decision: body.decision,
    note: body.note?.trim() || null,
  })
  for (const r of recipients ?? []) {
    await sendAndLog({
      to: r.email, subject: email.subject, html: email.html,
      template: `decision_${body.decision}`, submissionId: id,
    })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Implement the recipients route** — POST adds a recipient (provisioning a compliance auth user + profile when needed), DELETE removes one.

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  if (!(await requireAnalyst())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { email: string; name?: string; role: 'alpharoc' | 'compliance' }
  const email = body.email?.trim().toLowerCase()
  if (!email || !['alpharoc', 'compliance'].includes(body.role)) {
    return NextResponse.json({ error: 'email and valid role required' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (body.role === 'compliance') {
    // Provision portal access: auth user + compliance profile scoped to the project's client
    const { data: project } = await admin
      .from('survey_projects').select('client_id').eq('id', projectId).single()
    if (!project?.client_id) {
      return NextResponse.json(
        { error: 'Project has no client assigned — set the client first' },
        { status: 400 }
      )
    }

    const { data: existingProfile } = await admin
      .from('profiles').select('id, role, client_id').eq('email', email).maybeSingle()

    if (existingProfile) {
      if (existingProfile.role !== 'compliance') {
        return NextResponse.json(
          { error: 'That email belongs to an internal analyst account' }, { status: 400 })
      }
      if (existingProfile.client_id !== project.client_id) {
        return NextResponse.json(
          { error: 'That compliance user belongs to a different client' }, { status: 400 })
      }
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, email_confirm: true,
      })
      if (createError || !created.user) {
        return NextResponse.json(
          { error: createError?.message ?? 'Could not create portal user' }, { status: 500 })
      }
      const { error: profileError } = await admin.from('profiles').insert({
        id: created.user.id, email, full_name: body.name ?? null,
        role: 'compliance', client_id: project.client_id,
      })
      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 500 })
      }
    }
  }

  const { data: recipient, error } = await admin
    .from('project_recipients')
    .insert({ project_id: projectId, email, name: body.name ?? null, role: body.role })
    .select()
    .single()
  if (error) {
    const friendly = error.code === '23505' ? 'Already a recipient on this project' : error.message
    return NextResponse.json({ error: friendly }, { status: 400 })
  }
  return NextResponse.json({ recipient })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  if (!(await requireAnalyst())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { recipientId } = await request.json() as { recipientId: string }
  const admin = createAdminClient()
  const { error } = await admin
    .from('project_recipients')
    .delete()
    .eq('id', recipientId)
    .eq('project_id', projectId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add "app/api/submissions/[id]/decision/route.ts" "app/api/projects/[id]/recipients/route.ts"
git commit -m "feat: decision and recipient management API routes"
```

---

### Task 14: Auth callback + portal login + portal layouts

**Files:**
- Create: `app/auth/callback/route.ts`
- Create: `app/(portal)/layout.tsx`
- Create: `app/(portal)/portal/login/page.tsx`
- Create: `app/(portal)/portal/login/portal-login-form.tsx`
- Create: `app/(portal)/portal/(protected)/layout.tsx`

- [ ] **Step 1: Create `app/auth/callback/route.ts`** (magic-link code exchange)

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/portal'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Only allow same-origin relative redirects
      const safeNext = next.startsWith('/') ? next : '/portal'
      return NextResponse.redirect(`${origin}${safeNext}`)
    }
  }
  return NextResponse.redirect(`${origin}/portal/login?error=link`)
}
```

- [ ] **Step 2: Create `app/(portal)/layout.tsx`** (visual shell only — no auth, so the login page can live inside)

```tsx
export const dynamic = 'force-dynamic'

export default function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="border-b border-slate-800 px-6 py-3 flex items-center gap-3">
        <span className="font-bold text-white text-sm">AlphaRoc</span>
        <span className="text-slate-600 text-sm">/</span>
        <span className="text-slate-400 text-sm">Compliance Portal</span>
      </nav>
      <main className="p-6 max-w-4xl mx-auto">{children}</main>
    </div>
  )
}
```

- [ ] **Step 3: Create `app/(portal)/portal/(protected)/layout.tsx`** (auth + role gate)

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function ProtectedPortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/portal/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'compliance') redirect('/')

  return <>{children}</>
}
```

- [ ] **Step 4: Create the portal login page**

`app/(portal)/portal/login/page.tsx`:

```tsx
import { Suspense } from 'react'
import PortalLoginForm from './portal-login-form'

export default function PortalLoginPage() {
  return (
    <div className="flex justify-center pt-16">
      <Suspense>
        <PortalLoginForm />
      </Suspense>
    </div>
  )
}
```

`app/(portal)/portal/login/portal-login-form.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function PortalLoginForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/portal'
  const linkError = searchParams.get('error')

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    setLoading(false)
    if (error) {
      setError(
        error.message.includes('Signups not allowed')
          ? 'This email is not registered for portal access. Contact your AlphaRoc representative.'
          : error.message
      )
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm p-8 bg-slate-900 rounded-xl border border-slate-800 text-center">
        <h1 className="text-lg font-bold text-white mb-2">Check your email</h1>
        <p className="text-sm text-slate-400">
          We sent a sign-in link to <span className="text-slate-200">{email}</span>.
          Click it to access the compliance portal.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm p-8 bg-slate-900 rounded-xl border border-slate-800">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Compliance Portal</h1>
        <p className="text-sm text-slate-400 mt-1">
          Enter your email and we&apos;ll send you a sign-in link.
        </p>
      </div>
      {linkError && (
        <p className="text-amber-400 text-sm bg-amber-400/10 px-3 py-2 rounded-lg mb-4">
          That sign-in link expired or was already used. Request a new one below.
        </p>
      )}
      <form onSubmit={handleSendLink} className="flex flex-col gap-4">
        <Input
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
        />
        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
        )}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Sending...' : 'Send sign-in link'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: success; routes `/portal/login` and `/auth/callback` appear in the route list.

- [ ] **Step 6: Commit**

```bash
git add app/auth "app/(portal)"
git commit -m "feat: portal shell, magic-link login, and auth callback"
```

---

### Task 15: Portal queue page

**Files:**
- Create: `app/(portal)/portal/(protected)/page.tsx`

- [ ] **Step 1: Implement the queue page** (server component; RLS scopes everything)

```tsx
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, string> = {
  pending_review: 'bg-amber-500/20 text-amber-400',
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
}
const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
}

export default async function PortalQueuePage() {
  const supabase = await createClient()

  const { data: submissions } = await supabase
    .from('question_submissions')
    .select('id, project_id, version, status, submitted_at')
    .order('submitted_at', { ascending: false })

  const projectIds = [...new Set((submissions ?? []).map(s => s.project_id))]
  const { data: projects } = projectIds.length
    ? await supabase.from('portal_projects').select('id, project_name').in('id', projectIds)
    : { data: [] }
  const nameById = new Map((projects ?? []).map(p => [p.id, p.project_name]))

  const pending = (submissions ?? []).filter(s => s.status === 'pending_review')
  const decided = (submissions ?? []).filter(s => s.status !== 'pending_review')

  function Row({ s }: { s: NonNullable<typeof submissions>[number] }) {
    return (
      <Link
        href={`/portal/review/${s.id}`}
        className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 hover:border-slate-600 transition-colors"
      >
        <div>
          <p className="text-sm text-white font-medium">{nameById.get(s.project_id) ?? 'Survey project'}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Version {s.version} · submitted {new Date(s.submitted_at).toLocaleDateString()}
          </p>
        </div>
        <span className={`text-xs px-2 py-1 rounded ${STATUS_BADGE[s.status]}`}>
          {STATUS_LABEL[s.status]}
        </span>
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-xs text-slate-400 uppercase tracking-widest mb-3 font-medium">
          Awaiting your review
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting for review right now.</p>
        ) : (
          <div className="flex flex-col gap-2">{pending.map(s => <Row key={s.id} s={s} />)}</div>
        )}
      </section>
      <section>
        <h2 className="text-xs text-slate-400 uppercase tracking-widest mb-3 font-medium">
          History
        </h2>
        {decided.length === 0 ? (
          <p className="text-sm text-slate-500">No completed reviews yet.</p>
        ) : (
          <div className="flex flex-col gap-2">{decided.map(s => <Row key={s.id} s={s} />)}</div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add "app/(portal)/portal/(protected)/page.tsx"
git commit -m "feat: portal review queue and history page"
```

---

### Task 16: Portal review page with open-text filter (TDD on the list component)

**Files:**
- Create: `components/portal/QuestionList.tsx`
- Create: `components/portal/ReviewClient.tsx`
- Create: `app/(portal)/portal/(protected)/review/[submissionId]/page.tsx`
- Test: `__tests__/components/portal/QuestionList.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuestionList, type PortalQuestion } from '@/components/portal/QuestionList'

const questions: PortalQuestion[] = [
  { id: '1', order_num: 1, text: 'What is your role?', type: 'single_select', is_open_text: false, is_ai_followup: false, section: 'Screener', answer_options: ['IC', 'Manager'] },
  { id: '2', order_num: 2, text: 'Why did you choose us?', type: 'open_text', is_open_text: true, is_ai_followup: false, section: null, answer_options: [] },
  { id: '3', order_num: 3, text: 'Tell me more about that.', type: 'open_text', is_open_text: true, is_ai_followup: true, section: null, answer_options: [] },
]

describe('QuestionList', () => {
  it('shows all questions by default with counts on the toggle', () => {
    render(<QuestionList questions={questions} />)
    expect(screen.getByText('What is your role?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /all questions \(3\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open-text only \(2\)/i })).toBeInTheDocument()
  })

  it('filters to open-text only when toggled', async () => {
    const user = userEvent.setup()
    render(<QuestionList questions={questions} />)
    await user.click(screen.getByRole('button', { name: /open-text only/i }))
    expect(screen.queryByText('What is your role?')).not.toBeInTheDocument()
    expect(screen.getByText('Why did you choose us?')).toBeInTheDocument()
    expect(screen.getByText('Tell me more about that.')).toBeInTheDocument()
  })

  it('tags AI follow-up questions', () => {
    render(<QuestionList questions={questions} />)
    expect(screen.getByText(/ai follow-up/i)).toBeInTheDocument()
  })

  it('shows section headings', () => {
    render(<QuestionList questions={questions} />)
    expect(screen.getByText('Screener')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run __tests__/components/portal/QuestionList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `components/portal/QuestionList.tsx`**

```tsx
'use client'
import { useState } from 'react'

export type PortalQuestion = {
  id: string
  order_num: number
  text: string
  type: 'open_text' | 'single_select' | 'multi_select' | 'scale' | 'other'
  is_open_text: boolean
  is_ai_followup: boolean
  section: string | null
  answer_options: string[]
}

const TYPE_LABEL: Record<PortalQuestion['type'], string> = {
  open_text: 'Open-text',
  single_select: 'Single-select',
  multi_select: 'Multi-select',
  scale: 'Scale',
  other: 'Other',
}

export function QuestionList({ questions }: { questions: PortalQuestion[] }) {
  const [filter, setFilter] = useState<'all' | 'open'>('all')
  const openCount = questions.filter(q => q.is_open_text).length
  const visible = filter === 'all' ? questions : questions.filter(q => q.is_open_text)

  const toggleClass = (active: boolean) =>
    `text-xs px-3 py-1.5 rounded-lg border transition-colors ${
      active
        ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
        : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
    }`

  let lastSection: string | null = null

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button className={toggleClass(filter === 'all')} onClick={() => setFilter('all')}>
          All questions ({questions.length})
        </button>
        <button className={toggleClass(filter === 'open')} onClick={() => setFilter('open')}>
          Open-text only ({openCount})
        </button>
      </div>
      <div className="flex flex-col">
        {visible.map(q => {
          const showSection = q.section !== null && q.section !== lastSection
          if (q.section !== null) lastSection = q.section
          return (
            <div key={q.id}>
              {showSection && (
                <p className="text-xs text-slate-500 uppercase tracking-widest mt-4 mb-2">
                  {q.section}
                </p>
              )}
              <div className="flex gap-3 py-3 border-b border-slate-800">
                <span className="text-xs text-slate-500 min-w-8 pt-0.5">Q{q.order_num}</span>
                <div className="flex-1">
                  <p className="text-sm text-slate-200">{q.text}</p>
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        q.is_open_text
                          ? 'bg-violet-500/20 text-violet-400'
                          : 'bg-slate-700/40 text-slate-400'
                      }`}
                    >
                      {TYPE_LABEL[q.type]}
                    </span>
                    {q.is_ai_followup && (
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                        AI follow-up
                      </span>
                    )}
                    {q.answer_options.length > 0 && (
                      <span className="text-xs text-slate-500 pt-0.5">
                        {q.answer_options.join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run __tests__/components/portal/QuestionList.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Implement `components/portal/ReviewClient.tsx`** (decision bar + confirm dialog + read-only outcome)

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { QuestionList, type PortalQuestion } from './QuestionList'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  submissionId: string
  status: 'pending_review' | 'approved' | 'rejected'
  reviewNote: string | null
  questions: PortalQuestion[]
}

export function ReviewClient({ submissionId, status, reviewNote, questions }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<'approved' | 'rejected' | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitDecision() {
    if (!confirming) return
    if (confirming === 'rejected' && !note.trim()) {
      setError('Please explain why you are rejecting so AlphaRoc can revise.')
      return
    }
    setBusy(true)
    setError('')
    const res = await fetch(`/api/submissions/${submissionId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: confirming, note: note.trim() || undefined }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Something went wrong — please try again.')
      return
    }
    router.refresh()
  }

  if (status !== 'pending_review') {
    return (
      <div>
        <div
          className={`rounded-xl border px-4 py-3 mb-6 text-sm ${
            status === 'approved'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          You {status === 'approved' ? 'approved' : 'rejected'} this question list.
          {reviewNote && <span className="block mt-1 text-slate-400">Note: {reviewNote}</span>}
        </div>
        <QuestionList questions={questions} />
      </div>
    )
  }

  return (
    <div>
      <QuestionList questions={questions} />

      {confirming ? (
        <div className="sticky bottom-4 mt-6 bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-sm text-white mb-2">
            {confirming === 'approved' ? 'Approve' : 'Reject'} all {questions.length} questions?
          </p>
          <Textarea
            placeholder={confirming === 'rejected' ? 'What needs to change? (required)' : 'Optional note'}
            value={note}
            onChange={e => setNote(e.target.value)}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 mb-3"
          />
          {error && (
            <p className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg mb-3">{error}</p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setConfirming(null); setError('') }} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitDecision} disabled={busy}>
              {busy ? 'Submitting...' : `Confirm ${confirming === 'approved' ? 'approval' : 'rejection'}`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="sticky bottom-4 mt-6 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">Your decision applies to all {questions.length} questions</p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirming('rejected')}
              className="text-xs border border-red-500/40 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              ✕ Reject
            </button>
            <button
              onClick={() => setConfirming('approved')}
              className="text-xs border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              ✓ Approve
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Implement the review page** `app/(portal)/portal/(protected)/review/[submissionId]/page.tsx`

```tsx
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ReviewClient } from '@/components/portal/ReviewClient'
import type { PortalQuestion } from '@/components/portal/QuestionList'

export const dynamic = 'force-dynamic'

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ submissionId: string }>
}) {
  const { submissionId } = await params
  const supabase = await createClient()

  const { data: submission } = await supabase
    .from('question_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle()
  if (!submission) notFound()

  const [{ data: project }, { data: questions }, { data: fileUrl }] = await Promise.all([
    supabase.from('portal_projects').select('project_name').eq('id', submission.project_id).maybeSingle(),
    supabase.from('questions').select('*').eq('submission_id', submissionId).order('order_num'),
    supabase.storage.from('questionnaires').createSignedUrl(submission.source_file_path, 3600),
  ])

  const portalQuestions: PortalQuestion[] = (questions ?? []).map(q => ({
    id: q.id,
    order_num: q.order_num,
    text: q.text,
    type: q.type,
    is_open_text: q.is_open_text,
    is_ai_followup: q.is_ai_followup,
    section: q.section,
    answer_options: Array.isArray(q.answer_options) ? (q.answer_options as string[]) : [],
  }))
  const openTextCount = portalQuestions.filter(q => q.is_open_text).length

  return (
    <div>
      <div className="mb-6">
        <Link href="/portal" className="text-slate-400 hover:text-slate-200 text-sm transition-colors">
          ← Back to queue
        </Link>
        <div className="flex items-start justify-between mt-3 flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold text-white">{project?.project_name ?? 'Survey project'}</h1>
            <p className="text-sm text-slate-400 mt-1">
              Version {submission.version}
              {submission.version > 1 && ' — resubmitted after feedback'} · submitted{' '}
              {new Date(submission.submitted_at).toLocaleDateString()} · {portalQuestions.length} questions
              · {openTextCount} open-text
            </p>
          </div>
          {fileUrl?.signedUrl && (
            <a
              href={fileUrl.signedUrl}
              className="text-xs border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              ↓ Source file
            </a>
          )}
        </div>
      </div>
      <ReviewClient
        submissionId={submission.id}
        status={submission.status}
        reviewNote={submission.review_note}
        questions={portalQuestions}
      />
    </div>
  )
}
```

- [ ] **Step 7: Verify build + full test run**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add components/portal "app/(portal)/portal/(protected)/review" __tests__/components/portal
git commit -m "feat: portal review page with open-text filter and approve/reject"
```

---

### Task 17: Internal hooks + Compliance Review panel

**Files:**
- Create: `lib/hooks/useSubmissions.ts`
- Create: `components/compliance/RecipientsManager.tsx`
- Create: `components/compliance/QuestionPreviewEditor.tsx`
- Create: `components/compliance/SubmitQuestionsModal.tsx`
- Create: `components/compliance/CompliancePanel.tsx`
- Modify: `app/(app)/projects/[id]/page.tsx`

- [ ] **Step 1: Create `lib/hooks/useSubmissions.ts`**

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type Submission = Database['public']['Tables']['question_submissions']['Row']
export type Recipient = Database['public']['Tables']['project_recipients']['Row']

export function useSubmissions(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['submissions', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('question_submissions')
        .select('*')
        .eq('project_id', projectId)
        .order('version', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

// Latest submission status per project, for board/list badges
export function useLatestSubmissionStatuses() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['submission-statuses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('question_submissions')
        .select('project_id, version, status')
        .order('version', { ascending: true })
      if (error) throw error
      // Later versions overwrite earlier ones
      const map = new Map<string, Submission['status']>()
      for (const s of data) map.set(s.project_id, s.status)
      return map
    },
  })
}

export function useRecipients(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['recipients', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_recipients')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at')
      if (error) throw error
      return data
    },
  })
}

export function useInvalidateCompliance(projectId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['submissions', projectId] })
    queryClient.invalidateQueries({ queryKey: ['submission-statuses'] })
    queryClient.invalidateQueries({ queryKey: ['recipients', projectId] })
  }
}
```

- [ ] **Step 2: Create `components/compliance/RecipientsManager.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRecipients, useInvalidateCompliance, type Recipient } from '@/lib/hooks/useSubmissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function RecipientsManager({ projectId }: { projectId: string }) {
  const { data: recipients = [] } = useRecipients(projectId)
  const invalidate = useInvalidateCompliance(projectId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'compliance' | 'alpharoc'>('compliance')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function addRecipient(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch(`/api/projects/${projectId}/recipients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Failed to add recipient')
      return
    }
    setEmail('')
    invalidate()
  }

  async function removeRecipient(r: Recipient) {
    await fetch(`/api/projects/${projectId}/recipients`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId: r.id }),
    })
    invalidate()
  }

  function group(role: Recipient['role'], label: string) {
    const list = recipients.filter(r => r.role === role)
    return (
      <div className="mb-3">
        <p className="text-xs text-slate-500 mb-1">{label}</p>
        {list.length === 0 ? (
          <p className="text-xs text-slate-600">None yet</p>
        ) : (
          list.map(r => (
            <div key={r.id} className="flex items-center justify-between text-xs py-1">
              <span className="text-slate-300">{r.email}</span>
              <button
                onClick={() => removeRecipient(r)}
                className="text-slate-600 hover:text-red-400 transition-colors"
                aria-label={`Remove ${r.email}`}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    )
  }

  return (
    <div>
      {group('compliance', 'Client compliance reviewers')}
      {group('alpharoc', 'AlphaRoc notify list')}
      <form onSubmit={addRecipient} className="flex gap-2 mt-2">
        <Input
          type="email"
          placeholder="email@company.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-xs h-8"
        />
        <select
          value={role}
          onChange={e => setRole(e.target.value as 'compliance' | 'alpharoc')}
          className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-md px-2"
        >
          <option value="compliance">Compliance</option>
          <option value="alpharoc">AlphaRoc</option>
        </select>
        <Button type="submit" disabled={busy} className="h-8 text-xs">
          Add
        </Button>
      </form>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Create `components/compliance/QuestionPreviewEditor.tsx`**

```tsx
'use client'
import type { DraftQuestion, QuestionType } from '@/lib/parsing/validate'

const TYPES: { value: QuestionType; label: string }[] = [
  { value: 'open_text', label: 'Open-text' },
  { value: 'single_select', label: 'Single-select' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'scale', label: 'Scale' },
  { value: 'other', label: 'Other' },
]

type Props = {
  questions: DraftQuestion[]
  onChange: (questions: DraftQuestion[]) => void
}

export function QuestionPreviewEditor({ questions, onChange }: Props) {
  function update(i: number, patch: Partial<DraftQuestion>) {
    const next = questions.map((q, idx) => {
      if (idx !== i) return q
      const merged = { ...q, ...patch }
      // Keep domain rules live in the editor too
      if (merged.is_ai_followup || merged.type === 'open_text') merged.is_open_text = true
      return merged
    })
    onChange(next)
  }

  function remove(i: number) {
    onChange(questions.filter((_, idx) => idx !== i).map((q, idx) => ({ ...q, order_num: idx + 1 })))
  }

  function add() {
    onChange([
      ...questions,
      {
        order_num: questions.length + 1,
        text: '',
        section: null,
        type: 'open_text',
        is_open_text: true,
        is_ai_followup: false,
        answer_options: [],
      },
    ])
  }

  return (
    <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
      {questions.map((q, i) => (
        <div key={i} className="bg-slate-800/60 rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <span className="text-xs text-slate-500 pt-2 min-w-7">Q{q.order_num}</span>
            <textarea
              value={q.text}
              onChange={e => update(i, { text: e.target.value })}
              rows={2}
              className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-md px-2 py-1.5 resize-y"
              placeholder="Question text"
            />
            <button
              onClick={() => remove(i)}
              className="text-slate-600 hover:text-red-400 transition-colors pt-2"
              aria-label={`Remove question ${q.order_num}`}
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-3 pl-9 flex-wrap">
            <select
              value={q.type}
              onChange={e => update(i, { type: e.target.value as QuestionType })}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-md px-2 py-1"
            >
              {TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={q.is_open_text}
                disabled={q.is_ai_followup || q.type === 'open_text'}
                onChange={e => update(i, { is_open_text: e.target.checked })}
              />
              Open-text
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={q.is_ai_followup}
                onChange={e => update(i, { is_ai_followup: e.target.checked })}
              />
              AI follow-up
            </label>
          </div>
        </div>
      ))}
      <button
        onClick={add}
        className="text-xs border border-dashed border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 rounded-lg py-2 transition-colors"
      >
        + Add question
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Create `components/compliance/SubmitQuestionsModal.tsx`**

```tsx
'use client'
import { useState } from 'react'
import type { DraftQuestion } from '@/lib/parsing/validate'
import { QuestionPreviewEditor } from './QuestionPreviewEditor'
import { useInvalidateCompliance } from '@/lib/hooks/useSubmissions'
import { Button } from '@/components/ui/button'

type Stage = 'upload' | 'parsing' | 'preview' | 'submitting'

export function SubmitQuestionsModal({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>('upload')
  const [questions, setQuestions] = useState<DraftQuestion[]>([])
  const [sourceFileName, setSourceFileName] = useState('')
  const [sourceFilePath, setSourceFilePath] = useState('')
  const [error, setError] = useState('')
  const invalidate = useInvalidateCompliance(projectId)

  async function handleFile(file: File) {
    setStage('parsing')
    setError('')
    const formData = new FormData()
    formData.append('file', file)
    formData.append('projectId', projectId)
    const res = await fetch('/api/parse-questionnaire', { method: 'POST', body: formData })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Parse failed but file may be stored — allow manual entry fallback
      if (body.sourceFilePath) {
        setSourceFileName(body.sourceFileName)
        setSourceFilePath(body.sourceFilePath)
        setQuestions([])
        setError(`${body.error ?? 'Parse failed'} — you can enter questions manually below.`)
        setStage('preview')
      } else {
        setError(body.error ?? 'Upload failed')
        setStage('upload')
      }
      return
    }
    setQuestions(body.questions)
    setSourceFileName(body.sourceFileName)
    setSourceFilePath(body.sourceFilePath)
    setStage('preview')
  }

  async function handleSubmit() {
    if (questions.length === 0 || questions.some(q => !q.text.trim())) {
      setError('Every question needs text, and at least one question is required.')
      return
    }
    setStage('submitting')
    setError('')
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, sourceFileName, sourceFilePath, questions }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(body.error ?? 'Submission failed')
      setStage('preview')
      return
    }
    if (body.emailFailures > 0) {
      alert(
        `Submission created, but ${body.emailFailures} notification email(s) failed to send. ` +
        'Check the recipient addresses and notification log.'
      )
    }
    invalidate()
    onClose()
  }

  const openCount = questions.filter(q => q.is_open_text).length

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white">Submit questions for compliance review</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200" aria-label="Close">✕</button>
        </div>

        {stage === 'upload' && (
          <div>
            <label className="block border border-dashed border-slate-700 rounded-xl p-10 text-center cursor-pointer hover:border-slate-500 transition-colors">
              <input
                type="file"
                accept=".docx,.doc,.xlsx,.xls,.csv,.pdf"
                className="hidden"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <p className="text-sm text-slate-300">Upload the questionnaire</p>
              <p className="text-xs text-slate-500 mt-1">.docx, .xlsx, .csv, or .pdf — Google Docs: export first</p>
            </label>
            {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          </div>
        )}

        {stage === 'parsing' && (
          <p className="text-sm text-slate-400 py-10 text-center">
            Extracting questions with AI… this can take up to a minute for long questionnaires.
          </p>
        )}

        {(stage === 'preview' || stage === 'submitting') && (
          <div>
            <p className="text-xs text-slate-400 mb-3">
              {questions.length} questions · {openCount} open-text — check the AI&apos;s work, especially
              open-text flags, then send to compliance.
            </p>
            <QuestionPreviewEditor questions={questions} onChange={setQuestions} />
            {error && <p className="text-amber-400 text-sm mt-3">{error}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={onClose} disabled={stage === 'submitting'}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={stage === 'submitting'}>
                {stage === 'submitting' ? 'Sending…' : 'Send to compliance'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create `components/compliance/CompliancePanel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useSubmissions } from '@/lib/hooks/useSubmissions'
import { RecipientsManager } from './RecipientsManager'
import { SubmitQuestionsModal } from './SubmitQuestionsModal'
import { Button } from '@/components/ui/button'

const STATUS_BADGE: Record<string, string> = {
  pending_review: 'bg-amber-500/20 text-amber-400',
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
}
const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
}

export function CompliancePanel({ projectId }: { projectId: string }) {
  const { data: submissions = [] } = useSubmissions(projectId)
  const [modalOpen, setModalOpen] = useState(false)
  const latest = submissions[0]

  return (
    <div className="bg-slate-900 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest font-medium">
          Compliance Review
        </h3>
        {latest && (
          <span className={`text-xs px-2 py-1 rounded ${STATUS_BADGE[latest.status]}`}>
            v{latest.version} · {STATUS_LABEL[latest.status]}
          </span>
        )}
      </div>

      {submissions.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-4">
          {submissions.map(s => (
            <div key={s.id} className="flex items-center justify-between text-xs bg-slate-800/50 rounded-lg px-3 py-2">
              <span className="text-slate-300">
                Version {s.version} · {new Date(s.submitted_at).toLocaleDateString()}
              </span>
              <span className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded ${STATUS_BADGE[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
              </span>
            </div>
          ))}
          {latest?.status === 'rejected' && latest.review_note && (
            <p className="text-xs text-red-400/80 bg-red-400/10 rounded-lg px-3 py-2">
              Reviewer note: {latest.review_note}
            </p>
          )}
        </div>
      )}

      <Button
        onClick={() => setModalOpen(true)}
        disabled={latest?.status === 'pending_review'}
        className="w-full text-xs mb-4"
      >
        {latest?.status === 'pending_review'
          ? 'Awaiting compliance review'
          : latest
            ? 'Submit revised questions'
            : 'Submit questions for review'}
      </Button>

      <div className="border-t border-slate-800 pt-3">
        <RecipientsManager projectId={projectId} />
      </div>

      {modalOpen && <SubmitQuestionsModal projectId={projectId} onClose={() => setModalOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 6: Wire the panel into the project page**

In `app/(app)/projects/[id]/page.tsx`, add the import:

```tsx
import { CompliancePanel } from '@/components/compliance/CompliancePanel'
```

And in the left column, after `<LinkedDocuments ... />`, add:

```tsx
          <CompliancePanel projectId={project.id} />
```

- [ ] **Step 7: Verify build + tests**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add components/compliance lib/hooks/useSubmissions.ts "app/(app)/projects/[id]/page.tsx"
git commit -m "feat: internal compliance panel with upload, preview, and recipients"
```

---

### Task 18: Role redirect for internal app + board/list status badges

**Files:**
- Modify: `app/(app)/layout.tsx`
- Modify: `components/board/ProjectCard.tsx`
- Modify: `components/list/ProjectTable.tsx`

- [ ] **Step 1: Add compliance redirect to `app/(app)/layout.tsx`**

After the existing `if (!user) redirect('/login')`, add:

```tsx
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'compliance') redirect('/portal')
```

- [ ] **Step 2: Add a compliance status badge to `components/board/ProjectCard.tsx`**

Read the file first. Inside the card component, use the statuses hook:

```tsx
import { useLatestSubmissionStatuses } from '@/lib/hooks/useSubmissions'
```

In the component body:

```tsx
  const { data: statuses } = useLatestSubmissionStatuses()
  const complianceStatus = statuses?.get(project.id)
```

Where the card renders its badges/metadata, add (adapting to the card's existing badge markup style):

```tsx
  {complianceStatus && (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${
        complianceStatus === 'approved'
          ? 'bg-emerald-500/20 text-emerald-400'
          : complianceStatus === 'rejected'
            ? 'bg-red-500/20 text-red-400'
            : 'bg-amber-500/20 text-amber-400'
      }`}
    >
      {complianceStatus === 'pending_review' ? 'Compliance ⏳' : complianceStatus === 'approved' ? 'Compliance ✓' : 'Compliance ✕'}
    </span>
  )}
```

- [ ] **Step 3: Same badge in `components/list/ProjectTable.tsx`**

Read the file; add the same hook and badge as a cell/inline element in each row, matching the table's existing cell markup.

- [ ] **Step 4: Check the existing ProjectCard test still passes**

Run: `npm test`
Expected: all pass. If `__tests__/components/board/ProjectCard.test.tsx` fails because the hook needs a QueryClientProvider, wrap the test render in one (the pattern used by other tests) or the component already renders under providers — fix the test wrapper, not the component.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/layout.tsx" components/board/ProjectCard.tsx components/list/ProjectTable.tsx __tests__
git commit -m "feat: role-based redirect and compliance status badges"
```

---

### Task 19: Final verification — full suite, build, manual E2E

- [ ] **Step 1: Full test suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: everything green.

- [ ] **Step 2: Manual E2E walkthrough (local, `npm run dev`)**

Prereqs: migrations 005–008 applied; `.env.local` has `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`, `ANTHROPIC_API_KEY`; Supabase redirect URL `http://localhost:3000/auth/callback` configured; a test project exists with a `client_id`.

1. **Analyst**: log in, open a project → Compliance Review panel renders.
2. Add yourself (a personal email you control) as a `compliance` recipient → row appears; check `profiles` table has a compliance row with the project's client_id.
3. Add another address you control as `alpharoc` recipient.
4. Submit questions: upload a real questionnaire (.docx or .xlsx) → preview shows parsed questions → toggle one open-text flag → Send.
5. Check: submission row v1 `pending_review`; questions in DB; compliance email received with review link.
6. **Compliance**: open the review link in a private/incognito window → redirected to `/portal/login` → enter the compliance email → receive Supabase magic link → click it (same browser window) → land on the review page.
7. Verify: question list renders, open-text filter works, source file downloads, the analyst's other projects are NOT visible at `/portal` (only this client's).
8. Reject with a note → page shows read-only rejected state → AlphaRoc recipient gets the rejection email with the note.
9. **Analyst**: project page shows v1 rejected + note; submit a revised v2.
10. **Compliance**: new email; approve v2 → AlphaRoc email "approved" arrives; portal history shows both versions.
11. **Security spot-checks**: as the compliance user, try `GET /` → redirected to portal. In browser devtools as compliance, run a Supabase select on `survey_projects` → returns no rows (RLS); select on `portal_projects` returns only safe columns.

- [ ] **Step 3: Fix anything the walkthrough surfaces, then commit any fixes**

```bash
git add -A && git commit -m "fix: E2E walkthrough fixes for compliance portal"
```

- [ ] **Step 4: Deploy**

Add the new env vars (`RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL=https://<prod-domain>`) in Vercel project settings; add the prod callback URL in Supabase redirect URLs; push to main and verify the Vercel build.

---

## Out of scope (phase 2 — per spec)

- Results/answers review wave
- Survey-tool API question ingestion
- Per-question comments
- Custom SMTP for Supabase magic-link emails (default Supabase mailer is fine for v1; note its ~2 emails/hour/address rate limit when testing)
