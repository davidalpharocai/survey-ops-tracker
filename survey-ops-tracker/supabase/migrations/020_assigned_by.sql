-- Record WHO made a captain assignment, so the NEW! badge only shows for
-- assignments made by someone else (not your own).
alter table public.survey_projects
  add column if not exists captain_assigned_by uuid;

create or replace function public.stamp_captain_assignment()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.captain_id is not null)
     or (tg_op = 'UPDATE' and new.captain_id is distinct from old.captain_id and new.captain_id is not null) then
    new.captain_assigned_at := now();
    new.captain_assigned_by := auth.uid();  -- null for system/import paths
  end if;
  return new;
end;
$$ language plpgsql;
