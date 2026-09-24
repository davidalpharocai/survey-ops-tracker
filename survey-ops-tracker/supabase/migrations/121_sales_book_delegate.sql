-- 121: one salesperson can work another salesperson's book.
--
-- WHY. John Farrall starts on Monday 2026-09-28. David, 2026-09-24: "for now,
-- John Farrall ... should have access to any record associated with Alex's
-- book. so for now when he signs into sales view it will be the same as alex's
-- but his own login."
--
-- HOW, AND WHY THIS WAY. Every sales-tier policy and view (093, 100, 102, 105,
-- 118) scopes rows with `salesperson = public.my_salesperson_name()`. So the
-- smallest change that makes John see exactly Alex's rows, everywhere at once,
-- is to change what that ONE function answers for John: his own row says whose
-- book he works, and the function returns that name instead of his. No view or
-- policy is rewritten, so none of them can be rewritten wrong, and anything
-- added later that uses the function inherits the behaviour for free.
--
-- The alternative (copy Alex's name onto John's row) was rejected: canonical
-- names are unique, the nav and the PDFs would call John "Alex Pinsky", and the
-- day John gets his own accounts the two would have to be untangled.
--
-- WHAT JOHN DOES NOT GET. His own name. While sees_book_of is set he sees Alex's
-- book and ONLY Alex's book: a project tagged "John Farrall" would not appear to
-- him. That is why John is not added to the project dropdown in this change.
-- When he has accounts of his own: set his sees_book_of to null, add him to
-- SALESPEOPLE in lib/utils/salespeople.ts, and assign his projects.
--
-- WHAT THIS DOES NOT CHANGE. Alex, Jenna and everyone else: sees_book_of is
-- null for them, so coalesce() returns their own name exactly as before. The
-- assertions at the bottom check that.
--
-- ORDER MATTERS. Run this BEFORE inviting John. 085 made an unlisted
-- @alpharoc.ai signup land as a full ANALYST (every budget, every price); the
-- profile_provisioning row below is what makes his account land as sales.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
begin;

-- The pointer. A foreign key to the unique canonical name, so it cannot name
-- somebody who does not exist. ON DELETE SET NULL fails closed: if the owner row
-- ever went, John would fall back to his own (empty) book, not to everything.
alter table public.salespeople
  add column if not exists sees_book_of text
    references public.salespeople(canonical_name)
    on update cascade on delete set null;

alter table public.salespeople drop constraint if exists salespeople_book_not_self;
alter table public.salespeople add constraint salespeople_book_not_self
  check (sees_book_of is null or sees_book_of <> canonical_name);

comment on column public.salespeople.sees_book_of is
  'Whose book this person works. Null (the normal case) means their own. When set, my_salesperson_name() returns THIS name, so every sales view shows that person the named book instead of their own. One level only: it is not followed a second time.';

-- Same signature, same security definer and search_path as 093. CREATE OR
-- REPLACE, not drop and create, so the grants below are preserved rather than
-- reset to PUBLIC; they are re-issued anyway.
create or replace function public.my_salesperson_name()
returns text language sql stable security definer set search_path = public as
$$
  select coalesce(s.sees_book_of, s.canonical_name)
    from public.salespeople s
   where lower(s.email) = lower(coalesce(auth.email(), ''))
     and s.active
$$;
revoke execute on function public.my_salesperson_name() from anon, public;
grant execute on function public.my_salesperson_name() to authenticated;

-- John. Address confirmed against the AlphaROC Slack directory 2026-09-24.
insert into public.salespeople (email, canonical_name, active, note, sees_book_of)
values (
  'john@alpharoc.ai', 'John Farrall', true,
  'Starts 2026-09-28. Works the Alex Pinsky book for now: same view as Alex, own login. Clear sees_book_of when he has accounts of his own.',
  'Alex Pinsky'
)
on conflict (email) do update
  set canonical_name = excluded.canonical_name,
      active         = excluded.active,
      note           = excluded.note,
      sees_book_of   = excluded.sees_book_of;

-- The tier his account is created at. Without this row, the invite makes him an
-- analyst.
insert into public.profile_provisioning (email, role, note, added_by)
values (
  'john@alpharoc.ai', 'sales',
  'John Farrall - sales, starts 2026-09-28. Pre-registered so the invite lands at the sales tier, not as a full analyst.',
  'david@alpharoc.ai'
)
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note;

-- If John was invited BEFORE this ran, his account already exists as an analyst.
-- Put it where it belongs. Zero rows on the expected path.
update public.profiles
   set role = 'sales'
 where lower(email) = 'john@alpharoc.ai'
   and role is distinct from 'sales';

-- Prove it, inside the transaction, so a failure rolls everything back.
do $check$
declare v_john text; v_alex text; v_tier text; v_others int;
begin
  select coalesce(sees_book_of, canonical_name) into v_john
    from public.salespeople where email = 'john@alpharoc.ai' and active;
  if v_john is distinct from 'Alex Pinsky' then
    raise exception '121: John resolves to %, expected Alex Pinsky', v_john;
  end if;

  select coalesce(sees_book_of, canonical_name) into v_alex
    from public.salespeople where email = 'alex@alpharoc.ai' and active;
  if v_alex is distinct from 'Alex Pinsky' then
    raise exception '121: Alex now resolves to %, expected his own name', v_alex;
  end if;

  select count(*) into v_others
    from public.salespeople
   where email <> 'john@alpharoc.ai' and sees_book_of is not null;
  if v_others <> 0 then
    raise exception '121: % other salespeople point at a book that is not theirs', v_others;
  end if;

  select role::text into v_tier
    from public.profile_provisioning where email = 'john@alpharoc.ai';
  if v_tier is distinct from 'sales' then
    raise exception '121: John is provisioned as %, expected sales', v_tier;
  end if;
end $check$;

commit;

notify pgrst, 'reload schema';
