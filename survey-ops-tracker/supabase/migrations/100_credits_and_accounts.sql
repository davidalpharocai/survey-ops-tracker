-- 100: accounts get an owner, clients get terms, surveys get credits.
--
-- The foundation for the expanded sales view. Three things that do not exist
-- today and that every screen David asked for reads from.
--
-- WHY, in his words (2026-09-08):
--   "we'll need to assign credits or dollars to surveys so there needs to be a
--    field on surveys for that, and then a way to roll up usage towards a term
--    so the sales person can show credits consumption"
--   "a salesperson should only see their clients, contacts, and surveys"
--   "all accounts have a sales person"
--   "dont focus on the cost per credit. focus on the number of credits and ill
--    backfill the cost on a contract and client basis"
--
-- CREDITS ARE THE UNIT, NOT DOLLARS. That is CCM's own framing and David
-- confirmed it: credits are the billing unit and N is an output, not a cost
-- driver. So a survey carries a CREDIT count, and the dollar value of a credit
-- lives on the term/client where David will backfill it. There is deliberately
-- no global $/credit constant anywhere: the four hand-typed quotes in
-- latest_next_steps happen to work out at ~$200 ($7,000/35 exactly), but
-- hardcoding that would invent a rate the business has not agreed and would
-- restate every historical number the day it changed.
--
-- ============================================================================
-- WHAT IS NOT HERE, and why: A SECOND "CONSUMED" COLUMN.
--
-- Credits are entered ONCE, when scope is confirmed. Whether they have been
-- CONSUMED is not stored — it is derived from the survey's own stage, because a
-- survey that has fielded has drawn its credits. CCM's confirmed design
-- (2026-07-14) consumes at fielding, and SOCC already knows exactly when that
-- happened: stage_fielding, board_column, and project_stage_history.
--
-- Storing it twice would be the mistake this codebase keeps paying for. In the
-- last fortnight: audience_size meant two things for a year; a send fee recorded
-- both as a computed figure and a typed cost line double-charged PR00362 by
-- $1,876.70 and had me report an overspend that was my own arithmetic; and
-- getCheckboxesForColumn disagreed with its own inverse for months, leaving 10
-- rows contradicting themselves. A stored "consumed" flag that drifts from the
-- stage it is supposed to reflect is the same bug with a client-facing number
-- attached.
-- ============================================================================
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable. Adds no data —
-- the CCM import is a separate, reviewable script.
begin;

-- ---------------------------------------------------------------------------
-- 1) THE ACCOUNT OWNER.
--
--    TEXT matching salespeople.canonical_name, not a FK to profiles, and that is
--    deliberate: CCM's Relationship Manager column includes Steven Stubbs, who
--    has left and has no account, yet still owns two accounts historically.
--    survey_projects.salesperson already uses this exact convention (093 built
--    salespeople + my_salesperson_name() around it), so this is the same idea one
--    level up rather than a second one.
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists salesperson text;

comment on column public.clients.salesperson is
  'The account owner, as a canonical name matching public.salespeople.canonical_name. Imported from CCM''s "Relationship Manager", which is populated on all 75 accounts. This is what scopes the sales view: a salesperson sees their accounts, those accounts'' contacts and terms, and the surveys belonging to them.';

create index if not exists clients_salesperson_idx on public.clients (salesperson);

-- ---------------------------------------------------------------------------
-- 2) THE TERM — a client's credit pool over a period.
--
--    Modelled on CCM's `contract`, which is the same thing and has 48 rows and
--    46,085 credits to import. Named `client_terms` rather than `contracts`
--    because David consistently calls it a term, and because "contract" in this
--    business also means the signed document (CCM stores those as attachments).
--
--    credits_total is NUMERIC, not integer: CCM's confirmed pricing discounts
--    repeat waves (50% consumer / 15% B2B), and half of a 15-credit base is 7.5.
--
--    dollars_total is NULLABLE and is David's to backfill "on a contract and
--    client basis". Null means the credit value of this term is not recorded,
--    which is different from zero, and every reader must render it as unknown.
--
--    starts_on / renews_on are NULLABLE because they have to be: only 4 of CCM's
--    48 contracts carry both dates. A term with no period can still show
--    consumed-against-pool; it just cannot answer "this quarter".
-- ---------------------------------------------------------------------------
create table if not exists public.client_terms (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  name           text not null,
  credits_total  numeric,
  -- dollars_total deliberately does NOT live here — see section 2a. It is
  -- contract value, 085's view_financials covers exactly that, and RLS cannot
  -- hide a column from a row it admits.
  starts_on      date,
  renews_on      date,
  note           text,
  -- Where this row came from, so an imported term is distinguishable from one
  -- typed in the app. The CCM import stamps its transaction id here.
  source         text,
  created_at     timestamptz not null default now(),
  created_by     text,
  deleted_at     timestamptz
);

