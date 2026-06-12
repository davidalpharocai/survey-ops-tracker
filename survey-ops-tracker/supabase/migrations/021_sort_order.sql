-- Persisted card position: drops save a sort_order so the position survives
-- refetches, realtime echoes, and other users' views (no post-drop jumping)
alter table public.survey_projects
  add column if not exists sort_order double precision;

update public.survey_projects p
set sort_order = sub.rn * 1000
from (
  select id, row_number() over (order by created_at desc) as rn
  from public.survey_projects
) sub
where p.id = sub.id and p.sort_order is null;
