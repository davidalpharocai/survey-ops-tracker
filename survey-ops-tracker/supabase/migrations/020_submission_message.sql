-- Optional note from the analyst to the compliance reviewer, shown in the
-- notification email and on the review page.
alter table public.question_submissions add column analyst_message text;
