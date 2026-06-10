create type public.submission_status as enum ('pending_review', 'approved', 'rejected');
create type public.question_type as enum ('open_text', 'single_select', 'multi_select', 'scale', 'other');
create type public.recipient_role as enum ('alpharoc', 'compliance');

create table public.question_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  version integer not null,
  status public.submission_status not null default 'pending_review',
  source_file_name text not null,
  source_file_path text not null,
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz default now(),
  unique (project_id, version)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.question_submissions(id) on delete cascade,
  order_num integer not null,
  text text not null,
  type public.question_type not null default 'other',
  is_open_text boolean not null default false,
  is_ai_followup boolean not null default false,
  section text,
  answer_options jsonb not null default '[]'
);

create table public.project_recipients (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.survey_projects(id) on delete cascade,
  email text not null,
  name text,
  role public.recipient_role not null,
  created_at timestamptz default now(),
  unique (project_id, email, role)
);

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.question_submissions(id) on delete set null,
  recipient_email text not null,
  template text not null,
  resend_id text,
  sent_at timestamptz default now()
);

create index questions_submission_idx on public.questions (submission_id, order_num);
create index submissions_project_idx on public.question_submissions (project_id, version desc);
