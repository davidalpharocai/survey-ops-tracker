-- Add "Hold" as a project status
alter type public.project_status add value if not exists 'Hold';
