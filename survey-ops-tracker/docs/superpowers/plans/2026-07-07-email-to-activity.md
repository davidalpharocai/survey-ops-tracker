# Email → Project Activity Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-log inbound client emails to each project's Activity timeline, with precision-first matching, a review queue for uncertain mail, and full-body search — reusing the existing matcher/timeline rails.

**Architecture:** Per-captain Gmail filters forward client-tied mail to a dedicated free Google Group `activity@` → one backing-inbox Apps Script POSTs to `/api/webhooks/email-activity` → a direction-aware, precision-first matcher → confident matches promote into `project_activity`; uncertain/orphan mail lands in a new `email_inbox` review queue. See spec: `docs/superpowers/specs/2026-07-07-email-to-activity-design.md` (esp. the "Review resolutions" section — it governs every decision below).

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + RLS), TypeScript (repo bans `any`), vitest (330+ tests), date-fns, Google Apps Script. Reuses `lib/deliverables/matcher.ts` + `confidence.ts`, `project_activity`, `isActiveOperational` (`lib/mcp/data.ts`).

**Scope:** Phase 1 = inbound capture + explicit-signal auto-log (validated survey-ID / PR-code / single active-operational project) + review queue. The matcher is built fully but **fuzzy tiers (contact-only / domain / name) route to review** behind a flag; Phase 2 flips the flag after observing queue volume.

