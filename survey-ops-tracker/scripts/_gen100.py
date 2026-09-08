"""Append the audit-function splice and the sales RLS to migration 100.

The audit function is extracted from its live version VERBATIM and spliced,
rather than retyped — the discipline 087, 088, 094 and 095 all used, because
`create or replace` cannot patch a single statement inside a function body and a
hand-copied 110-line function is a drift waiting to happen.
"""
import io
import sys

MIG = 'supabase/migrations/'


def grab(path, header):
    src = io.open(path, encoding='utf-8').read()
    i = src.index(header)
    j = src.index('\nend $$;', i) + len('\nend $$;')
    return src[i:j]


def splice_after(body, anchor, new_lines, what):
    lines = body.split('\n')
    for k, ln in enumerate(lines):
        if anchor in ln:
            return '\n'.join(lines[:k + 1] + new_lines + lines[k + 1:])
    sys.exit('ANCHOR NOT FOUND (%s): %r' % (what, anchor))


# 095 holds the live audit_survey_project (it added audience_used... no — 094
# did; 095 rebuilt audit_project_blast). Find the newest definition.
import glob
cands = sorted(
    f for f in glob.glob(MIG + '*.sql')
    if 'create or replace function public.audit_survey_project()' in io.open(f, encoding='utf-8').read()
)
latest = cands[-1]
print('audit_survey_project newest definition:', latest)

audit = grab(latest, 'create or replace function public.audit_survey_project()')
audit = splice_after(
    audit,
    "audit_field(NEW.id, 'budget'",
    ["  perform audit_field(NEW.id, 'credits', OLD.credits::text, NEW.credits::text, actor);"],
    'credits')

# term_id is a uuid; log the TERM NAME, following the captain_id -> name and
# series_id -> series name precedent. A uuid in a history panel tells the reader
# nothing, and being readable later is the only reason to log it.
TERM = """
  -- 100: which credit pool this survey draws against. Resolved to the term's
  -- NAME rather than logged raw, following the captain_id and series_id
  -- precedent above: a uuid in the Logs tab is unreadable, and being able to
  -- read it later is the whole point of recording it. Behind an `is distinct
  -- from` guard so a no-op UPDATE writes nothing and the subquery only runs when
  -- the value actually moved — this trigger fires on every write to the table.
  if OLD.term_id is distinct from NEW.term_id then
    select name into old_term from public.client_terms where id = OLD.term_id;
    select name into new_term from public.client_terms where id = NEW.term_id;
    perform audit_field(NEW.id, 'term', coalesce(old_term, '—'), coalesce(new_term, '—'), actor);
  end if;
"""
audit = audit.replace('\n  return NEW;\nend $$;', TERM + '\n  return NEW;\nend $$;')

# Two more locals for the term lookup.
audit = audit.replace(
    '  old_root text;\n  new_root text;',
    '  old_root text;\n  new_root text;\n  old_term text;\n  new_term text;')

RLS = r'''
-- ---------------------------------------------------------------------------
-- 5) THE SALES SCOPE.
--
--    David: "a salesperson should only see their clients, contacts, and
--    surveys", and "all accounts have a sales person".
--
--    SCOPED BY ACCOUNT OWNERSHIP, not by the per-project salesperson field. That
--    is the important choice here and it fixes two real problems at once:
--      * 118 of 375 projects have NO salesperson, so the existing project-level
--        policy (093) silently hides 31% of the pipeline while looking correct.
--        CCM's Relationship Manager is populated on all 75 accounts, so scoping
--        through the account covers them without a per-project backfill.
--      * Seven clients are split across two reps, so a project-level rule means
--        neither rep ever sees the whole account. BNP alone has 15 projects
--        across Alex and Jenna.
--
--    The project policy is ADDITIVE — account-owned OR salesperson-matched — so
--    nothing a salesperson can see today disappears. 093's policy stays as-is
--    and this sits beside it; Postgres ORs multiple permissive policies.
--
--    SELECT ONLY, every one of them. The sales tier does not write, which is
--    also what makes admin "view as" genuinely read-only (099).
-- ---------------------------------------------------------------------------

-- My accounts.
drop policy if exists clients_sales_read on public.clients;
create policy clients_sales_read on public.clients
  for select to authenticated
  using (
    public.my_role() = 'sales'
    and deleted_at is null
    and salesperson is not null
    and salesperson = public.my_salesperson_name()
  );

-- The contacts at my accounts. client_contacts has no salesperson of its own and
-- should not get one: a contact belongs to an account, and the account has the
-- owner.
drop policy if exists client_contacts_sales_read on public.client_contacts;
create policy client_contacts_sales_read on public.client_contacts
  for select to authenticated
  using (
    public.my_role() = 'sales'
    and exists (
      select 1 from public.clients c
       where c.id = client_contacts.client_id
         and c.deleted_at is null
         and c.salesperson = public.my_salesperson_name()
    )
  );

-- The terms of my accounts. This is what the credits-consumption view reads.
alter table public.client_terms enable row level security;
revoke all on public.client_terms from anon, authenticated;
grant select on public.client_terms to authenticated;
grant all on public.client_terms to service_role;

drop policy if exists client_terms_analyst_all on public.client_terms;
create policy client_terms_analyst_all on public.client_terms
  for select to authenticated
  using (public.my_role() = 'analyst');

drop policy if exists client_terms_sales_read on public.client_terms;
create policy client_terms_sales_read on public.client_terms
  for select to authenticated
  using (
    public.my_role() = 'sales'
    and deleted_at is null
    and exists (
      select 1 from public.clients c
       where c.id = client_terms.client_id
         and c.deleted_at is null
         and c.salesperson = public.my_salesperson_name()
    )
  );

drop policy if exists client_terms_service_all on public.client_terms;
create policy client_terms_service_all on public.client_terms
  for all to service_role using (true) with check (true);

-- The surveys of my accounts. Additive beside 093's project-level policy.
drop policy if exists survey_projects_sales_account_read on public.survey_projects;
create policy survey_projects_sales_account_read on public.survey_projects
  for select to authenticated
  using (
    public.my_role() = 'sales'
    and deleted_at is null
    and exists (
      select 1 from public.clients c
       where c.id = survey_projects.client_id
         and c.deleted_at is null
         and c.salesperson = public.my_salesperson_name()
    )
  );
'''

p = MIG + '100_credits_and_accounts.sql'
s = io.open(p, encoding='utf-8').read()
marker = "-- (function body appended by scripts/_gen100.py — see the generated section)"
assert marker in s, 'marker missing'
s = s.replace(marker, audit + ';\n' + RLS)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

print('spliced audit + appended RLS')
print('  credits audited      :', "audit_field(NEW.id, 'credits'" in s)
print('  term audited by name :', "audit_field(NEW.id, 'term'" in s)
print('  policies added       :', s.count('create policy'))
print('  begin/commit         :', s.count('\nbegin;'), '/', s.count('\ncommit;'))
print('  dollar-quote tags    :', {t: s.count(t) for t in ('$$', '$chk$', '$chk2$')})
