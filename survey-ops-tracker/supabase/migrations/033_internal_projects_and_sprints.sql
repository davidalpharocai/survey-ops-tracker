-- Internal project type + Sprints (see docs/superpowers/specs/2026-06-15-internal-projects-and-sprints-design.md)
-- ALTER TYPE ADD VALUE is safe here because the new values aren't USED elsewhere
-- in this script. Run the whole file in the Supabase SQL editor.

alter type public.project_type add value if not exists 'Internal';

alter type public.board_column add value if not exists 'Backlog';
alter type public.board_column add value if not exists 'In Progress';
alter type public.board_column add value if not exists 'Review';
alter type public.board_column add value if not exists 'Done';

alter table public.survey_projects
  add column if not exists category text,
  add column if not exists objective text,
  add column if not exists sprint_number integer;

-- Central sprint cadence: one row, anchor = start of Sprint 1, length in days.
-- Sprint N spans anchor + (N-1)*length for `length` days; so "Sprint 15" means
-- the same dates for everyone.
create table if not exists public.sprint_config (
  id int primary key default 1,
  anchor_date date not null,
  length_days int not null default 14,
  constraint sprint_config_singleton check (id = 1)
);

insert into public.sprint_config (id, anchor_date, length_days)
  values (1, date_trunc('week', current_date)::date, 14)
  on conflict (id) do nothing;

alter table public.sprint_config enable row level security;
create policy "analysts read sprint config" on public.sprint_config
  for select to authenticated using (public.my_role() = 'analyst');
create policy "analysts write sprint config" on public.sprint_config
  for all to authenticated using (public.my_role() = 'analyst') with check (public.my_role() = 'analyst');
create policy "service role sprint config" on public.sprint_config
  for all to service_role using (true);
