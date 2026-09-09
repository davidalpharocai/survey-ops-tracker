-- 109: stop external compliance reviewers reading our sales roster.
--
-- Found by scripts/check-tier-surface.mjs the first time it ran, which is the
-- entire argument for having written it.
--
-- 093 created the policy as `for select to authenticated using (true)` — every
-- signed-in user, and the compliance tier is signed-in users who do not work
-- here. Verified with eric.albert@holoceneadvisors.com's own JWT:
--
--   GET /rest/v1/salespeople?select=*
--   -> 5 rows, including
--      {"email":"vineet@alpharoc.ai","canonical_name":"Vineet Kapur",
--       "note":"COO; also sells. ~21 projects."}
--      {"email":"alex@alpharoc.ai", "note":"Salesperson on ~160 projects."}
--
-- So a contact at a client firm can read our commercial staffing, everyone's
-- work email, and a per-person project count that says how much business each
-- one carries. None of it is catastrophic on its own; all of it is ours.
--
-- WHY `true` WAS WRITTEN. 093's own comment explains it: my_salesperson_name()
-- is SECURITY DEFINER and reads this table on the policy's behalf, so the READ
-- policy exists only for the app. At the time the app meant analysts, and the
-- compliance tier's separate existence was not in view. The definer function is
-- unaffected by this change — it bypasses RLS by design — so scoping the direct
-- read breaks nothing that depends on it.
--
-- WHO STILL NEEDS IT DIRECTLY:
--   analyst — the salesperson dropdown on a project, and the board filter.
--   sales   — lib/sales-auth.ts mySalespersonName() reads it AS THE USER, on
--             purpose, so the name on screen and the name RLS filters by come
--             from one place and cannot disagree.
--   compliance — nothing. The portal reads portal_projects, questions,
--             question_submissions, questionnaires and profiles, and none of
--             them touch this table.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, no data change.
begin;

drop policy if exists salespeople_read on public.salespeople;
create policy salespeople_read on public.salespeople
  for select to authenticated
  using (public.my_role() in ('analyst', 'sales'));

comment on table public.salespeople is
  'Canonical salesperson names and the email each maps to — the identity RLS keys on (093). Readable by analysts and the sales tier only: 109 removed the `using (true)` that let external compliance reviewers read the roster and its per-person project notes. my_salesperson_name() is SECURITY DEFINER and reads it regardless, so policies that call it are unaffected.';

commit;

-- VERIFY as an external reviewer — scripts/check-tier-surface.mjs asserts this:
--   GET /rest/v1/salespeople?select=*  as eric.albert@holoceneadvisors.com -> []
--   GET /rest/v1/salespeople?select=*  as alex@alpharoc.ai                 -> 5 rows