comment on table public.client_terms is
  'A client''s credit pool over a period — what David calls a "term". Imported from CCM contracts. Surveys draw against one via survey_projects.term_id; consumption is the sum of their credits, NOT a stored balance.';
comment on column public.client_terms.credits_total is
  'The pool. NUMERIC because repeat-wave discounts produce fractions. NULL means the pool size was never recorded — not zero.';

create index if not exists client_terms_client_idx on public.client_terms (client_id) where deleted_at is null;

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_terms_credits_chk') then
    alter table public.client_terms add constraint client_terms_credits_chk
      check (credits_total is null or credits_total >= 0);
  end if;
  -- A period that ends before it starts is a typo, and it would make every
  -- date-ranged rollup silently empty rather than wrong-looking.
  if not exists (select 1 from pg_constraint where conname = 'client_terms_period_chk') then
    alter table public.client_terms add constraint client_terms_period_chk
      check (starts_on is null or renews_on is null or renews_on >= starts_on);
  end if;
end $chk$;

-- ---------------------------------------------------------------------------
-- 2a) WHAT A TERM IS WORTH IN DOLLARS — a separate, finance-gated table.
--
--     David will "backfill the cost on a contract and client basis", so this has
--     to exist. It cannot live on client_terms: 085 defines view_financials as
--     "See client pricing, CONTRACT VALUE and margin", this is contract value,
--     and section 5 below opens client_terms to every analyst and to the sales
--     tier. RLS is row-level and cannot hide one column of a row it admits, so
--     the only honest options were to gate the row (which breaks the sales read
--     this migration exists for) or to move the column. It moves.
--
--     Deliberately the same shape and the same predicate as project_financials
--     (082, hard-gated by 086) so there is ONE financial gate in this codebase
--     rather than a second one to keep in step. 086's own header records why the
--     soft version was not good enough.
--
--     One row per term, so the PK is the term id — no surrogate, and no way to
--     end up with two dollar values for one pool.
-- ---------------------------------------------------------------------------
create table if not exists public.client_term_financials (
  term_id       uuid primary key references public.client_terms(id) on delete cascade,
  dollars_total numeric,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

comment on table public.client_term_financials is
  'The dollar value of a client_terms pool. Split from client_terms because it is contract value and RLS cannot hide a column — same shape and same gate as project_financials.';
comment on column public.client_term_financials.dollars_total is
  'What the term is worth in dollars. NULL until backfilled, which is NOT zero. There is no global $/credit rate: the dollar value of a credit is whatever the term says it is.';

do $chk3$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_term_financials_dollars_chk') then
    alter table public.client_term_financials add constraint client_term_financials_dollars_chk
      check (dollars_total is null or dollars_total >= 0);
  end if;
end $chk3$;

alter table public.client_term_financials enable row level security;
revoke all on public.client_term_financials from anon, authenticated;
grant select, insert, update, delete on public.client_term_financials to authenticated;
grant all on public.client_term_financials to service_role;

drop policy if exists client_term_financials_finance_rw on public.client_term_financials;
create policy client_term_financials_finance_rw on public.client_term_financials
  for all to authenticated
  using (public.can_view_financials())
  with check (public.can_view_financials());

-- The service role bypasses RLS, but 086 learned to state it anyway: a
-- server-side reader running as service_role has no auth.uid(), so
-- can_view_financials() is false for it and the policy above would deny.
drop policy if exists client_term_financials_service_all on public.client_term_financials;
create policy client_term_financials_service_all on public.client_term_financials
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3) CREDITS ON A SURVEY, and which pool it draws from.
--
--    NULL credits = not priced yet, which is the honest state for all 375
--    existing rows: this number has never been recorded anywhere. CCM's Studies
--    tab has a Cost column and it is 0 on all 221 rows, so there is nothing to
--    import. Zero would claim a survey is free.
--
--    term_id is nullable for the same reason CCM made its study->contract link
--    required "on the go-live create path only": 375 legacy surveys predate any
--    term and must not be blocked or guessed at.
-- ---------------------------------------------------------------------------
alter table public.survey_projects
  add column if not exists credits numeric;

