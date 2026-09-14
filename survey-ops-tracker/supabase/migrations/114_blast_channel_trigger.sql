-- 114: keep `channel` filled in, instead of filling it in once.
--
-- 112 backfilled channel from the note prefix and stopped there. Nine blasts
-- were logged to PR00370 within twenty minutes of it being applied, and the one
-- that landed at 20:41:44 — SECONDS after the backfill — has channel NULL, so it
-- is charged send cost. Its note reads "SMS · DSV PL SMS clients…", byte for byte
-- the same shape as the eight the backfill did catch. Nothing was wrong with the
-- regex; the backfill simply had already run.
--
-- That is the shape of the real defect. 112 corrected history and left the
-- present to drift: no write path sets channel. The UI has a control now, but
-- the CM import and the connector's log_blast do not, so every blast either of
-- them writes from here on is unclassified and priced as if metered.
--
-- ── WHY A TRIGGER AND NOT A PARAMETER ───────────────────────────────────────
-- The obvious fix is to add p_channel to mcp_log_blast. That fixes ONE writer.
-- There are at least three — the CM import, the connector RPC, and the UI's
-- direct insert — and a fourth will be added by someone who has not read this
-- file. A trigger covers all of them and the ones not yet written, and it does
-- so with no signature change and no client release.
--
-- The prefix is machine-written, not typed: the CM import emits exactly
-- "EMAIL · …" / "SMS · …". This reads the same structured field 112 read.
--
-- ── IT NEVER OVERRIDES AN EXPLICIT ANSWER ───────────────────────────────────
-- Only fires when channel is null. A person who sets Channel by hand in the UI
-- outranks the note, always — including when they disagree with it, which is
-- the case that matters: someone correcting a mislabelled import must not be
-- silently overwritten on their next edit.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
begin;

create or replace function public.derive_blast_channel()
returns trigger language plpgsql as $$
begin
  -- An explicit channel always wins. This only fills a blank.
  if NEW.channel is null and NEW.note is not null then
    if NEW.note ~* '^\s*EMAIL\s*·' then
      NEW.channel := 'email';
    elsif NEW.note ~* '^\s*SMS\s*·' then
      NEW.channel := 'sms';
    end if;
  end if;
  return NEW;
end $$;

comment on function public.derive_blast_channel is
  'Fills project_blasts.channel from the structured "EMAIL · " / "SMS · " prefix '
  'the CM import writes, when the caller did not set one. Never overrides an '
  'explicit value. Exists because 112 backfilled history and no write path sets '
  'the column — a blast logged seconds after 112 was applied came through NULL.';

drop trigger if exists derive_blast_channel_trg on public.project_blasts;
create trigger derive_blast_channel_trg
  before insert or update of note, channel on public.project_blasts
  for each row execute function public.derive_blast_channel();

-- Catch anything logged between 112 and this migration. Same predicates; the
-- trigger handles everything after.
update public.project_blasts
   set channel = 'email'
 where channel is null and note ~* '^\s*EMAIL\s*·';

update public.project_blasts
   set channel = 'sms'
 where channel is null and note ~* '^\s*SMS\s*·';

-- The update above does not itself change bid/people/cost_per_send, so no spend
-- trigger necessarily fired. Recompute every project holding blasts, because a
-- row that just became 'email' must stop being charged for its sends.
do $recalc$
declare p uuid;
begin
  for p in select distinct project_id from public.project_blasts loop
    perform public.recompute_project_spend(p);
  end loop;
end $recalc$;

commit;

-- VERIFY:
--
--   -- no blast whose note carries a structured prefix should still be null:
--   select count(*) from public.project_blasts
--    where channel is null and note ~* '^\s*(EMAIL|SMS)\s*·';     -- 0
--
--   select channel, count(*) from public.project_blasts group by channel;
--
--   -- and the remaining unknowns are only the genuinely unlabelled ones
--   -- ("Campaign 221 - Blast 5"), which still need a human:
--   select count(*), sum(send_cost_still_charged) from public.blast_channel_unknown;
