-- 112: an email blast costs the incentive and nothing else.
--
-- David, 2026-09-14: "if the blast was an email blast, the only cost associated
-- with the blast is the incentive cost. there's no '$ / Send'."
--
-- 095 made send cost universal: every blast charges people x cost_per_send on top
-- of bid x completes, and cost_per_send is 0.02 on all 816 rows in the table.
-- That is right for SMS, where each message is metered, and wrong for email,
-- where it is not.
--
-- ── SCOPE, MEASURED BEFORE WRITING THIS ─────────────────────────────────────
-- The CM import writes the channel into `note` as a structured prefix:
--
--     "EMAIL · DSV NL clients ... · BofA DSV Integration Impact"
--     "SMS · Pharm biotech tech · BAM Pharma AI Vibe Coding Survey"
--
--   EMAIL prefix    59 blasts   $3,445.60 of send cost   <- removed here
--   SMS prefix     736 blasts  $94,418.60               <- correctly kept
--   no prefix       21 blasts   $1,526.80               <- LEFT ALONE, see below
--
-- So this corrects ~$3.4k, not the ~$99k it would be if every blast were email.
-- The SIX affected projects, dry-run against production 2026-09-14:
--
--   PR00249 BofA     $7,966.56 -> $5,883.54   (-$2,083.02)
--   PR00202 Coatue   $9,726.34 -> $9,138.24   (-$588.10)
--   PR00036 Citadel  $4,449.38 -> $4,005.94   (-$443.44)
--   PR00370 BofA       $831.48 ->   $574.96   (-$256.52)
--   PR00257 DE Shaw  $1,063.58 -> $1,007.54   (-$56.04)
--   PR00003 Coatue   $7,275.86 -> $7,257.38   (-$18.48)
--
-- Book-wide recorded spend falls $325,750.99 -> $322,305.39.
--
-- PR00300 is NOT in that list even though its note mentions email, because the
-- note reads "LinkedIn + email blast" with no structured prefix. It keeps its
-- $60 send cost and lands in blast_channel_unknown for a human. That is the
-- anchored regex doing its job rather than a near-miss.
--
-- ── WHY A COLUMN AND NOT JUST ZEROING cost_per_send ─────────────────────────
-- Setting cost_per_send = 0 on the email rows would produce the right number
-- today and lose the reason. `0` would then mean both "email, genuinely free"
-- and "SMS we have not priced", and the next edit that re-applies the default
-- rate silently puts the charge back. The channel is a real attribute of a
-- blast; the cost follows from it.
--
-- ── THE 21 WITH NO PREFIX ARE DELIBERATELY NOT GUESSED ──────────────────────
-- 20 carry no channel signal at all ("Campaign 221 - Blast 5") and one reads
-- "LinkedIn + email blast", which is not the same as an email blast. Guessing
-- would move $1,526.80 of real money on the strength of a regex. They keep their
-- send cost and their channel stays null, which is what "we do not know" should
-- look like. `blast_channel_unknown` below lists them for a human.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
begin;

-- 1) The attribute.
alter table public.project_blasts
  add column if not exists channel text
  check (channel is null or channel in ('email', 'sms'));

comment on column public.project_blasts.channel is
  'How the blast was sent. ''email'' means NO per-send charge — the incentive '
  '(bid x completes) is the whole cost. ''sms'' is metered per message, so send '
  'cost applies. NULL means the channel was never recorded, and send cost is '
  'charged as before rather than silently forgiven.';

-- 2) Backfill from the structured prefix the CM import writes. Anchored at the
--    start of the note so a passing mention of the word "email" further in does
--    not qualify — that is exactly the PR00300 "LinkedIn + email blast" row,
--    which stays null on purpose.
update public.project_blasts
   set channel = 'email'
 where channel is null and note ~* '^\s*EMAIL\s*·';

update public.project_blasts
   set channel = 'sms'
 where channel is null and note ~* '^\s*SMS\s*·';

-- 3) The formula. Send cost is charged unless we KNOW the blast was email.
--    Written as `is distinct from 'email'` rather than `<> 'email'` so a NULL
--    channel keeps its send cost — with plain <>, NULL yields NULL, the whole
--    row's sum goes NULL, and a project's spend would quietly collapse to the
--    coalesce default of 0. That failure would be silent and expensive.
create or replace function public.recompute_project_spend(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.survey_projects set actual_spend =
      coalesce((select sum(
                    coalesce(bid, 0) * coalesce(completes, 0)
                  + case when channel is distinct from 'email'
                         then coalesce(people, 0) * coalesce(cost_per_send, 0)
                         else 0 end)
                  from public.project_blasts where project_id = pid), 0)
    + coalesce((select sum(cpi * n_collected) from public.project_suppliers where project_id = pid), 0)
    + coalesce((select sum(amount) from public.project_costs where project_id = pid), 0)
  where id = pid;
end $$;

-- 4) Re-run for every project holding blasts, so stored spend matches the new
--    formula now rather than drifting until each project's next edit. Same
--    approach 095 used for the same reason.
do $recalc$
declare p uuid;
begin
  for p in select distinct project_id from public.project_blasts loop
    perform public.recompute_project_spend(p);
  end loop;
end $recalc$;

-- 5) The ones a person still has to decide. Not a view for the app — a worklist.
create or replace view public.blast_channel_unknown as
select b.project_id, p.project_code, p.client, b.id as blast_id,
       b.note, b.people, b.cost_per_send,
       coalesce(b.people, 0) * coalesce(b.cost_per_send, 0) as send_cost_still_charged
  from public.project_blasts b
  join public.survey_projects p on p.id = b.project_id
 where b.channel is null
 order by coalesce(b.people, 0) * coalesce(b.cost_per_send, 0) desc;

comment on view public.blast_channel_unknown is
  'Blasts whose channel was never recorded. They are still charged send cost, '
  'which is correct for SMS and wrong for email — someone has to say which. '
  'Set project_blasts.channel to resolve one.';

commit;

-- VERIFY (expected values measured 2026-09-14, before applying):
--
--   select channel, count(*), sum(coalesce(people,0)*coalesce(cost_per_send,0))
--     from public.project_blasts group by channel;
--   -- email  59  3445.60   (this send cost no longer counts toward spend)
--   -- sms   736 94418.60
--   -- null   21  1526.80   (still counted; see blast_channel_unknown)
--
--   select count(*) from public.blast_channel_unknown;   -- 21
--
-- Then confirm spend actually moved on the seven affected projects:
--   select project_code, actual_spend from public.survey_projects
--    where project_code in ('PR00249','PR00202','PR00036','PR00370','PR00300','PR00257','PR00003');
