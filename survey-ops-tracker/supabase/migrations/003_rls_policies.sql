alter table public.team_members enable row level security;
alter table public.survey_projects enable row level security;

create policy "authenticated users can read team members"
  on public.team_members for select
  to authenticated using (true);

create policy "authenticated users can read projects"
  on public.survey_projects for select
  to authenticated using (true);

create policy "authenticated users can insert projects"
  on public.survey_projects for insert
  to authenticated with check (true);

create policy "authenticated users can update projects"
  on public.survey_projects for update
  to authenticated using (true);

create policy "service role full access projects"
  on public.survey_projects for all
  to service_role using (true);
