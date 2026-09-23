-- 118: two things a salesperson asked to see, and could not.
--
-- David, 2026-09-17, on the sales survey screen: "it should also include the
-- captain" and "once the survey is delivered, they should be able to see
-- deliverables attached to the survey".
--
-- BOTH ARE DISCLOSURE DECISIONS, not conveniences. 102's own comment says so:
-- "Adding a column here makes it visible to every salesperson." So each is
-- stated below with what it reveals and what it deliberately still withholds.
--
--   CAPTAIN — reveals which internal colleague ran the study, by name and
--   initials. Sales already see `salesperson` (a colleague's name) on the same
--   row, and the captain is the person a salesperson would otherwise get by
--   asking in Slack. team_members carries `email`, which is NOT exposed: the
--   screen needs a name, and an address is the part that leaves the building.
--
--   DELIVERABLES — reveals that a file exists, its name, type, size and when it
--   was filed, plus the link. It does NOT expose how it arrived: `email_from`,
--   `forwarded_by`, `gmail_message_id`, `email_subject`, `match_confidence`,
--   `match_method` and `match_candidates` all stay behind. Those describe our
--   intake pipeline and the judgement it made, which is not the client's
--   business and not the salesperson's either. Rows in `review`, `duplicate` and
--   `unsorted` are excluded: a file still being triaged has not been attached to
--   anything yet, and showing one as a survey's deliverable would be a claim we
--   have not made. Soft-deleted rows are excluded too.
--
--   The link is `drive_file_id` / `source_url`. It is not a bearer token —
--   Google still authorises the open — so a salesperson without Drive access
--   gets Google's own refusal rather than the file.
--
-- ORDER: sales_n_collected_freshness (111) selects FROM sales_projects, so the
-- dependent view must be dropped first and rebuilt after, unchanged. Doing this
-- with `drop ... cascade` instead would drop it silently and leave the sales
-- survey screen without its "last updated" line, with nothing in the log to say
-- why.

begin;

-- ---------------------------------------------------------------------------
-- 1) sales_projects, plus the captain.
-- ---------------------------------------------------------------------------
drop view if exists public.sales_n_collected_freshness;
drop view if exists public.sales_projects;

create view public.sales_projects
with (security_barrier) as
select
  p.id, p.project_code, p.project_name, p.client, p.client_id,
  p.project_type, p.category, p.objective,
  p.phase, p.status, p.scoping_stage, p.board_column,
  p.submitted_date, p.launch_date, p.due_date, p.deliver_date, p.delivered_at,
  p.created_at, p.updated_at,
  p.n_target, p.n_target_max, p.n_collected, p.n_actual,
  p.credits, p.term_id,
  p.requested_by_name, p.requested_by_contact_id, p.salesperson,
  p.longitudinal, p.rerun_date, p.rerun_number, p.series_id, p.wave_order,
  -- 118. Name and initials only; team_members.email stays out.
  --
  -- AND THE PARENTHETICAL IS STRIPPED. Two of the ten team_members rows store
  -- their name as "Alden Levy (former employee)" and "Caitlin N. (former
  -- employee)" — an internal bookkeeping annotation someone typed into a name
  -- field. Between them they captain 76 live surveys, so passing tm.name
  -- through unchanged would put that string on a sales screen, and from there
  -- into a sentence a salesperson says to a client. The suffix is not part of
  -- anyone's name.
  --
  -- The FACT is still exposed, as its own boolean, because it is genuinely
  -- useful — it answers "can I still ask this person?" — and because hiding it
  -- entirely would have the sales view quietly assert that someone who has left
  -- is available. What is removed is the leak of our internal annotation
  -- format, not the information.
  nullif(btrim(regexp_replace(tm.name, '\s*\([^)]*\)\s*$', '')), '') as captain_name,
  tm.initials as captain_initials,
  (tm.name ~* '\(former') as captain_former
from public.survey_projects p
-- LEFT join: 118 must not change which ROWS a salesperson sees, only which
-- columns. An inner join would silently drop every survey with no captain
-- assigned, which is a scoping change wearing a join's clothes.
left join public.team_members tm on tm.id = p.captain_id
where public.my_role() = 'sales'
  and p.deleted_at is null
  and (
    -- 093's arm: the project names me as its salesperson.
    (p.salesperson is not null and p.salesperson = public.my_salesperson_name())
    -- 100's arm: I own the account the project belongs to.
    or exists (
      select 1 from public.clients c
       where c.id = p.client_id
         and c.deleted_at is null
         and c.salesperson = public.my_salesperson_name()
    )
  );

comment on view public.sales_projects is
  'Column-restricted, self-scoped projection of survey_projects for the sales tier. A definer view (NOT security_invoker) so it reads past the base table RLS, with security_barrier so a caller-supplied qual cannot be pushed below its scoping. This is the ONLY path a sales session has to project rows: migration 102 dropped both survey_projects sales policies. 118 added captain_name/captain_initials (never the captain''s email). Adding a column here makes it visible to every salesperson — treat it as a disclosure decision, not a convenience.';

-- DROP+CREATE resets the ACL to EXECUTE/SELECT TO PUBLIC. 095 shipped that hole
-- on a write RPC and 096 had to close it in a hurry; do not rely on the default.
grant select on public.sales_projects to authenticated;
revoke all on public.sales_projects from anon;

