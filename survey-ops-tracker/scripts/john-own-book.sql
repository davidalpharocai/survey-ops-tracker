-- John Farrall gets his own book, 2026-09-28.
--
-- David: "john's access: john will eventually have his own book vs a supporting
-- role for Alex. so lets actually change his permission to be just like how
-- Jenna or alex are CURRENTLY where they can only see their own book."
--
-- That is exactly what migration 121 said to do on this day; it is the second
-- half of a change that shipped deliberately incomplete:
--
--   "When he has accounts of his own: set his sees_book_of to null, add him to
--    SALESPEOPLE in lib/utils/salespeople.ts, and assign his projects."
--
-- The code half is done (lib/utils/salespeople.ts now lists him, so he can be
-- picked as the sales lead on a project and his email resolves to his name).
-- This is the data half.
--
-- ── READ THIS BEFORE RUNNING IT ─────────────────────────────────────────────
-- MEASURED 2026-09-28: no survey in the database names John Farrall. Alex has
-- 217, Jenna 68, Vineet 23. The moment sees_book_of is null, John's book is his
-- own and his book is EMPTY — /sales/home will correctly say there is nothing
-- on his accounts, and /sales/surveys will be blank, until somebody sets him as
-- the sales lead on real projects.
--
-- Nothing here breaks and nothing is lost: re-pointing him at Alex is one
-- UPDATE away (the last line of this file, commented out). But if he is being
-- shown the app before any account is his, run this AFTER those are assigned
-- rather than before.
--
-- Nobody else is touched. sees_book_of is already null for Alex, Jenna, Vineet,
-- Shanu and Steven, so coalesce() in my_salesperson_name() has always returned
-- their own name — the assertion at the bottom checks that it still does.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable, reversible.
begin;

update public.salespeople
   set sees_book_of = null,
       note = 'Started 2026-09-28. Works his own book, same as Alex and Jenna. '
              'Assign him as sales lead on his accounts — until then his book is empty.'
 where lower(email) = 'john@alpharoc.ai';

do $check$
declare n int; who text;
begin
  -- He exists, is active, and now sees his own book.
  select count(*) into n from public.salespeople
   where lower(email) = 'john@alpharoc.ai' and active and sees_book_of is null;
  if n <> 1 then
    raise exception 'john-own-book: expected 1 active John row with no delegation, found %', n;
  end if;

  -- And the function that every sales view scopes through now answers with HIS
  -- name. This is the line that actually changes what he can read, so it is
  -- asserted rather than assumed.
  select coalesce(s.sees_book_of, s.canonical_name) into who
    from public.salespeople s where lower(s.email) = 'john@alpharoc.ai' and s.active;
  if who is distinct from 'John Farrall' then
    raise exception 'john-own-book: my_salesperson_name() would return %, not John Farrall', who;
  end if;

  -- Nobody else was delegated by accident.
  select count(*) into n from public.salespeople where sees_book_of is not null;
  if n <> 0 then
    raise exception 'john-own-book: % salespeople still point at someone else''s book', n;
  end if;
end $check$;

commit;

-- VERIFY (reading, not trusting; the asserts above already ran):
--   select email, canonical_name, active, sees_book_of from public.salespeople order by canonical_name;
--   -- every sees_book_of null.
--
--   select count(*) from public.survey_projects
--    where deleted_at is null and salesperson = 'John Farrall';
--   -- 0 today. This is the number that has to grow before his screens show work.
--
-- TO PUT HIM BACK ON ALEX'S BOOK:
--   update public.salespeople set sees_book_of = 'Alex Pinsky'
--    where lower(email) = 'john@alpharoc.ai';
