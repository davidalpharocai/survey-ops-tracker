-- 115: read the channel when it is in the MIDDLE of the note, not only at the front.
--
-- 112/114 derive a blast's channel from the note, but anchored: the note had to
-- BEGIN "EMAIL · " or "SMS · ", which is what the older CM import wrote. A newer
-- note format puts the channel in the middle:
--
--     "Blast #1 (Done) · SMS · Insurance Producers · template…"
--     "SMS blast - BofA Teleperformance UK audience (Campaign…)"
--
-- Dry-run against production 2026-09-15: of the 30 blasts still carrying no
-- channel, TWELVE state it plainly and are simply missed by the anchor. They
-- carry $1,714.48 of send cost. The other 18 genuinely say nothing ("Campaign
-- 221 - Blast 6", or an empty note) and hold $1,420.30 — almost all of it
-- PR00362's Campaign 221/242 rows.
--
-- ALL TWELVE RESOLVE TO SMS, so no spend moves: they were already being charged
-- send cost, correctly. This buys accuracy of the record, not dollars.
--
-- So this is not new information. It is information we already had and were not
-- reading.
--
-- ── WHAT IT MATCHES, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────
-- Three shapes, all of them the channel stated as its own field:
--   1. "SMS · …"                  (anchored — what 112/114 already handled)
--   2. "… · SMS · …"              (a delimited field anywhere in the note)
--   3. "SMS blast - …"            (the phrase the BofA notes use)
--
-- It does NOT match a bare mention. The row that proves why is PR00300's
-- "LinkedIn + email blast to US B2B software buyers" — that is a blast sent
-- over LinkedIn AND email, and calling it an email blast would zero a send cost
-- that may well be real. It stays unknown, which is the honest answer. (It is
-- also the demo account, so it is out of reporting anyway.)
--
-- Anchored SMS is checked BEFORE delimited EMAIL, so a note that names both
-- resolves to whichever is stated as the row's own channel first rather than to
-- whichever pattern happens to be tried first.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
begin;

create or replace function public.derive_blast_channel()
returns trigger language plpgsql as $$
begin
  -- An explicit channel always wins. This only ever fills a blank.
  if NEW.channel is null and NEW.note is not null then
    if    NEW.note ~* '^\s*EMAIL\s*·'          then NEW.channel := 'email';
    elsif NEW.note ~* '^\s*SMS\s*·'            then NEW.channel := 'sms';
    elsif NEW.note ~* '^\s*SMS\s+blast\b'      then NEW.channel := 'sms';
    elsif NEW.note ~* '^\s*EMAIL\s+blast\b'    then NEW.channel := 'email';
    -- Delimited field anywhere: "… · SMS · …"
    elsif NEW.note ~* '·\s*SMS\s*·'            then NEW.channel := 'sms';
    elsif NEW.note ~* '·\s*E-?MAIL\s*·'        then NEW.channel := 'email';
    end if;
  end if;
  return NEW;
end $$;

comment on function public.derive_blast_channel is
  'Fills project_blasts.channel from the channel stated as its own field in the '
  'note — at the front ("SMS · …"), as a delimited field ("… · SMS · …"), or as '
  '"SMS blast - …". Never from a bare mention: "LinkedIn + email blast" is not an '
  'email blast. Never overrides an explicit value.';

-- Backfill the 13 the anchor missed. Same predicates as the trigger.
update public.project_blasts
   set channel = 'sms'
 where channel is null
   and (note ~* '^\s*SMS\s+blast\b' or note ~* '·\s*SMS\s*·');

update public.project_blasts
   set channel = 'email'
 where channel is null
   and (note ~* '^\s*EMAIL\s+blast\b' or note ~* '·\s*E-?MAIL\s*·');

-- Those rows were SMS all along and were already paying send cost, so no spend
-- moves here. Recomputed anyway: if any of them resolved to 'email', its sends
-- must stop being charged, and guessing which is cheaper than being wrong.
do $recalc$
declare p uuid;
begin
  for p in select distinct project_id from public.project_blasts loop
    perform public.recompute_project_spend(p);
  end loop;
end $recalc$;

commit;

-- VERIFY (measured 2026-09-15, before applying):
--
--   select channel, count(*) from public.project_blasts group by channel;
--   -- unknown should fall from 30 to 18
--
--   select count(*), sum(send_cost_still_charged) from public.blast_channel_unknown;
--   -- the remainder is PR00362's "Campaign 221 - Blast N" rows and a handful of
--   -- empty notes: ~$1,360, genuinely undetermined and needing a person.
--
--   -- nothing should have been claimed on a bare mention:
--   select project_code, note, channel from public.project_blasts b
--     join public.survey_projects p on p.id = b.project_id
--    where b.note ilike '%linkedin%';   -- channel stays null