**What I cannot do (David's steps, documented in Task 12):** create the `activity@` Group, verify Gmail forwarding, import filters, run the migration in Supabase, and the transport spike. Code is built defensively so it's correct regardless of the spike's outcome (Message-ID/From extracted from raw headers with a review fallback).

---

## File Structure

- `supabase/migrations/048_email_activity.sql` — email_inbox + enum + RLS; survey_projects.delivered_at + trigger + backfill; project_activity.deleted_at + search index.
- `lib/email-activity/parse.ts` (+ `.test.ts`) — pure: Message-ID extraction, quoted-history stripping, survey-ID tokenization, participant parsing.
- `lib/email-activity/match.ts` (+ `.test.ts`) — direction-aware, precision-first matcher; builds on `lib/deliverables/matcher.ts`.
- `lib/email-activity/load.ts` — loads all non-deleted projects (+status/phase/board_column) and the contact roster (client_contacts ∪ project_recipients) and the validated survey-ID map.
- `lib/email-activity/promote.ts` (+ `.test.ts`) — crash-safe promote email_inbox → project_activity (23505-safe), cross-pipeline dedup.
- `app/api/webhooks/email-activity/route.ts` — ingest endpoint.
- `app/(app)/email-review/page.tsx` + `components/email-review/*` — review queue UI (mirror deliverables review).
- `lib/hooks/useEmailReview.ts` — queue list + file/ignore actions.
- `components/project/ActivityTimeline.tsx` (modify existing activity render) — compact/expand rows, Gmail deep-link, search-and-jump.
- `lib/mcp/data.ts` + `app/api/mcp/route.ts` — list_activity search + snippet default; new `get_email` full-body tool.
- `app/api/cron/email-retention/route.ts` + `vercel.json` — TTL expiry, pending→attach, offboard purge.
- `lib/email-activity/filters.ts` + `app/api/admin/gmail-filters/route.ts` — generate per-captain Gmail filter XML.
- `scripts/apps-script/activity-forwarder.gs` + README section — the backing-inbox forwarder.
- `USER_GUIDE.md` + `EMAIL_ACTIVITY_GO_LIVE.md` — docs (Task 12).

---

## Task 1: Migration 048 — schema

**Files:** Create `supabase/migrations/048_email_activity.sql`

- [ ] **Step 1: Write the migration** (David runs it in Supabase; I cannot run DDL). Follow the RLS + service-role split from `045_mcp_connector.sql` / `036*`.

```sql
-- 048_email_activity.sql — email→activity timeline: review queue, delivered_at, soft-delete, search
begin;

-- 1) delivered_at: stamp when a project enters the 'Delivery' (Delivered) column.
alter table public.survey_projects add column if not exists delivered_at timestamptz;

create or replace function public.stamp_delivered_at() returns trigger as $$
begin
  if new.board_column = 'Delivery' and (old.board_column is distinct from 'Delivery')
     and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists survey_projects_delivered_at on public.survey_projects;
create trigger survey_projects_delivered_at
  before update on public.survey_projects
  for each row execute function public.stamp_delivered_at();

-- Backfill from the audit log (board_column is audited): earliest transition into Delivery.
update public.survey_projects p set delivered_at = a.first_delivered
from (
  select project_id, min(changed_at) as first_delivered
  from public.project_audit
  where field = 'board_column' and new_value = 'Delivery'
  group by project_id
) a
where a.project_id = p.id and p.delivered_at is null;

-- 2) project_activity soft-delete + full-text search.
alter table public.project_activity add column if not exists deleted_at timestamptz;
create extension if not exists pg_trgm;
create index if not exists project_activity_search_idx
  on public.project_activity using gin ((coalesce(subject,'') || ' ' || coalesce(body,'')) gin_trgm_ops);
create index if not exists project_activity_project_occurred_idx
  on public.project_activity (project_id, occurred_at desc);

-- 3) email_inbox review queue.
do $$ begin
  create type public.email_inbox_status as enum ('review','pending_no_project','filed','ignored');
exception when duplicate_object then null; end $$;

create table if not exists public.email_inbox (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,               -- 'email:<RFC-822 Message-ID>'
  status public.email_inbox_status not null default 'review',
  project_id uuid references public.survey_projects(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  direction text,                          -- 'inbound' | 'outbound'
  from_email text,
  to_emails text[],
  subject text,
  snippet text,
  body text,
  occurred_at timestamptz not null default now(),
  gmail_message_id text,                   -- per-mailbox id, debug only
  source text not null default 'email-timeline',
  match_candidates jsonb,
  matched_confidence numeric,
  created_at timestamptz not null default now()  -- drives TTL
);
create unique index if not exists email_inbox_external_id_key on public.email_inbox (external_id);
create index if not exists email_inbox_status_idx on public.email_inbox (status);
create index if not exists email_inbox_project_idx on public.email_inbox (project_id);
create index if not exists email_inbox_client_idx on public.email_inbox (client_id);
create index if not exists email_inbox_created_idx on public.email_inbox (created_at);

alter table public.email_inbox enable row level security;
revoke all on public.email_inbox from anon, authenticated;
-- analyst may triage (read + update status/project); service_role does ingest writes.
create policy email_inbox_analyst_select on public.email_inbox for select
  using (public.my_role() = 'analyst');
create policy email_inbox_analyst_update on public.email_inbox for update
  using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');

commit;
```

- [ ] **Step 2: Verify (David applies, then column-exists check).** After David reports success, verify via REST: `GET {SUPABASE_URL}/rest/v1/email_inbox?select=id&limit=1` (service key) returns `[]` not `42P01`; and `survey_projects?select=delivered_at&limit=1` not `42703`. Per [[pending-migrations]] lesson: confirm the column exists before building on it.

- [ ] **Step 3: Commit** `git add supabase/migrations/048_email_activity.sql && git commit`.

---

## Task 2: Pure parsing helpers (TDD)

**Files:** Create `lib/email-activity/parse.ts`, `lib/email-activity/parse.test.ts`

- [ ] **Step 1: Write failing tests** for:
  - `extractMessageId(rawHeaders: string): string | null` — parses `/^Message-ID:\s*<([^>]+)>/im`; returns null if absent.
  - `stripQuotedHistory(body: string): string` — removes `On … wrote:` blocks and `>`-quoted lines and signatures below `-- `; returns the top reply only.
  - `tokenizeSurveyIds(raw: string | null): string[]` — split on `[,\s\n]+`, trim, uppercase, drop blanks/dupes.
  - `parseParticipants(from: string, to: string): { from_email: string|null; to_emails: string[] }` — lowercase, extract addr-spec from `Name <a@b>`.
- [ ] **Step 2: Run — expect fail.** `npx vitest run lib/email-activity/parse.test.ts`
- [ ] **Step 3: Implement** the four pure functions (no `any`; regex + string ops).
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.**

---

## Task 3: Match-data loader

**Files:** Create `lib/email-activity/load.ts`

- [ ] **Step 1: Implement `loadEmailMatchData(supabase)`** returning `{ projects, contacts, surveyIdMap }`:
  - `projects`: ALL `survey_projects` where `deleted_at is null`, selecting `id, project_code, client_id, project_name, status, phase, board_column, rerun_series_id, rerun_number, survey_ids_from_sheet`. (Load every state — exact code/survey-ID must match Closed/Delivered too.)
  - `contacts`: union of `client_contacts` (`archived=false`, non-null email) and `project_recipients`, normalized `{ email, client_id, project_id? }`; `client_contacts` wins on conflict (authoritative for client-tied relevance).
  - `surveyIdMap`: `Map<string, string[]>` from `tokenizeSurveyIds(project.survey_ids_from_sheet)` → projectId(s). IDs mapping to >1 project are kept as arrays (matcher routes them to review).
- [ ] **Step 2: Commit.** (No unit test — thin DB loader; covered by Task 4 matcher tests with fixtures.)

---

## Task 4: Precision-first matcher (TDD)

**Files:** Create `lib/email-activity/match.ts`, `lib/email-activity/match.test.ts`. Reuse tier ideas from `lib/deliverables/matcher.ts`.

- [ ] **Step 1: Write failing tests** covering the resolution rules:
  - Explicit **PR-code** in subject/body → `{ decision:'auto-log', projectId }` even if that project is Closed/Delivered.
  - Validated **survey-ID** (membership in surveyIdMap, single owner) → auto-log any state; survey-ID mapping to >1 project → `review` with candidates.
  - **Single active-operational** project for the resolved client (via `isActiveOperational`) → auto-log; 0 active → `review`; 2+ active → `review` (unless rerun: newest non-Delivered wave in-window wins).
  - **Fuzzy tiers** (contact-only / domain / name): with `fuzzyAutoLog=false` (Phase 1 default) → always `review`; with `true` → auto-log only if single active-operational.
  - **Direction:** external sender → `inbound`, resolve client from `from_email`; internal (@alpharoc) sender → `outbound`, resolve from recipients.
  - **Watch window:** fuzzy match auto-log only while Watching or within `delivered_at + 2 days` (Sweep); explicit code/survey-ID ignores the window. NULL `delivered_at` on a Delivered project → past-sweep → review.
  - Unknown sender / no client → `{ decision:'pending_no_project' }` if a code/survey-ID is present but the project doesn't exist, else `review`.
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement `matchEmail(input, data, opts)`** returning `{ decision: 'auto-log'|'review'|'pending_no_project', projectId?, clientId?, confidence, candidates[] }`. Apply `isActiveOperational` as a per-candidate gate (never pre-filter the loaded set). `opts.fuzzyAutoLog` defaults false; `opts.now` injectable for window tests (America/New_York).
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.**

---

## Task 5: Promote helper (TDD)

**Files:** Create `lib/email-activity/promote.ts`, `lib/email-activity/promote.test.ts`

- [ ] **Step 1: Write failing tests:** promote inserts a `project_activity` row (`type='email'`, `source='email-timeline'`, `external_id`, full body — NO 20k clip); a `23505` on that insert is treated as already-promoted (still marks the email_inbox row `filed`); cross-pipeline dedup — skip if a `project_activity` row with the same Message-ID already exists (e.g. `external_id in ('email:<id>','deliverable:*')` matching the Message-ID). 
- [ ] **Step 2–4: Implement + pass.**
- [ ] **Step 5: Commit.**

---

## Task 6: Ingest endpoint

**Files:** Create `app/api/webhooks/email-activity/route.ts`. Mirror auth/size-cap from `app/api/webhooks/activity/route.ts`.

- [ ] **Step 1: Implement POST:** authorize via `x-webhook-secret` (`safeEqual`); parse payload `{ raw_headers, from, to, subject, body, occurred_at, gmail_message_id }`; `external_id = 'email:' + extractMessageId(raw_headers)` (if null → still store in `email_inbox` as `review`, do not drop); dedup on `external_id` (23505 → `{ok, deduplicated:true}`); load match data; `matchEmail`; then:
  - `auto-log` → `promote` into `project_activity`.
  - `review` / `pending_no_project` → insert `email_inbox` (23505 = success/no-op).
  - Own body-size cap for `email_inbox.body`.
- [ ] **Step 2: Add a route test** (mock supabase) for the three branches + duplicate → no-op.
- [ ] **Step 3: Build + commit.** `npx next build`.

---

## Task 7: Review-queue UI + actions

**Files:** Create `app/(app)/email-review/page.tsx`, `components/email-review/EmailReviewList.tsx`, `lib/hooks/useEmailReview.ts`. Mirror the deliverables review-queue UX.

- [ ] **Step 1:** `useEmailReview` — list `email_inbox` where `status='review'` (and `pending_no_project`), and actions `fileToProject(id, projectId)` (calls promote path via a server action/route, sets `filed`) and `ignore(id)` (sets `ignored`).
- [ ] **Step 2:** UI — one row per item: from · subject · date · snippet (expand → full body / open-in-Gmail link built from Message-ID); candidate-project chips (from `match_candidates`) + a project search box; "File to PR#####" and "Ignore" buttons. Tailwind v4 arbitrary values, `fmtNum` where relevant.
- [ ] **Step 3:** Nav entry + pending-count badge.
- [ ] **Step 4: Build + commit.**

---

## Task 8: Activity timeline UI + search

**Files:** Modify the project page activity render (`app/(app)/projects/[id]` area / its activity component) and `lib/mcp/data.ts` reads.

- [ ] **Step 1:** Add `.is('deleted_at', null)` to EVERY `project_activity` read (`listActivity` data.ts, `getProjectDetail` activity query, any other consumer — grep `project_activity`).
- [ ] **Step 2:** Compact rows (subject · participants · date · snippet), click to expand full body + "open in Gmail"; a search box scoped to the project's activity (server-side ilike/trgm on subject+body, bounded result count) that filters/jumps.
- [ ] **Step 3: Build + commit.**

---

## Task 9: Connector search + full-body tool

**Files:** `lib/mcp/data.ts`, `app/api/mcp/route.ts`

- [ ] **Step 1:** `listActivity` gains an optional `search` term (trgm/ilike on subject+body) and returns **snippet by default** (not full body), bounded.
- [ ] **Step 2:** New MCP tool `get_email` (or extend `list_activity`) to fetch one activity item's full body by id. Update MCP_INSTRUCTIONS: "email activity is searchable; fetch full body on demand."
- [ ] **Step 3: Build + commit.**

---

## Task 10: Retention + pending-attach cron

**Files:** Create `app/api/cron/email-retention/route.ts`; edit `vercel.json`. Mirror `spawn-reruns` cron (CRON_SECRET gate).

- [ ] **Step 1:** Daily: delete `email_inbox` rows `status in ('review','pending_no_project') and created_at < now()-45d`; scan `pending_no_project` and attach to a newly-matching project **only** on explicit code/survey-ID; soft-delete (`deleted_at`) `project_activity` email rows for offboarded (soft-deleted) clients after a grace.
- [ ] **Step 2:** `vercel.json` cron entry. Build + commit.

---

## Task 11: Gmail filter generation + Apps Script

**Files:** Create `lib/email-activity/filters.ts`, `app/api/admin/gmail-filters/route.ts` (analyst-gated), `scripts/apps-script/activity-forwarder.gs` (+ README section).

- [ ] **Step 1:** `generateFilterXml(captainScope)` — Gmail filter export XML from client-contact emails + client domains (NOT survey IDs — has-words is substring-only; survey IDs validated server-side). Chunk under Gmail's per-filter length + total caps; forward to `activity@alpharoc.ai`, apply a label, skip inbox.
- [ ] **Step 2:** `activity-forwarder.gs` — adapt `deliverables-forwarder.gs`: search its own label, extract RFC-822 Message-ID via `getRawContent()` + `/^Message-ID:/im` (or Gmail advanced service metadata), POST to `/api/webhooks/email-activity`. Separate backing inbox/label from deliverables. Do NOT download attachments.
- [ ] **Step 3: Build + commit.**

---

## Task 12: Documentation (David asked for clear steps)

**Files:** Edit `USER_GUIDE.md`; create `EMAIL_ACTIVITY_GO_LIVE.md`.

- [ ] **Step 1: `USER_GUIDE.md`** — new section: what the email timeline is, how auto-log vs review queue works, how to file/ignore, how to search activity, and the privacy model (per [[user-guide-maintenance]]).
- [ ] **Step 2: `EMAIL_ACTIVITY_GO_LIVE.md`** runbook with numbered steps: (1) create free Google Group `activity@` + posting perms + backing inbox; (2) each captain verifies `activity@` under Gmail Forwarding; (3) generate + import each captain's filter set (delete-old-then-reimport); (4) install `activity-forwarder.gs` + `WEBHOOK_SECRET`; (5) **transport spike** — forward one CC'd email from two accounts, confirm one Message-ID + original From survive, else adjust; (6) apply migration 048; (7) verify a live email lands / queues. Mirror `DELIVERABLES_GO_LIVE.md` tone.
- [ ] **Step 3: Commit.**

---

## Phase 2 (later, not in this plan)

Flip `fuzzyAutoLog=true` after observing review-queue volume; optionally add `thread_key` server-side collapse, a suppressed-senders store (for a "Not relevant" action), and an explicit outbound mechanism.
