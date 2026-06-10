-- Slack channel link per project
alter table public.survey_projects
  add column if not exists slack_channel_url text;
