# Supabase Setup

## 1. Create a Supabase project
Go to supabase.com → New Project → Name: survey-ops-tracker → save your database password.

## 2. Get your API keys
Project Settings → API → copy:
- Project URL → NEXT_PUBLIC_SUPABASE_URL
- anon public → NEXT_PUBLIC_SUPABASE_ANON_KEY  
- service_role → SUPABASE_SERVICE_ROLE_KEY

## 3. Create .env.local
Copy .env.local.example to .env.local and fill in your Supabase values.

## 4. Run migrations
In Supabase dashboard → SQL Editor → run each file in order:
1. supabase/migrations/001_team_members.sql
2. supabase/migrations/002_survey_projects.sql
3. supabase/migrations/003_rls_policies.sql

## 5. Create your user
Supabase dashboard → Authentication → Users → Add User:
- Email: david@alpharoc.ai
- Set a secure password

## 6. Add team members
After logging into the app, add team member records in the Team Members table via the Supabase Table Editor.
