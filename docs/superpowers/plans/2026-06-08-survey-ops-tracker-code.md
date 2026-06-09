# Survey Ops Tracker — Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack survey operations tracker with Next.js + Supabase + Vercel, replacing a manual Google Sheets workflow.

**Architecture:** Next.js 14 (App Router) frontend + API routes, Supabase for database/auth, Vercel for hosting, Make.com for external automations.

**Tech Stack:** Next.js 14, TypeScript, Supabase, Tailwind CSS, shadcn/ui, @hello-pangea/dnd, TanStack Query, Vitest, React Testing Library, Vercel

**Spec:** `docs/superpowers/specs/2026-06-08-survey-ops-tracker-design.md`

---

## File Structure

```
survey-ops-tracker/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx           # Login page
│   │   └── layout.tsx               # Auth layout (no nav)
│   ├── (app)/
│   │   ├── layout.tsx               # Main app layout (nav, view toggle, AI widget)
│   │   ├── page.tsx                 # Board view (default landing)
│   │   ├── list/page.tsx            # List/table view
│   │   └── projects/[id]/page.tsx   # Project detail page
│   ├── api/
│   │   ├── ai/route.ts              # AI assistant (Claude API)
│   │   └── webhooks/
│   │       └── n-collected/route.ts # Survey tool N Collected sync
│   └── layout.tsx                   # Root layout
├── components/
│   ├── board/
│   │   ├── Board.tsx                # Kanban board with DnD
│   │   ├── BoardColumn.tsx          # Single stage column
│   │   ├── ProjectCard.tsx          # Card with all display fields
│   │   └── BoardFilters.tsx         # Captain/Type/Client/Overdue filters
│   ├── list/
│   │   ├── ProjectTable.tsx         # Sortable/filterable table
│   │   └── InlineEditCell.tsx       # Inline editing for table cells
│   ├── project/
│   │   ├── ProjectDetail.tsx        # Full project page layout
│   │   ├── PipelineProgress.tsx     # Stage checkbox strip
│   │   ├── LatestNextSteps.tsx      # Notes with auto-stamp
│   │   └── LinkedDocuments.tsx      # URL list + add input
│   ├── scoping/
│   │   ├── ScopingBoard.tsx         # Scoping phase columns
│   │   └── ApproveButton.tsx        # Approve → Active pipeline action
│   ├── ai/
│   │   └── AIAssistant.tsx          # Floating chat panel
│   └── shared/
│       ├── ViewToggle.tsx           # Operations / Full View toggle
│       ├── InfoTooltip.tsx          # ⓘ hover tooltip
│       └── NProgressBar.tsx         # N Collected / N Target bar
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # Browser Supabase client
│   │   ├── server.ts                # Server Supabase client
│   │   └── types.ts                 # Generated DB types
│   ├── hooks/
│   │   ├── useProjects.ts           # Projects query + mutations
│   │   ├── useTeamMembers.ts        # Team members query
│   │   └── useViewMode.ts           # Operations/Full view state
│   └── utils/
│       ├── stage.ts                 # Current stage derivation logic
│       └── date.ts                  # Date formatting + overdue checks
├── supabase/
│   └── migrations/
│       ├── 001_team_members.sql
│       ├── 002_survey_projects.sql
│       └── 003_rls_policies.sql
└── __tests__/
    ├── lib/utils/stage.test.ts
    ├── lib/utils/date.test.ts
    └── components/board/ProjectCard.test.tsx
```

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`
- Create: `.env.local.example`
- Create: `vitest.config.ts`

- [ ] **Step 1: Scaffold Next.js app**

  ```bash
  npx create-next-app@latest survey-ops-tracker \
    --typescript \
    --tailwind \
    --app \
    --src-dir=false \
    --import-alias="@/*"
  cd survey-ops-tracker
  ```

- [ ] **Step 2: Install dependencies**

  ```bash
  npm install @supabase/supabase-js @supabase/ssr \
    @hello-pangea/dnd \
    @tanstack/react-query \
    @anthropic-ai/sdk \
    lucide-react \
    clsx tailwind-merge \
    date-fns

  npm install -D vitest @vitejs/plugin-react \
    @testing-library/react @testing-library/jest-dom \
    @testing-library/user-event \
    jsdom
  ```

- [ ] **Step 3: Install shadcn/ui**

  ```bash
  npx shadcn@latest init
  # Choose: Default style, Slate base color, CSS variables: yes
  npx shadcn@latest add button input textarea badge tooltip select
  ```

- [ ] **Step 4: Configure Vitest**

  Create `vitest.config.ts`:
  ```typescript
  import { defineConfig } from 'vitest/config'
  import react from '@vitejs/plugin-react'
  import path from 'path'

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      globals: true,
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },
  })
  ```

  Create `vitest.setup.ts`:
  ```typescript
  import '@testing-library/jest-dom'
  ```

- [ ] **Step 5: Create .env.local.example**

  ```bash
  NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  ANTHROPIC_API_KEY=your-anthropic-api-key
  WEBHOOK_SECRET=your-webhook-secret
  ```

- [ ] **Step 6: Run tests to confirm setup**

  Create `__tests__/setup.test.ts`:
  ```typescript
  describe('project setup', () => {
    it('runs tests', () => {
      expect(true).toBe(true)
    })
  })
  ```

  ```bash
  npm run test
  ```
  Expected: PASS

- [ ] **Step 7: Commit**

  ```bash
  git add -A
  git commit -m "chore: scaffold Next.js app with Supabase, shadcn, Vitest"
  ```

---

## Task 2: Supabase Project & Database Schema

**Files:**
- Create: `supabase/migrations/001_team_members.sql`
- Create: `supabase/migrations/002_survey_projects.sql`
- Create: `supabase/migrations/003_rls_policies.sql`
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/types.ts`