-- ---------------------------------------------------------------------------
-- 2) Rebuild 111's view, byte-for-byte in meaning.
-- ---------------------------------------------------------------------------
create view public.sales_n_collected_freshness
with (security_barrier) as
select
  a.project_id,
  max(a.changed_at) as last_updated
from public.project_audit a
where a.field = 'n_collected'
  and exists (select 1 from public.sales_projects p where p.id = a.project_id)
group by a.project_id;

comment on view public.sales_n_collected_freshness is
  'When N collected was last changed, per survey, for the sales tier. Two columns '
  'on purpose: project_audit carries spend and internal targets as plain text in '
  'old_value/new_value and is denied to sales. A missing row means N collected has '
  'never been updated — which is NOT the same as being zero.';

grant select on public.sales_n_collected_freshness to authenticated;
revoke all on public.sales_n_collected_freshness from anon;

-- ---------------------------------------------------------------------------
-- 3) sales_deliverables.
-- ---------------------------------------------------------------------------
drop view if exists public.sales_deliverables;

create view public.sales_deliverables
with (security_barrier) as
select
  d.id,
  d.project_id,
  d.kind,
  d.file_name,
  d.mime_type,
  d.size_bytes,
  d.source_url,
  d.drive_file_id,
  coalesce(d.filed_at, d.created_at) as filed_at
from public.deliverables d
where d.deleted_at is null
  and d.status = 'filed'
  -- Scope re-derived through sales_projects, exactly as 111 does, so there is
  -- one copy of the ownership rule and it cannot drift.
  and exists (select 1 from public.sales_projects p where p.id = d.project_id);

comment on view public.sales_deliverables is
  'Filed deliverables for the sales tier, scoped through sales_projects (118). Carries what a file IS — name, kind, type, size, when it was filed, and the link — and deliberately not how it ARRIVED: email_from, forwarded_by, gmail_message_id, email_subject and the whole match_* group stay behind. Only status=''filed'' rows appear; a file still in review has not been attached to a survey yet.';

grant select on public.sales_deliverables to authenticated;
revoke all on public.sales_deliverables from anon;

-- ---------------------------------------------------------------------------
-- 4) Assert, inside the transaction, so a failure rolls the whole thing back
--    rather than leaving the sales tier with a half-built view.
-- ---------------------------------------------------------------------------
do $check$
declare n int;
begin
  -- The captain columns exist.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'sales_projects'
     and column_name in ('captain_name', 'captain_initials', 'captain_former');
  if n <> 3 then raise exception '118: sales_projects is missing the captain columns (found %)', n; end if;

  -- And no captain name still carries the internal annotation. Asserted rather
  -- than trusted, because the regexp is the whole protection and a typo in it
  -- fails silently — the column would simply keep the suffix.
  select count(*) into n
    from public.team_members tm
   where nullif(btrim(regexp_replace(tm.name, '\s*\([^)]*\)\s*$', '')), '') ~* 'former';
  if n <> 0 then raise exception '118: % captain name(s) still read "(former…)" after stripping', n; end if;

  -- And the email did NOT come along for the ride.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'sales_projects'
     and column_name in ('captain_email', 'email');
  if n <> 0 then raise exception '118: sales_projects exposes an email column'; end if;

  -- The dependent view came back.
  if not exists (select 1 from information_schema.views
                  where table_schema = 'public' and table_name = 'sales_n_collected_freshness')
  then raise exception '118: sales_n_collected_freshness was not rebuilt'; end if;

  -- None of the intake columns leaked into the deliverables view.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'sales_deliverables'
     and column_name in ('email_from', 'email_subject', 'forwarded_by', 'gmail_message_id',
                         'match_confidence', 'match_method', 'match_candidates', 'filed_by');
  if n <> 0 then raise exception '118: sales_deliverables exposes % intake column(s)', n; end if;

  -- anon holds nothing on any of the three.
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and table_name in ('sales_projects', 'sales_n_collected_freshness', 'sales_deliverables');
  if n <> 0 then raise exception '118: anon still holds % grant(s)', n; end if;
end $check$;

commit;

-- The views changed SHAPE, so PostgREST's cached schema would otherwise answer
-- "column sales_projects.captain_name does not exist" to the next request.
notify pgrst, 'reload schema';

-- VERIFY AS ALEX, with a real user JWT (scripts/_alex-link.mjs mints one) —
-- these are for reading, not for trusting; the asserts above already ran:
--
--   GET /rest/v1/sales_projects?select=id,captain_name,captain_initials&limit=3
--     -> 200, names present on captained rows, null on the rest.
--
--   GET /rest/v1/sales_projects?select=id,n_internal_target                 -> 400
--   GET /rest/v1/sales_projects?select=id,budget                            -> 400
--   GET /rest/v1/sales_projects?select=id,actual_spend                      -> 400
--     Still 400. 118 must not have widened the column list beyond the captain.
--
--   GET /rest/v1/sales_deliverables?select=*&limit=3                        -> 200
--   GET /rest/v1/deliverables?select=id                                     -> []
--     The base table stays shut; only the view answers.
--
--   Row counts must be unchanged by the LEFT join:
--     select count(*) from sales_projects;   -- same as before 118