alter table public.survey_projects
  add column if not exists term_id uuid references public.client_terms(id) on delete set null;

comment on column public.survey_projects.credits is
  'What this survey costs the client, in credits. Entered when scope is confirmed (David 2026-09-08). NULL = not priced yet, which is NOT zero. Whether these credits have been CONSUMED is derived from the survey''s stage — a survey that has fielded has drawn them — and is deliberately not stored a second time.';
comment on column public.survey_projects.term_id is
  'The credit pool this survey draws against. NULL for the 375 surveys that predate terms; required only on the create path once terms are in use.';

create index if not exists survey_projects_term_idx on public.survey_projects (term_id) where deleted_at is null;

do $chk2$
begin
  if not exists (select 1 from pg_constraint where conname = 'survey_projects_credits_chk') then
    alter table public.survey_projects add constraint survey_projects_credits_chk
      check (credits is null or credits >= 0);
  end if;
end $chk2$;

-- ---------------------------------------------------------------------------
-- 4) AUDIT the two new survey fields.
--
--    credits is a number a salesperson quotes to a client, so a change to it
--    needs the same trace a budget change has. audit_survey_project logs 32
--    scalar columns; this adds two, spliced beside the existing money fields.
--    Extracted from 094's live version programmatically rather than retyped —
--    the discipline 087, 088 and 094 all used, because `create or replace`
--    cannot patch one statement inside a function body.
-- ---------------------------------------------------------------------------
create or replace function public.audit_survey_project()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(auth.email(), ''), 'system');
  old_cap text;
  new_cap text;
  old_series text;
  new_series text;
  old_root text;
  new_root text;
  old_term text;
  new_term text;