- [ ] **Step 1: Create Supabase project**

  Go to [supabase.com](https://supabase.com) → New project → Name: `survey-ops-tracker` → save your database password.

  Copy from Project Settings → API:
  - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
  - anon public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - service_role key → `SUPABASE_SERVICE_ROLE_KEY`

  Add all three to `.env.local`.

- [ ] **Step 2: Write team_members migration**

  Create `supabase/migrations/001_team_members.sql`:
  ```sql
  create table public.team_members (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    initials text not null,
    email text not null unique,
    created_at timestamptz default now()
  );
  ```

- [ ] **Step 3: Write survey_projects migration**

  Create `supabase/migrations/002_survey_projects.sql`:
  ```sql
  create type public.project_type as enum ('PS', 'B2B', 'Rerun');
  create type public.project_status as enum ('Open', 'Closed');
  create type public.project_phase as enum ('Scoping', 'Active');
  create type public.board_column as enum (
    'Submitted', 'Doc Programming', 'Survey Programming',
    'EdWin QA', 'Fielding', 'Data QA', 'Delivery'
  );
  create type public.scoping_stage as enum (
    'New Inquiry', 'Proposal Sent', 'Pricing Discussion',
    'Awaiting Approval', 'Closed'
  );

  create table public.survey_projects (
    id uuid primary key default gen_random_uuid(),
    project_name text not null,
    client text not null,
    type public.project_type,
    captain_id uuid references public.team_members(id),
    phase public.project_phase not null default 'Scoping',
    status public.project_status not null default 'Open',
    scoping_stage public.scoping_stage default 'New Inquiry',
    submitted_date date,
    launch_date date,
    due_date date,
    deliver_date date,
    n_target integer,
    n_collected integer default 0,
    n_last_synced timestamptz,
    audience_size integer,
    row_level_data boolean default false,
    terminations boolean default false,
    stage_doc_programming boolean default false,
    stage_survey_programming boolean default false,
    stage_edwin_qa boolean default false,
    stage_fielding boolean default false,
    stage_data_qa boolean default false,
    stage_delivery boolean default false,
    board_column public.board_column not null default 'Submitted',
    latest_next_steps text,
    linked_documents text[] default '{}',
    calendar_event_id text,
    survey_tool_id text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  -- Auto-update updated_at
  create or replace function public.set_updated_at()
  returns trigger as $$
  begin new.updated_at = now(); return new; end;
  $$ language plpgsql;

  create trigger survey_projects_updated_at
    before update on public.survey_projects
    for each row execute function public.set_updated_at();
  ```

- [ ] **Step 4: Write RLS policies**

  Create `supabase/migrations/003_rls_policies.sql`:
  ```sql
  -- Enable RLS
  alter table public.team_members enable row level security;
  alter table public.survey_projects enable row level security;

  -- All authenticated users can read team members
  create policy "authenticated users can read team members"
    on public.team_members for select
    to authenticated using (true);

  -- All authenticated users can read all projects
  create policy "authenticated users can read projects"
    on public.survey_projects for select
    to authenticated using (true);

  -- All authenticated users can insert projects
  create policy "authenticated users can insert projects"
    on public.survey_projects for insert
    to authenticated with check (true);

  -- All authenticated users can update projects
  create policy "authenticated users can update projects"
    on public.survey_projects for update
    to authenticated using (true);

  -- Service role can do everything (for Make.com webhooks)
  create policy "service role full access projects"
    on public.survey_projects for all
    to service_role using (true);
  ```

- [ ] **Step 5: Run migrations in Supabase**

  In Supabase dashboard → SQL Editor → run each migration file in order (001, 002, 003).

- [ ] **Step 6: Create Supabase clients**

  Create `lib/supabase/client.ts`:
  ```typescript
  import { createBrowserClient } from '@supabase/ssr'
  import type { Database } from './types'

  export function createClient() {
    return createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  ```

  Create `lib/supabase/server.ts`:
  ```typescript
  import { createServerClient } from '@supabase/ssr'
  import { cookies } from 'next/headers'
  import type { Database } from './types'

  export async function createClient() {
    const cookieStore = await cookies()
    return createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options))
            } catch {}
          },
        },
      }
    )
  }
  ```

- [ ] **Step 7: Generate and create types**

  Create `lib/supabase/types.ts` with the Database type. Run Supabase type generation:
  ```bash
  npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/supabase/types.ts
  ```
  *(Replace YOUR_PROJECT_ID with your Supabase project ref from the dashboard URL)*

- [ ] **Step 8: Commit**

  ```bash
  git add -A
  git commit -m "feat: add Supabase schema and client setup"
  ```

---

## Task 3: Auth — Login Page & Protected Routes

**Files:**
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/layout.tsx`
- Create: `app/(app)/layout.tsx`
- Create: `middleware.ts`

- [ ] **Step 1: Write failing test for auth redirect**

  Create `__tests__/middleware.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest'

  describe('auth middleware', () => {
    it('redirects unauthenticated users to /login', () => {
      // Middleware logic: if no session and path !== /login, redirect
      const shouldRedirect = (hasSession: boolean, path: string) => {
        if (!hasSession && path !== '/login') return '/login'
        return null
      }
      expect(shouldRedirect(false, '/')).toBe('/login')
      expect(shouldRedirect(true, '/')).toBe(null)
      expect(shouldRedirect(false, '/login')).toBe(null)
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npm run test __tests__/middleware.test.ts
  ```
  Expected: PASS (pure logic test, no imports needed)

- [ ] **Step 3: Create middleware**

  Create `middleware.ts`:
  ```typescript
  import { createServerClient } from '@supabase/ssr'
  import { NextResponse, type NextRequest } from 'next/server'

  export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request })
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options))
          },
        },
      }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user && !request.nextUrl.pathname.startsWith('/login')) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
  }
  ```

- [ ] **Step 4: Create login page**

  Create `app/(auth)/layout.tsx`:
  ```typescript
  export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        {children}
      </div>
    )
  }
  ```

  Create `app/(auth)/login/page.tsx`:
  ```typescript
  'use client'
  import { useState } from 'react'
  import { createClient } from '@/lib/supabase/client'
  import { useRouter } from 'next/navigation'
  import { Button } from '@/components/ui/button'
  import { Input } from '@/components/ui/input'

  export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const supabase = createClient()

    async function handleLogin(e: React.FormEvent) {
      e.preventDefault()
      setLoading(true)
      setError('')
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
      router.push('/')
    }

    return (
      <div className="w-full max-w-sm p-8 bg-slate-900 rounded-xl border border-slate-800">
        <h1 className="text-xl font-bold text-white mb-6">Survey Ops Tracker</h1>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <Input type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} required
            className="bg-slate-800 border-slate-700 text-white" />
          <Input type="password" placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)} required
            className="bg-slate-800 border-slate-700 text-white" />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </div>
    )
  }
  ```

- [ ] **Step 5: Create app layout**

  Create `app/(app)/layout.tsx`:
  ```typescript
  import { createClient } from '@/lib/supabase/server'
  import { redirect } from 'next/navigation'

  export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <nav className="border-b border-slate-800 px-6 py-3 flex items-center gap-4">
          <span className="font-bold text-white">Survey Ops</span>
        </nav>
        <main className="p-6">{children}</main>
      </div>
    )
  }
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add auth login page and protected route middleware"
  ```

---

## Task 4: Stage Logic Utilities

**Files:**
- Create: `lib/utils/stage.ts`
- Create: `lib/utils/date.ts`
- Create: `__tests__/lib/utils/stage.test.ts`
- Create: `__tests__/lib/utils/date.test.ts`

- [ ] **Step 1: Write failing tests for stage derivation**

  Create `__tests__/lib/utils/stage.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest'
  import { deriveCurrentStage, getCheckboxesForColumn } from '@/lib/utils/stage'

  const base = {
    stage_doc_programming: false,
    stage_survey_programming: false,
    stage_edwin_qa: false,
    stage_fielding: false,
    stage_data_qa: false,
    stage_delivery: false,
  }

  describe('deriveCurrentStage', () => {
    it('returns Submitted when no stages checked', () => {
      expect(deriveCurrentStage(base)).toBe('Submitted')
    })
    it('returns Doc Programming when doc checked', () => {
      expect(deriveCurrentStage({ ...base, stage_doc_programming: true }))
        .toBe('Doc Programming')
    })
    it('returns Fielding when doc, survey, qa checked', () => {
      expect(deriveCurrentStage({
        ...base,
        stage_doc_programming: true,
        stage_survey_programming: true,
        stage_edwin_qa: true,
      })).toBe('Fielding')
    })
    it('returns Delivery when all checked', () => {
      expect(deriveCurrentStage({
        ...base,
        stage_doc_programming: true,
        stage_survey_programming: true,
        stage_edwin_qa: true,
        stage_fielding: true,
        stage_data_qa: true,
        stage_delivery: true,
      })).toBe('Delivery')
    })
  })

  describe('getCheckboxesForColumn', () => {
    it('returns all false for Submitted', () => {
      const result = getCheckboxesForColumn('Submitted')
      expect(result.stage_doc_programming).toBe(false)
    })
    it('checks all stages up to and including Fielding', () => {
      const result = getCheckboxesForColumn('Fielding')
      expect(result.stage_doc_programming).toBe(true)
      expect(result.stage_survey_programming).toBe(true)
      expect(result.stage_edwin_qa).toBe(true)
      expect(result.stage_fielding).toBe(false) // Fielding itself = current, not done
      expect(result.stage_data_qa).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  npm run test __tests__/lib/utils/stage.test.ts
  ```
  Expected: FAIL — `deriveCurrentStage` not found

- [ ] **Step 3: Implement stage utilities**

  Create `lib/utils/stage.ts`:
  ```typescript
  export type BoardColumn =
    | 'Submitted' | 'Doc Programming' | 'Survey Programming'
    | 'EdWin QA' | 'Fielding' | 'Data QA' | 'Delivery'

  export const STAGE_ORDER: BoardColumn[] = [
    'Submitted', 'Doc Programming', 'Survey Programming',
    'EdWin QA', 'Fielding', 'Data QA', 'Delivery',
  ]

  type StageFields = {
    stage_doc_programming: boolean
    stage_survey_programming: boolean
    stage_edwin_qa: boolean
    stage_fielding: boolean
    stage_data_qa: boolean
    stage_delivery: boolean
  }

  export function deriveCurrentStage(fields: StageFields): BoardColumn {
    if (!fields.stage_doc_programming) return 'Submitted'
    if (!fields.stage_survey_programming) return 'Doc Programming'
    if (!fields.stage_edwin_qa) return 'Survey Programming'
    if (!fields.stage_fielding) return 'EdWin QA'
    if (!fields.stage_data_qa) return 'Fielding'
    if (!fields.stage_delivery) return 'Data QA'
    return 'Delivery'
  }

  // When dragging to a column, check all stages BEFORE it (not including it)
  export function getCheckboxesForColumn(column: BoardColumn): StageFields {
    const idx = STAGE_ORDER.indexOf(column)
    return {
      stage_doc_programming: idx > 1,
      stage_survey_programming: idx > 2,
      stage_edwin_qa: idx > 3,
      stage_fielding: idx > 4,
      stage_data_qa: idx > 5,
      stage_delivery: false, // Delivery checkbox = project is fully delivered
    }
  }
  ```

- [ ] **Step 4: Write and implement date utilities**

  Create `__tests__/lib/utils/date.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest'
  import { getDueDateStatus } from '@/lib/utils/date'

  describe('getDueDateStatus', () => {
    it('returns overdue for past date', () => {
      expect(getDueDateStatus('2020-01-01')).toBe('overdue')
    })
    it('returns soon for date within 3 days', () => {
      const soon = new Date()
      soon.setDate(soon.getDate() + 2)
      expect(getDueDateStatus(soon.toISOString().split('T')[0])).toBe('soon')
    })
    it('returns normal for future date beyond 3 days', () => {
      const future = new Date()
      future.setDate(future.getDate() + 10)
      expect(getDueDateStatus(future.toISOString().split('T')[0])).toBe('normal')
    })
    it('returns null for no date', () => {
      expect(getDueDateStatus(null)).toBe(null)
    })
  })
  ```

  Create `lib/utils/date.ts`:
  ```typescript
  import { differenceInDays, parseISO, isAfter, startOfDay } from 'date-fns'

  export type DueDateStatus = 'overdue' | 'soon' | 'normal' | null

  export function getDueDateStatus(dueDate: string | null): DueDateStatus {
    if (!dueDate) return null
    const today = startOfDay(new Date())
    const due = startOfDay(parseISO(dueDate))
    if (!isAfter(due, today)) return 'overdue'
    if (differenceInDays(due, today) <= 3) return 'soon'
    return 'normal'
  }

  export function formatDate(date: string | null): string {
    if (!date) return '—'
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  export function autoStamp(userName: string, existing: string | null, newText: string): string {
    const today = new Date().toISOString().split('T')[0]
    const entry = `[${today}] ${userName}: ${newText}`
    return existing ? `${existing}\n${entry}` : entry
  }
  ```

- [ ] **Step 5: Run all tests**

  ```bash
  npm run test
  ```
  Expected: All PASS

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add stage derivation and date utilities with tests"
  ```

---

## Task 5: Data Hooks (useProjects, useTeamMembers)

**Files:**
- Create: `lib/hooks/useProjects.ts`
- Create: `lib/hooks/useTeamMembers.ts`
- Create: `lib/hooks/useViewMode.ts`
- Modify: `app/layout.tsx` (add QueryClientProvider)

- [ ] **Step 1: Add QueryClientProvider to root layout**

  Modify `app/layout.tsx`:
  ```typescript
  'use client'
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import { useState } from 'react'

  // Wrap children in QueryClientProvider
  // (keep existing layout structure, just add provider)
  ```

  Create `app/providers.tsx`:
  ```typescript
  'use client'
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import { useState } from 'react'

  export function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000 } },
    }))
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  ```

  Update `app/layout.tsx` to wrap with `<Providers>`.

- [ ] **Step 2: Create useTeamMembers hook**

  Create `lib/hooks/useTeamMembers.ts`:
  ```typescript
  import { useQuery } from '@tanstack/react-query'
  import { createClient } from '@/lib/supabase/client'

  export function useTeamMembers() {
    const supabase = createClient()
    return useQuery({
      queryKey: ['team-members'],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('team_members')
          .select('*')
          .order('name')
        if (error) throw error
        return data
      },
    })
  }
  ```

- [ ] **Step 3: Create useProjects hook**

  Create `lib/hooks/useProjects.ts`:
  ```typescript
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
  import { createClient } from '@/lib/supabase/client'
  import { getCheckboxesForColumn, type BoardColumn } from '@/lib/utils/stage'
  import { autoStamp } from '@/lib/utils/date'

  export function useProjects() {
    const supabase = createClient()
    return useQuery({
      queryKey: ['projects'],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('survey_projects')
          .select('*, captain:team_members(id, name, initials)')
          .order('created_at', { ascending: false })
        if (error) throw error
        return data
      },
    })
  }

  export function useUpdateProject() {
    const supabase = createClient()
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: async ({ id, updates }: {
        id: string
        updates: Record<string, unknown>
      }) => {
        const { error } = await supabase
          .from('survey_projects')
          .update(updates)
          .eq('id', id)
        if (error) throw error
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    })
  }

  export function useMoveProjectToColumn() {
    const updateProject = useUpdateProject()
    return (id: string, column: BoardColumn) => {
      const checkboxes = getCheckboxesForColumn(column)
      updateProject.mutate({ id, updates: { board_column: column, ...checkboxes } })
    }
  }

  export function useAddProjectUpdate() {
    const updateProject = useUpdateProject()
    return (id: string, currentNotes: string | null, newText: string, userName: string) => {
      const stamped = autoStamp(userName, currentNotes, newText)
      updateProject.mutate({ id, updates: { latest_next_steps: stamped } })
    }
  }

  export function useCreateProject() {
    const supabase = createClient()
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: async (project: Record<string, unknown>) => {
        const { data, error } = await supabase
          .from('survey_projects')
          .insert(project)
          .select()
          .single()
        if (error) throw error
        return data
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    })
  }
  ```

- [ ] **Step 4: Create useViewMode hook**

  Create `lib/hooks/useViewMode.ts`:
  ```typescript
  import { useState } from 'react'

  export type ViewMode = 'operations' | 'full'

  export function useViewMode() {
    const [mode, setMode] = useState<ViewMode>('operations')
    return { mode, setMode, isFullView: mode === 'full' }
  }
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add data hooks for projects and team members"
  ```

---

## Task 6: Shared UI Components

**Files:**
- Create: `components/shared/ViewToggle.tsx`
- Create: `components/shared/InfoTooltip.tsx`
- Create: `components/shared/NProgressBar.tsx`
- Create: `__tests__/components/shared/NProgressBar.test.tsx`

- [ ] **Step 1: Write failing test for NProgressBar**

  Create `__tests__/components/shared/NProgressBar.test.tsx`:
  ```typescript
  import { render, screen } from '@testing-library/react'
  import { NProgressBar } from '@/components/shared/NProgressBar'

  describe('NProgressBar', () => {
    it('shows collected and target', () => {
      render(<NProgressBar collected={300} target={400} />)
      expect(screen.getByText('300 / 400')).toBeInTheDocument()
    })
    it('shows checkmark when target met', () => {
      render(<NProgressBar collected={400} target={400} />)
      expect(screen.getByText('✓')).toBeInTheDocument()
    })
    it('handles null values', () => {
      render(<NProgressBar collected={null} target={400} />)
      expect(screen.getByText('— / 400')).toBeInTheDocument()
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npm run test __tests__/components/shared/NProgressBar.test.tsx
  ```
  Expected: FAIL

- [ ] **Step 3: Implement NProgressBar**

  Create `components/shared/NProgressBar.tsx`:
  ```typescript
  interface NProgressBarProps {
    collected: number | null
    target: number | null
    showLabel?: boolean
  }

  export function NProgressBar({ collected, target, showLabel = true }: NProgressBarProps) {
    const pct = collected && target ? Math.min((collected / target) * 100, 100) : 0
    const met = collected != null && target != null && collected >= target
    return (
      <div className="w-full">
        {showLabel && (
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">N Collected</span>
            <span className={met ? 'text-emerald-400 font-medium' : 'text-slate-300'}>
              {collected != null ? collected : '—'} / {target ?? '—'}
              {met && ' ✓'}
            </span>
          </div>
        )}
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${met ? 'bg-emerald-400' : 'bg-amber-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 4: Implement ViewToggle**

  Create `components/shared/ViewToggle.tsx`:
  ```typescript
  'use client'
  import type { ViewMode } from '@/lib/hooks/useViewMode'

  interface ViewToggleProps {
    mode: ViewMode
    onChange: (mode: ViewMode) => void
  }

  export function ViewToggle({ mode, onChange }: ViewToggleProps) {
    return (
      <div className="inline-flex bg-slate-900 border border-slate-700 rounded-full p-1 gap-1">
        <button
          onClick={() => onChange('operations')}
          className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
            mode === 'operations'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          ⚙ Operations
        </button>
        <button
          onClick={() => onChange('full')}
          className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
            mode === 'full'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          ◉ Full View
        </button>
      </div>
    )
  }
  ```

- [ ] **Step 5: Implement InfoTooltip**

  Create `components/shared/InfoTooltip.tsx`:
  ```typescript
  import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
  import { Info } from 'lucide-react'

  export function InfoTooltip({ text }: { text: string }) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-700 text-slate-400 hover:text-slate-200 text-[10px] ml-1">
              <Info className="w-2.5 h-2.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{text}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  ```

- [ ] **Step 6: Run all tests**

  ```bash
  npm run test
  ```
  Expected: All PASS

- [ ] **Step 7: Commit**

  ```bash
  git add -A
  git commit -m "feat: add shared UI components (ViewToggle, InfoTooltip, NProgressBar)"
  ```

---

## Task 7: Project Card Component

**Files:**
- Create: `components/board/ProjectCard.tsx`
- Create: `__tests__/components/board/ProjectCard.test.tsx`

- [ ] **Step 1: Write failing tests**

  Create `__tests__/components/board/ProjectCard.test.tsx`:
  ```typescript
  import { render, screen } from '@testing-library/react'
  import { ProjectCard } from '@/components/board/ProjectCard'

  const mockProject = {
    id: '1',
    project_name: 'AARP Membership',
    client: 'AARP',
    type: 'PS' as const,
    due_date: '2099-12-31',
    n_collected: 1200,
    n_target: 1350,
    latest_next_steps: 'Waiting on client feedback on survey doc',
    captain: { id: '1', name: 'Anne W', initials: 'AW' },
    terminations: false,
    board_column: 'Survey Programming' as const,
    phase: 'Active' as const,
    status: 'Open' as const,
  }

  describe('ProjectCard', () => {
    it('renders project name and client', () => {
      render(<ProjectCard project={mockProject as any} />)
      expect(screen.getByText('AARP Membership')).toBeInTheDocument()
      expect(screen.getByText('AARP')).toBeInTheDocument()
    })
    it('renders type badge', () => {
      render(<ProjectCard project={mockProject as any} />)
      expect(screen.getByText('PS')).toBeInTheDocument()
    })
    it('renders captain initials', () => {
      render(<ProjectCard project={mockProject as any} />)
      expect(screen.getByText('AW')).toBeInTheDocument()
    })
    it('shows overdue warning for past due date', () => {
      render(<ProjectCard project={{ ...mockProject, due_date: '2020-01-01' } as any} />)
      expect(screen.getByText(/⚠/)).toBeInTheDocument()
    })
    it('truncates latest next steps', () => {
      render(<ProjectCard project={mockProject as any} />)
      expect(screen.getByText(/Waiting on client/)).toBeInTheDocument()
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  npm run test __tests__/components/board/ProjectCard.test.tsx
  ```
  Expected: FAIL

- [ ] **Step 3: Implement ProjectCard**

  Create `components/board/ProjectCard.tsx`:
  ```typescript
  import { getDueDateStatus, formatDate } from '@/lib/utils/date'
  import { NProgressBar } from '@/components/shared/NProgressBar'
  import type { Database } from '@/lib/supabase/types'

  type Project = Database['public']['Tables']['survey_projects']['Row'] & {
    captain: { id: string; name: string; initials: string } | null
  }

  const STAGE_COLORS: Record<string, string> = {
    'Submitted': 'border-l-blue-500',
    'Doc Programming': 'border-l-amber-500',
    'Survey Programming': 'border-l-amber-500',
    'EdWin QA': 'border-l-cyan-500',
    'Fielding': 'border-l-emerald-500',
    'Data QA': 'border-l-violet-500',
    'Delivery': 'border-l-slate-300',
  }

  const TYPE_COLORS: Record<string, string> = {
    'PS': 'bg-blue-500/20 text-blue-400',
    'B2B': 'bg-violet-500/20 text-violet-400',
    'Rerun': 'bg-emerald-500/20 text-emerald-400',
  }

  interface ProjectCardProps {
    project: Project
    onClick?: () => void
  }

  export function ProjectCard({ project, onClick }: ProjectCardProps) {
    const dueDateStatus = getDueDateStatus(project.due_date)
    const borderColor = STAGE_COLORS[project.board_column] ?? 'border-l-slate-500'
    const snippet = project.latest_next_steps
      ? project.latest_next_steps.slice(0, 100) + (project.latest_next_steps.length > 100 ? '…' : '')
      : null

    return (
      <div
        onClick={onClick}
        className={`bg-slate-950 rounded-lg p-3 border-l-4 ${borderColor} cursor-pointer hover:ring-1 hover:ring-slate-600 transition-all`}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="text-slate-100 text-sm font-semibold leading-tight">{project.project_name}</span>
          {project.type && (
            <span className={`text-[10px] px-2 py-0.5 rounded shrink-0 ${TYPE_COLORS[project.type] ?? ''}`}>
              {project.type}
            </span>
          )}
        </div>
        <p className="text-slate-400 text-xs mb-3">{project.client}</p>
        <NProgressBar collected={project.n_collected} target={project.n_target} />
        {snippet && (
          <p className="text-slate-500 text-xs mt-2 leading-relaxed line-clamp-2">{snippet}</p>
        )}
        <div className="flex items-center justify-between mt-3">
          {project.captain ? (
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
              {project.captain.initials}
            </span>
          ) : (
            <span className="text-xs bg-red-900/40 text-red-400 px-2 py-0.5 rounded-full">Unassigned !</span>
          )}
          {project.due_date && (
            <span className={`text-xs ${
              dueDateStatus === 'overdue' ? 'text-red-400' :
              dueDateStatus === 'soon' ? 'text-amber-400' : 'text-slate-400'
            }`}>
              {dueDateStatus === 'overdue' && '⚠ '}{formatDate(project.due_date)}
            </span>
          )}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 4: Run all tests**

  ```bash
  npm run test
  ```
  Expected: All PASS

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add ProjectCard component with tests"
  ```

---

## Task 8: Board View

**Files:**
- Create: `components/board/Board.tsx`
- Create: `components/board/BoardColumn.tsx`
- Create: `components/board/BoardFilters.tsx`
- Modify: `app/(app)/page.tsx`

- [ ] **Step 1: Implement BoardColumn**

  Create `components/board/BoardColumn.tsx`:
  ```typescript
  import { Droppable, Draggable } from '@hello-pangea/dnd'
  import { ProjectCard } from './ProjectCard'
  import { useRouter } from 'next/navigation'

  interface BoardColumnProps {
    id: string
    title: string
    projects: any[]
  }

  export function BoardColumn({ id, title, projects }: BoardColumnProps) {
    const router = useRouter()
    return (
      <div className="bg-slate-900 rounded-xl p-3 min-w-[200px] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400 uppercase tracking-widest font-medium">{title}</span>
          <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">{projects.length}</span>
        </div>
        <Droppable droppableId={id}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`flex flex-col gap-2 min-h-[100px] rounded-lg transition-colors ${
                snapshot.isDraggingOver ? 'bg-slate-800/50' : ''
              }`}
            >
              {projects.map((project, index) => (
                <Draggable key={project.id} draggableId={project.id} index={index}>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                      <ProjectCard
                        project={project}
                        onClick={() => router.push(`/projects/${project.id}`)}
                      />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    )
  }
  ```

- [ ] **Step 2: Implement BoardFilters**

  Create `components/board/BoardFilters.tsx`:
  ```typescript
  'use client'
  interface BoardFiltersProps {
    captains: { id: string; initials: string }[]
    onCaptainChange: (id: string | null) => void
    onTypeChange: (type: string | null) => void
    onOverdueOnly: (v: boolean) => void
    captainFilter: string | null
    typeFilter: string | null
    overdueOnly: boolean
  }

  export function BoardFilters({ captains, onCaptainChange, onTypeChange, onOverdueOnly, captainFilter, typeFilter, overdueOnly }: BoardFiltersProps) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={captainFilter ?? ''}
          onChange={e => onCaptainChange(e.target.value || null)}
          className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1.5"
        >
          <option value="">All Captains</option>
          {captains.map(c => <option key={c.id} value={c.id}>{c.initials}</option>)}
        </select>
        <select
          value={typeFilter ?? ''}
          onChange={e => onTypeChange(e.target.value || null)}
          className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1.5"
        >
          <option value="">All Types</option>
          <option value="PS">PS</option>
          <option value="B2B">B2B</option>
          <option value="Rerun">Rerun</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={overdueOnly} onChange={e => onOverdueOnly(e.target.checked)}
            className="rounded" />
          Overdue only
        </label>
      </div>
    )
  }
  ```

- [ ] **Step 3: Implement Board**

  Create `components/board/Board.tsx`:
  ```typescript
  'use client'
  import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
  import { BoardColumn } from './BoardColumn'
  import { BoardFilters } from './BoardFilters'
  import { useState, useMemo } from 'react'
  import { STAGE_ORDER } from '@/lib/utils/stage'
  import { getDueDateStatus } from '@/lib/utils/date'

  interface BoardProps {
    projects: any[]
    teamMembers: any[]
    onMoveProject: (id: string, column: string) => void
  }

  export function Board({ projects, teamMembers, onMoveProject }: BoardProps) {
    const [captainFilter, setCaptainFilter] = useState<string | null>(null)
    const [typeFilter, setTypeFilter] = useState<string | null>(null)
    const [overdueOnly, setOverdueOnly] = useState(false)

    const filtered = useMemo(() => {
      return projects.filter(p => {
        if (captainFilter && p.captain?.id !== captainFilter) return false
        if (typeFilter && p.type !== typeFilter) return false
        if (overdueOnly && getDueDateStatus(p.due_date) !== 'overdue') return false
        return true
      })
    }, [projects, captainFilter, typeFilter, overdueOnly])

    function handleDragEnd(result: DropResult) {
      if (!result.destination) return
      const newColumn = result.destination.droppableId
      if (newColumn !== result.source.droppableId) {
        onMoveProject(result.draggableId, newColumn)
      }
    }

    return (
      <div className="flex flex-col gap-4">
        <BoardFilters
          captains={teamMembers}
          captainFilter={captainFilter}
          typeFilter={typeFilter}
          overdueOnly={overdueOnly}
          onCaptainChange={setCaptainFilter}
          onTypeChange={setTypeFilter}
          onOverdueOnly={setOverdueOnly}
        />
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {STAGE_ORDER.map(stage => (
              <BoardColumn
                key={stage}
                id={stage}
                title={stage}
                projects={filtered.filter(p => p.board_column === stage)}
              />
            ))}
          </div>
        </DragDropContext>
      </div>
    )
  }
  ```

- [ ] **Step 4: Wire up board page**

  Modify `app/(app)/page.tsx`:
  ```typescript
  'use client'
  import { Board } from '@/components/board/Board'
  import { ViewToggle } from '@/components/shared/ViewToggle'
  import { useProjects, useMoveProjectToColumn } from '@/lib/hooks/useProjects'
  import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
  import { useViewMode } from '@/lib/hooks/useViewMode'
  import Link from 'next/link'

  export default function BoardPage() {
    const { data: projects = [], isLoading } = useProjects()
    const { data: teamMembers = [] } = useTeamMembers()
    const moveProject = useMoveProjectToColumn()
    const { mode, setMode } = useViewMode()

    const activeProjects = projects.filter(p =>
      mode === 'full' ? true : (p.phase === 'Active' && p.status === 'Open')
    )

    if (isLoading) return <div className="text-slate-400">Loading...</div>

    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex bg-slate-800 rounded-lg p-1 gap-1">
              <span className="text-xs bg-slate-700 text-white px-3 py-1 rounded">Board</span>
              <Link href="/list" className="text-xs text-slate-400 px-3 py-1 rounded hover:text-white">List</Link>
            </div>
            <ViewToggle mode={mode} onChange={setMode} />
          </div>
          <button className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg">
            + New Project
          </button>
        </div>
        <Board
          projects={activeProjects}
          teamMembers={teamMembers}
          onMoveProject={moveProject}
        />
      </div>
    )
  }
  ```

- [ ] **Step 5: Run dev server to verify**

  ```bash
  npm run dev
  ```
  Open http://localhost:3000 — you should see the board (empty at first). Login with your Supabase user credentials.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add kanban board view with drag-and-drop"
  ```

---

## Task 9: List View

**Files:**
- Create: `components/list/ProjectTable.tsx`
- Modify: `app/(app)/list/page.tsx`

- [ ] **Step 1: Implement ProjectTable**

  Create `components/list/ProjectTable.tsx`:
  ```typescript
  'use client'
  import { useState } from 'react'
  import { formatDate, getDueDateStatus } from '@/lib/utils/date'
  import { useUpdateProject } from '@/lib/hooks/useProjects'
  import { useRouter } from 'next/navigation'

  type SortField = 'project_name' | 'client' | 'board_column' | 'due_date'

  interface ProjectTableProps {
    projects: any[]
  }

  export function ProjectTable({ projects }: ProjectTableProps) {
    const [sortField, setSortField] = useState<SortField>('due_date')
    const [sortAsc, setSortAsc] = useState(true)
    const updateProject = useUpdateProject()
    const router = useRouter()

    const sorted = [...projects].sort((a, b) => {
      const av = a[sortField] ?? ''
      const bv = b[sortField] ?? ''
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    })

    function toggleSort(field: SortField) {
      if (sortField === field) setSort(field, !sortAsc)
      else { setSortField(field); setSortAsc(true) }
    }
    function setSort(f: SortField, asc: boolean) { setSortField(f); setSortAsc(asc) }

    const TYPE_COLORS: Record<string, string> = {
      PS: 'bg-blue-500/20 text-blue-400',
      B2B: 'bg-violet-500/20 text-violet-400',
      Rerun: 'bg-emerald-500/20 text-emerald-400',
    }

    return (
      <div className="bg-slate-900 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-950 text-xs text-slate-500 uppercase tracking-wider">
              {[
                ['project_name', 'Project'],
                ['client', 'Client'],
                [null, 'Type'],
                ['board_column', 'Stage'],
                [null, 'Captain'],
                [null, 'N / Target'],
                ['due_date', 'Due'],
              ].map(([field, label]) => (
                <th
                  key={label as string}
                  onClick={() => field && toggleSort(field as SortField)}
                  className={`px-4 py-3 text-left ${field ? 'cursor-pointer hover:text-slate-300' : ''}`}
                >
                  {label as string} {field === sortField ? (sortAsc ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => {
              const dueDateStatus = getDueDateStatus(p.due_date)
              return (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className={`border-t border-slate-800 text-sm cursor-pointer hover:bg-slate-800/50 transition-colors ${i % 2 === 1 ? 'bg-slate-900/50' : ''}`}
                >
                  <td className="px-4 py-3 text-slate-100 font-medium">{p.project_name}</td>
                  <td className="px-4 py-3 text-slate-400">{p.client}</td>
                  <td className="px-4 py-3">
                    {p.type && <span className={`text-xs px-2 py-0.5 rounded ${TYPE_COLORS[p.type]}`}>{p.type}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">{p.board_column}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{p.captain?.initials ?? <span className="text-red-400">!</span>}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">
                    {p.n_collected ?? '—'} / {p.n_target ?? '—'}
                  </td>
                  <td className={`px-4 py-3 text-xs ${dueDateStatus === 'overdue' ? 'text-red-400' : dueDateStatus === 'soon' ? 'text-amber-400' : 'text-slate-400'}`}>
                    {dueDateStatus === 'overdue' && '⚠ '}{formatDate(p.due_date)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }
  ```

- [ ] **Step 2: Wire up list page**

  Create `app/(app)/list/page.tsx`:
  ```typescript
  'use client'
  import { ProjectTable } from '@/components/list/ProjectTable'
  import { ViewToggle } from '@/components/shared/ViewToggle'
  import { useProjects } from '@/lib/hooks/useProjects'
  import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
  import { useViewMode } from '@/lib/hooks/useViewMode'
  import Link from 'next/link'

  export default function ListView() {
    const { data: projects = [] } = useProjects()
    const { mode, setMode } = useViewMode()

    const filtered = projects.filter(p =>
      mode === 'full' ? true : (p.phase === 'Active' && p.status === 'Open')
    )

    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-800 rounded-lg p-1 gap-1">
            <Link href="/" className="text-xs text-slate-400 px-3 py-1 rounded hover:text-white">Board</Link>
            <span className="text-xs bg-slate-700 text-white px-3 py-1 rounded">List</span>
          </div>
          <ViewToggle mode={mode} onChange={setMode} />
        </div>
        <ProjectTable projects={filtered} />
      </div>
    )
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add -A
  git commit -m "feat: add list/table view with sorting"
  ```

---

## Task 10: Project Detail Page

**Files:**
- Create: `components/project/PipelineProgress.tsx`
- Create: `components/project/LatestNextSteps.tsx`
- Create: `components/project/LinkedDocuments.tsx`
- Create: `components/project/ProjectDetail.tsx`
- Modify: `app/(app)/projects/[id]/page.tsx`

- [ ] **Step 1: Implement PipelineProgress**

  Create `components/project/PipelineProgress.tsx`:
  ```typescript
  'use client'
  import { STAGE_ORDER } from '@/lib/utils/stage'
  import { useUpdateProject } from '@/lib/hooks/useProjects'

  const STAGE_TO_FIELD: Record<string, string> = {
    'Doc Programming': 'stage_doc_programming',
    'Survey Programming': 'stage_survey_programming',
    'EdWin QA': 'stage_edwin_qa',
    'Fielding': 'stage_fielding',
    'Data QA': 'stage_data_qa',
    'Delivery': 'stage_delivery',
  }

  interface PipelineProgressProps {
    project: any
  }

  export function PipelineProgress({ project }: PipelineProgressProps) {
    const updateProject = useUpdateProject()
    const currentStage = project.board_column

    function toggleStage(stage: string) {
      if (stage === 'Submitted') return
      const field = STAGE_TO_FIELD[stage]
      if (!field) return
      const newValue = !project[field]
      // When checking, also check all prior stages
      const updates: Record<string, boolean> = {}
      let checking = true
      for (const s of STAGE_ORDER.slice(1)) {
        if (s === stage) {
          updates[STAGE_TO_FIELD[s]] = newValue
          checking = false
        } else if (checking && newValue) {
          updates[STAGE_TO_FIELD[s]] = true
        }
      }
      // Derive new board_column
      const allFields = { ...project, ...updates }
      const newColumn = deriveFromUpdates(allFields)
      updateProject.mutate({ id: project.id, updates: { ...updates, board_column: newColumn } })
    }

    function deriveFromUpdates(p: any) {
      if (!p.stage_doc_programming) return 'Submitted'
      if (!p.stage_survey_programming) return 'Doc Programming'
      if (!p.stage_edwin_qa) return 'Survey Programming'
      if (!p.stage_fielding) return 'EdWin QA'
      if (!p.stage_data_qa) return 'Fielding'
      if (!p.stage_delivery) return 'Data QA'
      return 'Delivery'
    }

    return (
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          {STAGE_ORDER.map((stage, i) => {
            const field = STAGE_TO_FIELD[stage]
            const isDone = field ? project[field] : false
            const isCurrent = stage === currentStage
            return (
              <div key={stage} className="flex items-center gap-2">
                <button
                  onClick={() => toggleStage(stage)}
                  disabled={stage === 'Submitted'}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    isDone
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : isCurrent
                      ? 'bg-amber-500/15 border-amber-500/60 text-amber-400'
                      : 'bg-slate-800 border-slate-700 text-slate-500'
                  } ${stage !== 'Submitted' ? 'hover:border-slate-500 cursor-pointer' : 'cursor-default'}`}
                >
                  <span>{isDone ? '✓' : isCurrent ? '▶' : '○'}</span>
                  <span>{stage}</span>
                  {isCurrent && <span className="text-slate-500">(current)</span>}
                </button>
                {i < STAGE_ORDER.length - 1 && (
                  <span className="text-slate-700 text-xs">→</span>
                )}
              </div>
            )
          })}
        </div>
        <p className="text-xs text-slate-600 mt-2">
          Checking a stage advances the project card on the board. Uncheck to move it back.
        </p>
      </div>
    )
  }
  ```

- [ ] **Step 2: Implement LatestNextSteps**

  Create `components/project/LatestNextSteps.tsx`:
  ```typescript
  'use client'
  import { useState } from 'react'
  import { useAddProjectUpdate } from '@/lib/hooks/useProjects'
  import { createClient } from '@/lib/supabase/client'
  import { useQuery } from '@tanstack/react-query'

  interface LatestNextStepsProps {
    projectId: string
    notes: string | null
  }

  export function LatestNextSteps({ projectId, notes }: LatestNextStepsProps) {
    const [newText, setNewText] = useState('')
    const addUpdate = useAddProjectUpdate()
    const supabase = createClient()

    const { data: user } = useQuery({
      queryKey: ['user'],
      queryFn: async () => {
        const { data: { user } } = await supabase.auth.getUser()
        return user
      },
    })

    async function handleSave() {
      if (!newText.trim() || !user) return
      const userName = user.email?.split('@')[0] ?? 'Unknown'
      addUpdate(projectId, notes, newText.trim(), userName)
      setNewText('')
    }

    return (
      <div className="bg-slate-900 rounded-xl p-4">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest mb-3">Latest / Next Steps</h3>
        {notes && (
          <pre className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap mb-3 font-sans">
            {notes}
          </pre>
        )}
        <div className="flex gap-2">
          <textarea
            value={newText}
            onChange={e => setNewText(e.target.value)}
            placeholder="Add update... (auto-stamps date + your name)"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:border-slate-500"
            rows={2}
          />
          <button
            onClick={handleSave}
            disabled={!newText.trim()}
            className="self-end bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs px-4 py-2 rounded-lg"
          >
            Save
          </button>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 3: Implement LinkedDocuments**

  Create `components/project/LinkedDocuments.tsx`:
  ```typescript
  'use client'
  import { useState } from 'react'
  import { useUpdateProject } from '@/lib/hooks/useProjects'

  interface LinkedDocumentsProps {
    projectId: string
    documents: string[]
  }

  export function LinkedDocuments({ projectId, documents }: LinkedDocumentsProps) {
    const [newUrl, setNewUrl] = useState('')
    const updateProject = useUpdateProject()

    function handleAdd() {
      if (!newUrl.trim()) return
      updateProject.mutate({
        id: projectId,
        updates: { linked_documents: [...documents, newUrl.trim()] },
      })
      setNewUrl('')
    }

    function getDocTitle(url: string) {
      try { return new URL(url).hostname + '…' } catch { return url.slice(0, 40) + '…' }
    }

    return (
      <div className="bg-slate-900 rounded-xl p-4">
        <h3 className="text-xs text-slate-400 uppercase tracking-widest mb-3">Linked Documents</h3>
        <div className="flex flex-col gap-2 mb-3">
          {documents.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 text-sm text-blue-400 hover:text-blue-300 transition-colors">
              <span>📄</span>
              <span className="truncate">{getDocTitle(url)}</span>
            </a>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            placeholder="Paste Google Doc URL"
            className="flex-1 bg-slate-800 border border-dashed border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-300 placeholder-slate-600 focus:outline-none"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button onClick={handleAdd} disabled={!newUrl.trim()}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 text-xs px-3 py-2 rounded-lg">
            Add
          </button>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 4: Implement full project detail page**

  Create `app/(app)/projects/[id]/page.tsx`:
  ```typescript
  'use client'
  import { useParams, useRouter } from 'next/navigation'
  import { useProjects, useUpdateProject } from '@/lib/hooks/useProjects'
  import { PipelineProgress } from '@/components/project/PipelineProgress'
  import { LatestNextSteps } from '@/components/project/LatestNextSteps'
  import { LinkedDocuments } from '@/components/project/LinkedDocuments'
  import { NProgressBar } from '@/components/shared/NProgressBar'
  import { InfoTooltip } from '@/components/shared/InfoTooltip'
  import { formatDate } from '@/lib/utils/date'

  const TOOLTIPS: Record<string, string> = {
    'N Target': 'Total number of survey responses you\'re aiming to collect.',
    'N Collected': 'Responses collected so far. Auto-synced every 15 minutes — do not edit manually.',
    'Audience Size': 'Total size of the panel or population being surveyed. Different from N (target responses).',
    'Row-Level Data': 'Whether individual respondent-level data is included in the deliverable.',
    'Terminations': 'Whether any survey participants have been terminated (screened out) from the study.',
    'Project Captain': 'The team member responsible for this project end-to-end.',
    'Latest / Next Steps': 'Free-text field for current status and next actions. Each entry is date- and name-stamped automatically.',
  }

  export default function ProjectDetailPage() {
    const { id } = useParams()
    const router = useRouter()
    const { data: projects = [] } = useProjects()
    const updateProject = useUpdateProject()
    const project = projects.find(p => p.id === id)

    if (!project) return <div className="text-slate-400">Loading...</div>

    function closeProject() {
      updateProject.mutate({ id: project.id, updates: { status: 'Closed' } })
      router.push('/')
    }

    const TYPE_COLORS: Record<string, string> = {
      PS: 'bg-blue-500/20 text-blue-400',
      B2B: 'bg-violet-500/20 text-violet-400',
      Rerun: 'bg-emerald-500/20 text-emerald-400',
    }

    return (
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.push('/')} className="text-slate-400 hover:text-slate-200 text-sm">← Board</button>
          <span className="text-slate-600">/</span>
          <h1 className="text-xl font-bold text-white">{project.project_name}</h1>
          {project.type && <span className={`text-xs px-2 py-1 rounded ${TYPE_COLORS[project.type]}`}>{project.type}</span>}
          <span className={`text-xs px-2 py-1 rounded ${project.status === 'Open' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
            {project.status}
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={closeProject}
              className="text-xs border border-slate-700 text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg">
              ✕ Close Project
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_300px] gap-6">
          {/* Left column */}
          <div className="flex flex-col gap-4">
            <div className="bg-slate-900 rounded-xl p-4">
              <h3 className="text-xs text-slate-400 uppercase tracking-widest mb-4">Pipeline Progress</h3>
              <PipelineProgress project={project} />
            </div>
            <LatestNextSteps projectId={project.id} notes={project.latest_next_steps} />
            <LinkedDocuments projectId={project.id} documents={project.linked_documents ?? []} />
          </div>

          {/* Right sidebar */}
          <div className="flex flex-col gap-4">
            <div className="bg-slate-900 rounded-xl p-4">
              <h3 className="text-xs text-slate-400 uppercase tracking-widest mb-4">Project Details</h3>
              <div className="flex flex-col gap-3">
                {[
                  ['Client', project.client, null],
                  ['Project Captain', project.captain?.initials ?? '—', 'Project Captain'],
                  ['Submitted', formatDate(project.submitted_date), null],
                  ['Launch Date', formatDate(project.launch_date), null],
                  ['Due Date', formatDate(project.due_date), null],
                  ['Deliver Date', formatDate(project.deliver_date), null],
                ].map(([label, value, tip]) => (
                  <div key={label as string} className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 flex items-center">
                      {label as string}
                      {tip && <InfoTooltip text={TOOLTIPS[tip as string]} />}
                    </span>
                    <span className="text-slate-200">{value as string}</span>
                  </div>
                ))}
                <div className="border-t border-slate-800 pt-3">
                  <div className="flex justify-between items-center text-sm mb-1">
                    <span className="text-slate-500 flex items-center">N Target<InfoTooltip text={TOOLTIPS['N Target']} /></span>
                    <span className="text-slate-200">{project.n_target ?? '—'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm mb-2">
                    <span className="text-slate-500 flex items-center">N Collected<InfoTooltip text={TOOLTIPS['N Collected']} /></span>
                    <span className="text-emerald-400">{project.n_collected ?? '—'}</span>
                  </div>
                  <NProgressBar collected={project.n_collected} target={project.n_target} showLabel={false} />
                  <div className="flex justify-between items-center text-sm mt-3">
                    <span className="text-slate-500 flex items-center">Audience Size<InfoTooltip text={TOOLTIPS['Audience Size']} /></span>
                    <span className="text-slate-200">{project.audience_size ?? '—'}</span>
                  </div>
                </div>
                <div className="border-t border-slate-800 pt-3 flex flex-col gap-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 flex items-center">Row-Level Data<InfoTooltip text={TOOLTIPS['Row-Level Data']} /></span>
                    <span className={project.row_level_data ? 'text-emerald-400' : 'text-slate-500'}>{project.row_level_data ? '✓ Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 flex items-center">Terminations<InfoTooltip text={TOOLTIPS['Terminations']} /></span>
                    <span className={project.terminations ? 'text-red-400' : 'text-slate-500'}>{project.terminations ? '⚠ Yes' : 'No'}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-slate-900 rounded-xl p-4 text-xs text-slate-500 leading-relaxed">
              <p className="font-medium text-slate-400 mb-1">Notifications</p>
              Slack alerts sent to #survey-ops when: stage advances, due date is tomorrow, N target is hit.
            </div>
          </div>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add project detail page with pipeline, notes, and linked docs"
  ```

---

## Task 11: Scoping Phase

**Files:**
- Create: `components/scoping/ScopingBoard.tsx`
- Modify: `app/(app)/page.tsx`

- [ ] **Step 1: Implement ScopingBoard**

  Create `components/scoping/ScopingBoard.tsx`:
  ```typescript
  'use client'
  import { ProjectCard } from '@/components/board/ProjectCard'
  import { useUpdateProject } from '@/lib/hooks/useProjects'
  import { useRouter } from 'next/navigation'

  const SCOPING_STAGES = ['New Inquiry', 'Proposal Sent', 'Pricing Discussion', 'Awaiting Approval', 'Closed']

  interface ScopingBoardProps {
    projects: any[]
  }

  export function ScopingBoard({ projects }: ScopingBoardProps) {
    const updateProject = useUpdateProject()
    const router = useRouter()

    function approveProject(id: string) {
      updateProject.mutate({
        id,
        updates: {
          phase: 'Active',
          status: 'Open',
          scoping_stage: null,
          board_column: 'Submitted',
          stage_doc_programming: false,
          stage_survey_programming: false,
          stage_edwin_qa: false,
          stage_fielding: false,
          stage_data_qa: false,
          stage_delivery: false,
        },
      })
    }

    return (
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px flex-1 bg-violet-500/30" />
          <span className="text-xs text-violet-400 uppercase tracking-widest">Scoping Phase</span>
          <div className="h-px flex-1 bg-violet-500/30" />
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {SCOPING_STAGES.map(stage => {
            const stageProjects = projects.filter(p => p.scoping_stage === stage)
            return (
              <div key={stage} className="bg-slate-900 rounded-xl p-3 min-w-[180px]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-slate-400 uppercase tracking-widest">{stage}</span>
                  <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">{stageProjects.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {stageProjects.map(p => (
                    <div key={p.id} className={stage === 'Closed' ? 'opacity-50' : ''}>
                      <div className={stage === 'Closed' ? 'line-through' : ''}>
                        <ProjectCard project={p} onClick={() => router.push(`/projects/${p.id}`)} />
                      </div>
                      {stage === 'Awaiting Approval' && (
                        <button
                          onClick={() => approveProject(p.id)}
                          className="w-full mt-1 text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-600/30 rounded-lg py-1.5 transition-colors"
                        >
                          ✓ Approve
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-px flex-1 bg-slate-700" />
          <span className="text-xs text-slate-500 uppercase tracking-widest">Active Pipeline</span>
          <div className="h-px flex-1 bg-slate-700" />
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Add Scoping section to board page**

  Update `app/(app)/page.tsx` — add ScopingBoard above the Board when mode is 'full':
  ```typescript
  // Add import
  import { ScopingBoard } from '@/components/scoping/ScopingBoard'

  // Add inside the return, above <Board>:
  {mode === 'full' && (
    <ScopingBoard projects={projects.filter(p => p.phase === 'Scoping')} />
  )}
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add -A
  git commit -m "feat: add scoping phase board with approve action"
  ```

---

## Task 12: AI Assistant

**Files:**
- Create: `app/api/ai/route.ts`
- Create: `components/ai/AIAssistant.tsx`
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: Create AI API route**

  Create `app/api/ai/route.ts`:
  ```typescript
  import Anthropic from '@anthropic-ai/sdk'
  import { createClient } from '@/lib/supabase/server'
  import { NextRequest, NextResponse } from 'next/server'

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  export async function POST(req: NextRequest) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { message } = await req.json()

    // Fetch all project data to include as context
    const { data: projects } = await supabase
      .from('survey_projects')
      .select('*, captain:team_members(name, initials, email)')
      .eq('status', 'Open')

    const today = new Date().toISOString().split('T')[0]
    const projectContext = JSON.stringify(projects, null, 2)

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: `You are a survey operations assistant. Today's date is ${today}. The logged-in user's email is ${user.email}.

You have read access to all live project data (provided below). You cannot create, edit, or delete projects — if asked, explain this and suggest the user update directly.

When answering:
- "My projects" or "assigned to me" = projects where captain email matches ${user.email}
- "Due today" = due_date equals ${today}
- "Overdue" = due_date < ${today} AND status = Open
- "At risk" = overdue, OR terminations = true, OR (phase=Active AND stage_fielding=true AND n_collected < n_target*0.5 AND due_date within 7 days)
- Always include Project Name and Client when listing projects
- Keep answers concise — bullet points for lists

Current project data:
${projectContext}`,
      messages: [{ role: 'user', content: message }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    return NextResponse.json({ reply: text })
  }
  ```

- [ ] **Step 2: Implement AI chat panel**

  Create `components/ai/AIAssistant.tsx`:
  ```typescript
  'use client'
  import { useState } from 'react'

  const SUGGESTED_PROMPTS = [
    "What's due today that's assigned to me?",
    'What should I prioritize today?',
    'Any risks on the projects I own?',
    'Which in-field projects are behind on N collection?',
  ]

  interface Message { role: 'user' | 'assistant'; text: string }

  export function AIAssistant() {
    const [open, setOpen] = useState(false)
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)

    async function sendMessage(text: string) {
      if (!text.trim()) return
      setMessages(prev => [...prev, { role: 'user', text }])
      setInput('')
      setLoading(true)
      try {
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        })
        const { reply } = await res.json()
        setMessages(prev => [...prev, { role: 'assistant', text: reply }])
      } finally {
        setLoading(false)
      }
    }

    return (
      <>
        <button
          onClick={() => setOpen(o => !o)}
          className="fixed bottom-6 right-6 w-12 h-12 bg-indigo-600 hover:bg-indigo-500 rounded-full shadow-lg flex items-center justify-center text-xl transition-colors z-50"
        >
          {open ? '✕' : '✦'}
        </button>
        {open && (
          <div className="fixed bottom-20 right-6 w-96 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col z-50 max-h-[500px]">
            <div className="p-4 border-b border-slate-800 flex items-center gap-2">
              <span className="text-sm font-medium text-white">AI Assistant</span>
              <span className="text-xs text-slate-500">Read-only access to project data</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0">
              {messages.length === 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-slate-500 mb-1">Try asking:</p>
                  {SUGGESTED_PROMPTS.map(p => (
                    <button key={p} onClick={() => sendMessage(p)}
                      className="text-left text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg transition-colors">
                      {p}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`text-sm rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-indigo-600/20 text-indigo-200 self-end' : 'bg-slate-800 text-slate-200'}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
              ))}
              {loading && <div className="text-xs text-slate-500 animate-pulse">Thinking...</div>}
            </div>
            <div className="p-3 border-t border-slate-800 flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
                placeholder="Ask about your projects..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
              <button onClick={() => sendMessage(input)} disabled={!input.trim() || loading}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm">
                →
              </button>
            </div>
          </div>
        )}
      </>
    )
  }
  ```

- [ ] **Step 3: Add AI widget to app layout**

  Update `app/(app)/layout.tsx` to include `<AIAssistant />` at the bottom of the layout body.

- [ ] **Step 4: Add ANTHROPIC_API_KEY to .env.local**

  Get your API key from [console.anthropic.com](https://console.anthropic.com) and add to `.env.local`:
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add AI assistant chat panel with Claude API"
  ```

---

## Task 13: N Collected Webhook

**Files:**
- Create: `app/api/webhooks/n-collected/route.ts`

- [ ] **Step 1: Implement webhook endpoint**

  Create `app/api/webhooks/n-collected/route.ts`:
  ```typescript
  import { createClient } from '@supabase/supabase-js'
  import { NextRequest, NextResponse } from 'next/server'

  // Uses service role to bypass RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  export async function POST(req: NextRequest) {
    // Verify webhook secret
    const secret = req.headers.get('x-webhook-secret')
    if (secret !== process.env.WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { project_id, n_collected } = await req.json()
    if (!project_id || n_collected == null) {
      return NextResponse.json({ error: 'Missing project_id or n_collected' }, { status: 400 })
    }

    // Find project by survey_tool_id or project_name
    const { data: project, error: findError } = await supabase
      .from('survey_projects')
      .select('id')
      .or(`survey_tool_id.eq.${project_id},project_name.eq.${project_id}`)
      .single()

    if (findError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const { error: updateError } = await supabase
      .from('survey_projects')
      .update({ n_collected, n_last_synced: new Date().toISOString() })
      .eq('id', project.id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  }
  ```

- [ ] **Step 2: Add WEBHOOK_SECRET to .env.local**

  Generate a random secret:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  Add to `.env.local` as `WEBHOOK_SECRET=<generated value>`.

  Share this URL + secret with your dev: `https://your-app.vercel.app/api/webhooks/n-collected`

- [ ] **Step 3: Commit**

  ```bash
  git add -A
  git commit -m "feat: add N Collected webhook endpoint for survey tool sync"
  ```

---

## Task 14: Deploy to Vercel

**Files:**
- Create: `.env.local` (production values)
- Create: `vercel.json` (if needed)

- [ ] **Step 1: Push to GitHub**

  ```bash
  git remote add origin https://github.com/YOUR_USERNAME/survey-ops-tracker.git
  git push -u origin main
  ```

- [ ] **Step 2: Deploy on Vercel**

  Go to [vercel.com](https://vercel.com) → New Project → Import your GitHub repo → Framework: Next.js (auto-detected).

  Add all environment variables from `.env.local`:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ANTHROPIC_API_KEY`
  - `WEBHOOK_SECRET`

  Click Deploy.

- [ ] **Step 3: Create first user in Supabase**

  In Supabase dashboard → Authentication → Users → Add User:
  - Email: david@alpharoc.ai
  - Password: (set a secure password)

  Add team members the same way.

- [ ] **Step 4: Verify live app**

  Open the Vercel URL → log in → confirm board loads.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "chore: production deployment setup"
  ```

---

## Task 15: Make.com Integrations

*(Same as original plan Tasks 11–14 — Make.com scenarios connect to your Supabase database via the Supabase API or your webhook endpoint instead of Base44)*

Key change: When Make.com needs to create/update a Survey Project, use the **Supabase → Insert/Update Row** module instead of Base44.

Make.com connection: Supabase → connect with your Project URL + service role key.

Refer to `docs/superpowers/plans/2026-06-08-survey-ops-tracker.md` Tasks 11–14 for the full Make.com scenario steps — substitute Base44 modules with Supabase modules throughout.

---

## Task 16: Final Verification & Team Onboarding

*(Same as original plan Task 16 — smoke test all integrations, write team guide, onboard team, retire spreadsheet)*

Refer to `docs/superpowers/plans/2026-06-08-survey-ops-tracker.md` Task 16 for full steps.

---

## Appendix: Environment Variables

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `WEBHOOK_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
