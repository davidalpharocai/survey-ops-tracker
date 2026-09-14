-- 113: mark demo and scratch accounts so reporting can leave them out.
--
-- David, 2026-09-14: "PR00300 is a demo record and should always be excluded
-- from metrics, reporting, and everything in between."
--
-- PR00300 "Demo Survey" carries n_collected 200 and actual_spend $3,460 against
-- the AlphaRoc Demo Client, and it has been quietly inside every company-wide
-- figure this system produces — the reconciliation gap, cost per complete,
-- spend by client, all of it. It is also the project the guide-screenshot
-- pipeline drives, so it must stay usable in the app. Excluded from counting,
-- not removed.
--
-- ── ON THE CLIENT, NOT THE PROJECT ──────────────────────────────────────────
-- The thing that is fake is the ACCOUNT. Flagging the one project would leave
-- the next demo survey created under the same client to be found by hand, which
-- is how PR00300 stayed in the numbers this long.
--
-- ── AND NOT BY NAME ─────────────────────────────────────────────────────────
-- The obvious shortcut is to match names against /demo|test/. I ran it: it
-- flags PR00320 "Democratic Party Message Testing" for Gingrich360 — a real
-- survey with 1,296 completes — because "Democratic" contains "demo" and the
-- title contains "Testing". A regex over free text is not a data model. The
-- flag is explicit and set once, here.
--
-- ── WHAT IS FLAGGED ─────────────────────────────────────────────────────────
--   AlphaRoc Demo Client (Cl00245)  1 project, PR00300 — the demo record
--   ZZZ MERGE TEST — delete me      0 projects — scratch from merge testing
--   Test / Dummy Account            0 projects — scratch
--
-- "Better Choices for Democracy" is NOT flagged. It matches /demo/ on
-- "Democracy" and is a real account with a real name.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, additive.
begin;

alter table public.clients
  add column if not exists is_demo boolean not null default false;

comment on column public.clients.is_demo is
  'Demo, scratch or test account. Its projects are real rows the app can open '
  'and edit, but they must be excluded from every metric, report and rollup — '
  'they are not business. Set deliberately per account; never inferred from the '
  'name, because "Democratic Party Message Testing" is a real survey.';

update public.clients
   set is_demo = true
 where code = 'Cl00245'                       -- AlphaRoc Demo Client
    or name in ('ZZZ MERGE TEST — delete me', 'Test / Dummy Account');

-- Reporting reads this instead of clients+survey_projects, so a caller cannot
-- forget the filter. Deliberately NOT restricted to one tier: it is the same
-- projects table with the fake accounts taken out.
create or replace view public.reportable_projects as
select p.*
  from public.survey_projects p
  left join public.clients c on c.id = p.client_id
 where p.deleted_at is null
   and coalesce(c.is_demo, false) = false;

comment on view public.reportable_projects is
  'survey_projects minus deleted rows and minus anything belonging to a demo or '
  'test account (clients.is_demo). Every metric, report and rollup should read '
  'THIS, not survey_projects — the filter belongs in one place rather than in '
  'each of the 20 call sites that aggregate.';

grant select on public.reportable_projects to authenticated;
revoke all on public.reportable_projects from anon;

-- 112's worklist should not be asking anyone to classify a demo blast either.
-- Redefined here rather than edited in 112, which is already applied.
create or replace view public.blast_channel_unknown as
select b.project_id, p.project_code, p.client, b.id as blast_id,
       b.note, b.people, b.cost_per_send,
       coalesce(b.people, 0) * coalesce(b.cost_per_send, 0) as send_cost_still_charged
  from public.project_blasts b
  join public.reportable_projects p on p.id = b.project_id
 where b.channel is null
 order by coalesce(b.people, 0) * coalesce(b.cost_per_send, 0) desc;

commit;

-- VERIFY (measured 2026-09-14, before applying):
--
--   select count(*) from public.clients where is_demo;            -- 3
--   select count(*) from public.survey_projects where deleted_at is null;  -- 401
--   select count(*) from public.reportable_projects;              -- 400
--
--   -- PR00300 is gone from reporting but still readable in the app:
--   select count(*) from public.reportable_projects where project_code = 'PR00300';  -- 0
--   select count(*) from public.survey_projects  where project_code = 'PR00300';     -- 1
--
--   -- and the real survey that a name-regex would have caught is untouched:
--   select count(*) from public.reportable_projects where project_code = 'PR00320';  -- 1
--
--   -- the channel worklist drops PR00300's blast: 21 -> 20, $1,526.80 -> $1,466.80
--   select count(*), sum(send_cost_still_charged) from public.blast_channel_unknown;