begin
  perform audit_field(NEW.id, 'project_name', OLD.project_name, NEW.project_name, actor);
  perform audit_field(NEW.id, 'client', OLD.client, NEW.client, actor);
  perform audit_field(NEW.id, 'project_type', OLD.project_type::text, NEW.project_type::text, actor);
  perform audit_field(NEW.id, 'status', OLD.status::text, NEW.status::text, actor);
  perform audit_field(NEW.id, 'phase', OLD.phase::text, NEW.phase::text, actor);
  perform audit_field(NEW.id, 'scoping_stage', OLD.scoping_stage::text, NEW.scoping_stage::text, actor);
  perform audit_field(NEW.id, 'board_column', OLD.board_column::text, NEW.board_column::text, actor);
  perform audit_field(NEW.id, 'salesperson', OLD.salesperson, NEW.salesperson, actor);
  perform audit_field(NEW.id, 'priority', OLD.priority, NEW.priority, actor);
  perform audit_field(NEW.id, 'blocked_by', OLD.blocked_by, NEW.blocked_by, actor);
  perform audit_field(NEW.id, 'submitted_date', OLD.submitted_date::text, NEW.submitted_date::text, actor);
  perform audit_field(NEW.id, 'launch_date', OLD.launch_date::text, NEW.launch_date::text, actor);
  perform audit_field(NEW.id, 'due_date', OLD.due_date::text, NEW.due_date::text, actor);
  perform audit_field(NEW.id, 'deliver_date', OLD.deliver_date::text, NEW.deliver_date::text, actor);
  perform audit_field(NEW.id, 'n_target', OLD.n_target::text, NEW.n_target::text, actor);
  perform audit_field(NEW.id, 'n_target_max', OLD.n_target_max::text, NEW.n_target_max::text, actor);
  perform audit_field(NEW.id, 'n_collected', OLD.n_collected::text, NEW.n_collected::text, actor);
  perform audit_field(NEW.id, 'n_actual', OLD.n_actual::text, NEW.n_actual::text, actor);
  perform audit_field(NEW.id, 'audience_size', OLD.audience_size::text, NEW.audience_size::text, actor);
  perform audit_field(NEW.id, 'audience_used', OLD.audience_used::text, NEW.audience_used::text, actor);
  perform audit_field(NEW.id, 'budget', OLD.budget::text, NEW.budget::text, actor);
  perform audit_field(NEW.id, 'credits', OLD.credits::text, NEW.credits::text, actor);
  perform audit_field(NEW.id, 'actual_spend', OLD.actual_spend::text, NEW.actual_spend::text, actor);
  perform audit_field(NEW.id, 'longitudinal', OLD.longitudinal::text, NEW.longitudinal::text, actor);
  perform audit_field(NEW.id, 'voter_survey_qa', OLD.voter_survey_qa::text, NEW.voter_survey_qa::text, actor);
  perform audit_field(NEW.id, 'citation_language_needed', OLD.citation_language_needed::text, NEW.citation_language_needed::text, actor);
  perform audit_field(NEW.id, 'row_level_data', OLD.row_level_data::text, NEW.row_level_data::text, actor);
  perform audit_field(NEW.id, 'terminations', OLD.terminations::text, NEW.terminations::text, actor);
  perform audit_field(NEW.id, 'occam', OLD.occam::text, NEW.occam::text, actor);
  perform audit_field(NEW.id, 'cancel_reason', OLD.cancel_reason, NEW.cancel_reason, actor);
  perform audit_field(NEW.id, 'survey_tool_id', OLD.survey_tool_id, NEW.survey_tool_id, actor);
  perform audit_field(NEW.id, 'slack_channel_url', OLD.slack_channel_url, NEW.slack_channel_url, actor);
  perform audit_field(NEW.id, 'latest_next_steps', OLD.latest_next_steps, NEW.latest_next_steps, actor);

  if OLD.captain_id is distinct from NEW.captain_id then
    select name into old_cap from public.team_members where id = OLD.captain_id;
    select name into new_cap from public.team_members where id = NEW.captain_id;
    perform audit_field(NEW.id, 'captain', coalesce(old_cap, '—'), coalesce(new_cap, '—'), actor);
  end if;


  -- 088: THE RERUN WIRING, which was audited nowhere at all.
  --
  -- Until now this trigger logged 30 scalar columns and not one of the fields
  -- that decide whether a survey belongs to a series. The consequence was
  -- discovered the hard way while tracing BAM's PR00388: its series link had been
  -- dropped by a merge, and the change history for the entire database contained
  -- exactly ONE series_id row -- the repair inserted by hand afterwards. So
  -- "there is no history entry" did not mean "nothing changed"; it meant nothing
  -- was ever recorded. That is the worst possible state for an audit log, because
  -- it reads as evidence.
  --
  -- Now that a survey can be added to and removed from a series from the UI, this
  -- stops being a gap in a rarely-touched field and becomes a gap in a routine
  -- one.
  --
  -- series_id and rerun_series_id are RESOLVED TO NAMES rather than logged as
  -- UUIDs, following the captain_id -> name precedent immediately above: a raw
  -- uuid in a history panel tells a reader nothing, and the whole point of these
  -- rows is that a person reads them later. The uuid is still recoverable from
  -- the row it points at; the name is what makes the entry legible.
  --
  -- Guarded by `is distinct from` so a no-op UPDATE writes nothing, and so the
  -- lookups only run when the value actually moved -- these fire on every write
  -- to survey_projects, so an unconditional subquery per column would be a real
  -- cost on the hot path.
  if OLD.series_id is distinct from NEW.series_id then
    select survey_name into old_series from public.rerun_series where id = OLD.series_id;
    select survey_name into new_series from public.rerun_series where id = NEW.series_id;
    perform audit_field(NEW.id, 'rerun_series',
      coalesce(old_series, case when OLD.series_id is null then 'none' else 'unknown series' end),
      coalesce(new_series, case when NEW.series_id is null then 'none' else 'unknown series' end),
      actor);
  end if;

  -- The LEGACY lineage pointer. Not the same thing as series_id and repeatedly
  -- mistaken for it: it holds the FIRST WAVE'S PROJECT ID, not a series id. It is
  -- what the project page's wave list and app/api/projects/link-rerun/route.ts
  -- read, while the client page groups on series_id alone -- which is how a
  -- survey can look grouped on one screen and loose on the other. Resolved to the
  -- root wave's project code for exactly that reason: seeing "PR00025" makes the
  -- distinction obvious in a way a uuid never would.
  if OLD.rerun_series_id is distinct from NEW.rerun_series_id then
    select project_code into old_root from public.survey_projects where id = OLD.rerun_series_id;
    select project_code into new_root from public.survey_projects where id = NEW.rerun_series_id;
    perform audit_field(NEW.id, 'rerun_lineage_root',
      coalesce(old_root, case when OLD.rerun_series_id is null then 'none' else 'unknown' end),
      coalesce(new_root, case when NEW.rerun_series_id is null then 'none' else 'unknown' end),
      actor);
  end if;

  -- Wave position. rerun_number is recomputed for EVERY wave whenever one is
  -- added, removed or dragged (renumberWaves in lib/reruns/series.ts), so these
  -- rows are how you later explain why a survey's wave number moved without
  -- anyone editing it directly.
  perform audit_field(NEW.id, 'rerun_number', OLD.rerun_number::text, NEW.rerun_number::text, actor);
  perform audit_field(NEW.id, 'wave_order', OLD.wave_order::text, NEW.wave_order::text, actor);
  perform audit_field(NEW.id, 'rerun_date', OLD.rerun_date::text, NEW.rerun_date::text, actor);

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

  return NEW;
