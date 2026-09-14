-- 111: let sales see HOW OLD "N collected" is, without letting them read the log.
--
-- David, 2026-09-14: "you should add a small note in the sales view for when the
-- N collected was last updated so they understand how current the numbers are."
-- Right, and the measurement is worse than a staleness problem:
--
--   Of the 30 surveys in field on 2026-09-14, only 12 have ever recorded an
--   n_collected change. The other 18 have NO history at all. Among the 12 the
--   numbers are fresh — median 2 days old, oldest 11, none past 30.
--
-- So the common case is not "this number is stale", it is "this number has never
-- been touched since the row was created". A survey showing 0 of 400 with no
-- history is not behind; it is UNMEASURED, and those are opposite things to tell
-- a salesperson. The UI can only draw that distinction if it can see the absence,
-- which is what this view exposes.
--
-- ── WHY A VIEW AND NOT A DIRECT READ ────────────────────────────────────────
-- project_audit is on the sales DENY list in lib/auth/tierSurface.ts, for a
-- reason this migration must not undo: 2,463 of its 10,982 rows carry a
-- restricted value as plain text in old_value/new_value. `actual_spend` alone is
-- 1,908 of them, in the literal form "null" -> "50001.00", and n_internal_target
-- another 107. Granting sales any row-level access to that table hands over
-- spend and internal targets in the same breath.
--
-- This view therefore exposes exactly two things — a project id and a timestamp.
-- No field name, no old_value, no new_value, no changed_by. A timestamp cannot
-- leak a dollar amount. It is filtered to field = 'n_collected' inside the view,
-- so the caller cannot widen it to another field by adding a qual.
--
-- Same mechanism as 102 and 105, deliberately: definer view (NOT
-- security_invoker) so it reads past project_audit's RLS, `security_barrier` so
-- a caller-supplied qual cannot be pushed below the scoping, an explicit column
-- allowlist, and the scope re-derived from sales_projects so a survey outside
-- the salesperson's book is invisible here too.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, no data change.
--
-- SHIPS WITH THE PAGE THAT READS IT (/sales/home). Applying it early is safe —
-- nothing reads it until that page deploys.
begin;

drop view if exists public.sales_n_collected_freshness;

create view public.sales_n_collected_freshness
with (security_barrier) as
select
  a.project_id,
  max(a.changed_at) as last_updated
from public.project_audit a
where a.field = 'n_collected'
  -- Scope re-derived rather than assumed. sales_projects already encodes both
  -- arms of the ownership rule (093's salesperson match and 100's account
  -- match); repeating them here would be a second copy free to drift.
  and exists (select 1 from public.sales_projects p where p.id = a.project_id)
group by a.project_id;

comment on view public.sales_n_collected_freshness is
  'When N collected was last changed, per survey, for the sales tier. Two columns '
  'on purpose: project_audit carries spend and internal targets as plain text in '
  'old_value/new_value and is denied to sales. A missing row means N collected has '
  'never been updated — which is NOT the same as being zero.';

-- Same two lines as 102 and 105, and the revoke is not ceremonial: Supabase's
-- default privileges on `public` hand a newly created object to `anon` as well,
-- so a view created without it is readable by an unauthenticated caller.
grant select on public.sales_n_collected_freshness to authenticated;
revoke all on public.sales_n_collected_freshness from anon;

commit;

-- VERIFY AS ALEX, with a real user JWT (scripts/_alex-link.mjs mints one):
--
--   1. The base table stays shut:
--        GET /rest/v1/project_audit?select=id                  -> []
--      Anything else means a policy grants sales the log itself.
--
--   2. The restricted columns are GONE from the view, not null:
--        GET /rest/v1/sales_n_collected_freshness?select=new_value -> 42703
--        GET /rest/v1/sales_n_collected_freshness?select=field     -> 42703
--
--   3. It is scoped, not global. Compare against his own book:
--        GET /rest/v1/sales_n_collected_freshness?select=project_id
--      must be a subset of
--        GET /rest/v1/sales_projects?select=id
