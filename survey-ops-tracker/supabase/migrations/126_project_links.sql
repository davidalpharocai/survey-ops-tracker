-- 126: surveys that are related without one being a wave of the other,
-- 2026-09-28.
--
-- WHY. Today the only way to say two surveys belong together is to make one a
-- rerun wave of the other. That relationship carries a lot with it: a wave
-- number, a position in a series, a place in the spawn cron's arithmetic, and a
-- renumbering of every sibling when it changes. It is the right shape for "the
-- Q3 wave of the Bioprocessing tracker" and the wrong shape for everything else
-- people actually want to record:
--
--   * a soft launch and the full launch it fed (both already exist as pairs -
--     "Aritzia - Consumer Survey (Soft Launch)", "Anthropic Retail Investors
--     (Soft Launch)")
--   * the B2B and the consumer half of one study, run side by side
--   * the same questionnaire fielded for two different clients
--   * a survey that replaced a cancelled one
--
-- Forcing any of those into a rerun series puts a wave number on something that
-- is not a wave, and - because the spawn cron reads series membership - can hand
-- it a next wave nobody asked for. David asked for this directly: "i should be
-- able to link surveys whenever too since they can be linked and not necessarily
-- a rerun wave".
--
-- SHAPE. One symmetric, untyped link with an optional note. Symmetric because
-- "related to" has no direction worth storing, and a direction nobody maintains
-- is a field that lies. Untyped because I do not know the categories yet, and a
-- `kind` enum guessed now is one that gets ignored and then has to be migrated;
-- the note carries the meaning until the real categories are visible in the
-- data.
--
-- ONE ROW PER PAIR, enforced rather than agreed: the check constraint requires
-- a_id < b_id, so (A,B) and (B,A) are the same row and the unique index cannot
-- be dodged by inserting the reverse. The API normalises the order before
-- writing (app/api/projects/links).
--
-- ANALYST ONLY. A link names a survey at each end, so a permissive read policy
-- would let a sales session learn that a survey it cannot see exists, and its
-- name, by reading the join. There is no sales surface for this and there should
-- not be one until somebody has thought about that; the policy tests
-- `public.my_role() = 'analyst'` and only that, matching 119 and 120.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
begin;

create table if not exists public.project_links (
  id uuid primary key default gen_random_uuid(),
  a_id uuid not null references public.survey_projects(id) on delete cascade,
  b_id uuid not null references public.survey_projects(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  created_by text,
  -- A survey is not related to itself, and the pair is stored in one canonical
  -- order so the unique index below actually means "one link per pair".
  constraint project_links_not_self check (a_id <> b_id),
  constraint project_links_canonical_order check (a_id < b_id)
);

create unique index if not exists project_links_pair_idx on public.project_links (a_id, b_id);
-- Both directions are looked up ("what is linked to THIS survey"), and only the
-- a_id half is covered by the unique index above.
create index if not exists project_links_b_idx on public.project_links (b_id);

comment on table public.project_links is
  'Symmetric "these two surveys are related" links that are NOT rerun waves - a soft launch and its full '
  'launch, two halves of one study, a replacement for a cancelled survey. One row per pair, stored with '
  'a_id < b_id. Rerun lineage lives in survey_projects.series_id / rerun_series_id and is a different thing.';
comment on column public.project_links.note is
  'Free text saying HOW they are related. Deliberately not an enum: the real categories are not visible in '
  'the data yet, and a guessed one would be ignored and then need migrating.';

alter table public.project_links enable row level security;

drop policy if exists project_links_analyst_read on public.project_links;
create policy project_links_analyst_read on public.project_links
  for select to authenticated
  using (public.my_role() = 'analyst');

drop policy if exists project_links_analyst_write on public.project_links;
create policy project_links_analyst_write on public.project_links
  for insert to authenticated
  with check (public.my_role() = 'analyst');

drop policy if exists project_links_analyst_update on public.project_links;
create policy project_links_analyst_update on public.project_links
  for update to authenticated
  using (public.my_role() = 'analyst')
  with check (public.my_role() = 'analyst');

drop policy if exists project_links_analyst_delete on public.project_links;
create policy project_links_analyst_delete on public.project_links
  for delete to authenticated
  using (public.my_role() = 'analyst');

-- Supabase default privileges hand every new table in `public` to anon AND
-- authenticated. RLS is what actually gates this, but a table anon can reach at
-- all is one bad policy away from being readable, so take the grant away.
revoke all on public.project_links from anon, public;
grant select, insert, update, delete on public.project_links to authenticated;

do $check$
declare n int;
begin
  -- The canonical-order constraint is the whole reason "one link per pair"
  -- holds. Without it the unique index is decorative.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.project_links'::regclass
       and conname = 'project_links_canonical_order') then
    raise exception '126: the canonical-order constraint is missing; (A,B) and (B,A) would both be insertable';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'project_links' and c.relrowsecurity) then
    raise exception '126: row level security is not enabled on project_links';
  end if;

  -- Nothing may touch this table without being an analyst. Matched on the two
  -- TOKENS rather than the whole equality: pg_policies renders an expression
  -- back from the parse tree (`(my_role() = 'analyst'::text)`), and an
  -- assertion keyed on that exact spelling fails for formatting reasons rather
  -- than for security ones, which is how a real check gets deleted.
  -- Note the parentheses. `and` binds tighter than `or`, so without them the
  -- second test escapes the table filter and counts policies on every table in
  -- the database.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'project_links'
     and (
       (coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%my_role%'
       or (coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%analyst%'
     );
  if n <> 0 then
    raise exception '126: % policy(ies) on project_links do not test analyst', n;
  end if;

  -- And there must be four of them: a table with RLS on and no policy for a
  -- command silently denies it, which would look like a broken feature rather
  -- than a missing grant.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'project_links';
  if n <> 4 then
    raise exception '126: expected 4 policies on project_links, found %', n;
  end if;
end $check$;

commit;

-- VERIFY:
--
--   -- Empty, gated, and one row per pair.
--   select count(*) from public.project_links;
--   select polname, polcmd from pg_policy where polrelid = 'public.project_links'::regclass;
--
--   -- The canonical order is enforced, not just intended. Both of these must
--   -- FAIL (run them one at a time; each rolls back on its own error):
--   --   insert into public.project_links (a_id, b_id)
--   --   select id, id from public.survey_projects limit 1;              -- not_self
--   --   insert into public.project_links (a_id, b_id)
--   --   select greatest(a.id, b.id), least(a.id, b.id)
--   --     from public.survey_projects a, public.survey_projects b
--   --    where a.id <> b.id limit 1;                                    -- canonical_order
--
-- TO UNDO:
--   drop table if exists public.project_links;
