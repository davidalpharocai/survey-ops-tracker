-- Data fix, 2026-09-28: 24 legacy surveys that were closed without ever reaching
-- the Delivered column.
--
-- David's rule (2026-09-28): work from before 27 May 2026 is historical and
-- counts as delivered; anything created after that he reviews by hand. The three
-- post-cutoff rows (PR00355, PR00356, PR00458) are in the Excel he was sent and
-- are deliberately NOT touched here.
--
-- Why these 24 are the pre-cutoff set: every one of them arrived in the 10 June
-- 2026 legacy sheet import and carries no date of any kind — no submitted date,
-- no due date, no deliver date, no blast or launch date. Their `created_at` is
-- the import timestamp, not when the work happened, so it cannot answer the
-- question; the sheet import and the low project codes are what date them.
--
-- No deliver date is invented: they become undated deliveries, which Insights
-- already counts and reports separately. Status stays Closed, which is what the
-- Delivered column already means for every other row (0 exceptions today).
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable: the WHERE
-- clause skips rows already on Delivery.
begin;

update public.survey_projects
   set board_column = 'Delivery'
 where deleted_at is null
   and status = 'Closed'
   and board_column <> 'Delivery'
   and project_code in (
     'PR00037', 'PR00047', 'PR00056', 'PR00058', 'PR00061', 'PR00064',
     'PR00081', 'PR00084', 'PR00099', 'PR00103', 'PR00104', 'PR00107',
     'PR00108', 'PR00109', 'PR00110', 'PR00114', 'PR00118', 'PR00124',
     'PR00134', 'PR00138', 'PR00154', 'PR00155', 'PR00168', 'PR00173');

do $check$
declare n int;
begin
  -- All 24 landed.
  select count(*) into n from public.survey_projects
   where deleted_at is null
     and project_code in (
       'PR00037', 'PR00047', 'PR00056', 'PR00058', 'PR00061', 'PR00064',
       'PR00081', 'PR00084', 'PR00099', 'PR00103', 'PR00104', 'PR00107',
       'PR00108', 'PR00109', 'PR00110', 'PR00114', 'PR00118', 'PR00124',
       'PR00134', 'PR00138', 'PR00154', 'PR00155', 'PR00168', 'PR00173')
     and (board_column <> 'Delivery' or status <> 'Closed');
  if n <> 0 then
    raise exception 'closed-not-delivered: % of the 24 did not land on Delivery as Closed', n;
  end if;

  -- And nothing else moved: the only closed-but-not-delivered rows left are the
  -- three David is reviewing.
  select count(*) into n from public.survey_projects
   where deleted_at is null and status = 'Closed' and board_column <> 'Delivery';
  if n <> 3 then
    raise exception 'closed-not-delivered: expected 3 left for review, found %', n;
  end if;
end $check$;

commit;

-- VERIFY (reading, not trusting; the asserts above already ran):
--   select board_column, count(*) from public.survey_projects
--    where deleted_at is null and status = 'Closed' group by 1 order by 2 desc;
--   -- expect Delivery 361, and the three review rows on their own stages.