end $$;;

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


-- ---------------------------------------------------------------------------
-- 6) MERGE. client_terms is the sixth child of clients, and merge_clients
--    re-points its children BY HAND rather than relying on cascade — clients
--    are soft-deleted, so `on delete cascade` never fires at all.
--
--    Left unextended, merging two clients would leave the loser's term pointing
--    at a deleted client. client_terms_sales_read requires the parent to be
--    undeleted, so the pool becomes invisible to the salesperson while the
--    surveys that draw on it have moved to the survivor and still reference it
--    through term_id. A credit pool nobody can see, still being drawn against.
--
--    Not hypothetical: this function has run in production, including on three
--    Junction.AI name variants — precisely the duplicate-name case a
--    name-matched CCM import scatters terms across.
--
--    044's body VERBATIM with one line added, signature byte-identical so its
--    `grant execute ... to authenticated` survives the replace. The same
--    restatement 082 had to do for merge_projects.
-- ---------------------------------------------------------------------------
create or replace function public.merge_clients(p_survivor uuid, p_loser uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  survivor_name text;
begin
  if public.my_role() <> 'analyst' then raise exception 'Not authorized'; end if;
  if p_survivor = p_loser then raise exception 'Cannot merge a client into itself'; end if;
  if not exists (select 1 from clients where id = p_survivor and deleted_at is null)
    then raise exception 'Survivor client not found'; end if;
  if not exists (select 1 from clients where id = p_loser and deleted_at is null)
    then raise exception 'Loser client not found'; end if;

  select name into survivor_name from clients where id = p_survivor;

  update survey_projects set client_id = p_survivor where client_id = p_loser;
  update survey_projects
    set client = survivor_name ||
      (case when position(' - ' in coalesce(client, '')) > 0
            then substring(client from position(' - ' in client)) else '' end)
    where client_id = p_survivor;

  update profiles        set client_id = p_survivor where client_id = p_loser;
  update deliverables    set client_id = p_survivor where client_id = p_loser;
  update client_contacts set client_id = p_survivor where client_id = p_loser;
  update client_notes    set client_id = p_survivor where client_id = p_loser;
  -- 100: the sixth child. Soft delete means `on delete cascade` never fires,
  -- so an unmoved term is left pointing at a deleted client while the
  -- surveys drawing on it move to the survivor.
  update client_terms    set client_id = p_survivor where client_id = p_loser;

  update clients set deleted_at = now() where id = p_loser;
end $$;;

commit;
