-- 093: let the `sales` tier read its OWN projects, enforced in the database.
--
-- WHY THIS EXISTS
--
-- David asked for a sales view: a salesperson signs in, sees the surveys that
-- are open, what stage each is in, N collected vs target, the client, who
-- requested it, and the study name. He chose a HARD boundary for it — a real
-- tier like `compliance`, with policies written for it — over hiding things in
-- app code.
--
-- 085 added `sales` to the tier enum and assigned it to nobody, which was safe
-- precisely because ~73 policies test `my_role() = 'analyst'` for exact
-- equality: a sales tier is denied everything by default. This file grants back
-- the one narrow thing it should see, and nothing else.
--
-- WHAT THE VIEW ACTUALLY NEEDS: only survey_projects. `client`,
-- `requested_by_name` and every N field are already denormalised onto the
-- project row, so the pipeline list needs no joins and therefore no second
-- policy. That is worth saying out loud, because the instinct is to open up
-- clients and client_contacts too, and it is not necessary.
--
-- ── THE MAPPING PROBLEM, AND WHY THERE IS A TABLE ─────────────────────────────
--
-- Scoping means "rows where salesperson is THIS person". At runtime we have the
-- signed-in email; the projects carry a NAME ("Alex Pinsky"). Something has to
-- map one to the other, and that something is consulted by RLS, so it has to
-- exist in SQL.
--
-- lib/utils/salespeople.ts already holds that mapping in TypeScript. Copying it
-- into a SQL function would create two definitions of who-is-who, and this
-- codebase has already paid for that mistake once: series_id and
-- rerun_series_id are two columns for one idea, they drifted, and a survey ended
-- up grouped on one screen and loose on another. Doing it again where the
-- consequence is ACCESS CONTROL would be worse — the two copies disagreeing
-- means either a salesperson cannot see their own work, or sees someone else's.
--
-- So the mapping lives in a table, once, and SQL reads it. The TypeScript
-- constant keeps a different job — which names may be PICKED in the dropdown —
-- and a data-health check reports any disagreement rather than letting it sit.
--
-- WHAT THIS FILE DOES NOT DO
--
-- · No write access. Sales is read-only here. Nothing in the brief asks a
--   salesperson to change a project, and a tier that cannot write cannot
--   corrupt anything.
-- · No money. David's answer was "sales see revenue, not margin", and revenue
--   in this system means credits/dollars, which live in CCM and are not
--   reachable yet. project_financials stays finance-only (086) and is NOT
--   opened to sales — doing so would expose price per N, which is the one
--   number he has been consistent about restricting.
-- · No client or contact tables. See above: not needed.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
begin;

-- ── STEP 1: who is a salesperson, and what do they sign in as ─────────────────
-- Reference data, tiny, and read by RLS on every sales query — so it is a table
-- rather than a function full of literals, and the lookup is by primary key.
create table if not exists public.salespeople (
  email          text primary key,
  canonical_name text not null unique,
  active         boolean not null default true,
  note           text,
  created_at     timestamptz not null default now()
);
comment on table public.salespeople is
  'Maps a signed-in AlphaROC account to the salesperson NAME stored on survey_projects.salesperson. The authority for SALES SCOPING - my_salesperson_name() reads it, and RLS depends on it. lib/utils/salespeople.ts holds the same names for the project dropdown; a data-health check reports any disagreement. `active` false retires someone without breaking their history: their projects keep their name and they can still sign in and see them.';

-- Seeded from lib/utils/salespeople.ts as at 2026-08-31. Every live project's
-- salesperson value is one of these names — the five strays were normalised on
-- 2026-08-27, so this covers the whole table. 'Internal' is deliberately absent:
-- it is a category, not a person, and nobody signs in as it.
insert into public.salespeople (email, canonical_name, active, note) values
  ('alex@alpharoc.ai',   'Alex Pinsky',    true,  'Salesperson on ~160 projects.'),
  ('jenna@alpharoc.ai',  'Jenna Shrove',   true,  'Salesperson on ~54 projects.'),
  ('vineet@alpharoc.ai', 'Vineet Kapur',   true,  'COO; also sells. ~21 projects.'),
  ('shanu@alpharoc.ai',  'Shanu Aggarwal', true,  '3 projects.'),
  ('steven@alpharoc.ai', 'Steven Stubbs',  false, 'No longer at AlphaROC. Inactive so he is not offered on new projects; his 1 project keeps its attribution.')
on conflict (email) do update
  set canonical_name = excluded.canonical_name,
      active         = excluded.active,
      note           = excluded.note;

alter table public.salespeople enable row level security;
revoke all on public.salespeople from anon, authenticated;
grant select on public.salespeople to authenticated;
grant all on public.salespeople to service_role;

-- Readable by anyone signed in: knowing that Alex sells is not sensitive, and
-- the admin roster and the project dropdown both want it. Writes are
-- service-role only, like profile_roles (085) — a salesperson must not be able
-- to remap themselves onto someone else's name, which would hand them that
-- person's whole pipeline.
drop policy if exists salespeople_read on public.salespeople;
create policy salespeople_read on public.salespeople for select to authenticated using (true);
drop policy if exists salespeople_service_all on public.salespeople;
create policy salespeople_service_all on public.salespeople for all to service_role using (true) with check (true);

-- ── STEP 2: the mapping function RLS calls ───────────────────────────────────
-- security definer + pinned search_path, same shape as my_role() (006) and
-- can() (085), so a policy can call it without a recursive RLS lookup on
-- salespeople.
--
-- Keyed on auth.email() rather than auth.uid() on purpose: the join is
-- email-to-email, and it keeps working for a salesperson whose profile row is
-- created the moment they first sign in.
--
-- Returns NULL for anyone who is not an active salesperson — every analyst, and
-- Steven. NULL is what makes the policy in step 3 deny rather than widen: a
-- comparison against NULL is never true, so an analyst gains nothing from this
-- policy existing and simply keeps matching their own.
create or replace function public.my_salesperson_name()
returns text language sql stable security definer set search_path = public as
$$
  select s.canonical_name
    from public.salespeople s
   where lower(s.email) = lower(coalesce(auth.email(), ''))
     and s.active
$$;

revoke execute on function public.my_salesperson_name() from anon, public;
grant execute on function public.my_salesperson_name() to authenticated;

-- ── STEP 3: the one policy ───────────────────────────────────────────────────
-- SELECT only, for the sales tier only, and only their own rows.
--
-- Both halves of the AND matter:
--   · my_role() = 'sales' keeps this policy from applying to anybody else. An
--     analyst is evaluated by the existing analyst policies exactly as before;
--     this is purely additive and cannot widen their access.
--   · salesperson = my_salesperson_name() is the scope. When the function
--     returns NULL — not a salesperson, or retired — the comparison is NULL,
--     the policy grants nothing, and a sales-tier account with no mapping sees
--     an empty list rather than everything. Failing closed is the point.
--
-- Deleted projects are excluded here rather than left to the app: a soft-deleted
-- project is gone as far as anyone outside the internal tool is concerned, and a
-- policy is a better place to guarantee that than every future query.
drop policy if exists survey_projects_sales_read on public.survey_projects;
create policy survey_projects_sales_read on public.survey_projects
  for select to authenticated
  using (
    public.my_role() = 'sales'
    and deleted_at is null
    and salesperson is not null
    and salesperson = public.my_salesperson_name()
  );

commit;
