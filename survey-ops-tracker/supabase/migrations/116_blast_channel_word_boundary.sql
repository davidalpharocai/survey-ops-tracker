-- 116: \b is BACKSPACE in Postgres, not a word boundary. Use \y.
--
-- 115 added two patterns using \b:
--
--     NEW.note ~* '^\s*SMS\s+blast\b'
--     NEW.note ~* '^\s*EMAIL\s+blast\b'
--
-- In PCRE — JavaScript, Python, most places anyone has met a regex — \b is a
-- word boundary. In Postgres's ARE it is the BACKSPACE CHARACTER (\010). So
-- those two patterns require a literal backspace after the word "blast" and can
-- never match anything. Postgres spells the word boundary \y.
--
-- It failed silently, which is why it needed measuring rather than reading. 115
-- predicted 12 rows would resolve; 9 did. The four patterns split exactly on
-- this: the two WITHOUT \b matched all 9 of their rows, the two WITH \b matched
-- none. The three left behind are PR00311's
--
--     "SMS blast - BofA Teleperformance FR audience (Campaign…)"
--
-- which are plain ASCII — I checked them codepoint by codepoint before
-- suspecting the regex, because "the data must be weird" is the more comfortable
-- explanation and it was wrong.
--
-- All three are SMS and are already charged send cost, so no spend moves. This
-- is the worklist getting honest, not the money.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable.
begin;

create or replace function public.derive_blast_channel()
returns trigger language plpgsql as $$
begin
  -- An explicit channel always wins. This only ever fills a blank.
  if NEW.channel is null and NEW.note is not null then
    if    NEW.note ~* '^\s*EMAIL\s*·'        then NEW.channel := 'email';
    elsif NEW.note ~* '^\s*SMS\s*·'          then NEW.channel := 'sms';
    -- \y, NOT \b — see the header. \b is backspace here.
    elsif NEW.note ~* '^\s*SMS\s+blast\y'    then NEW.channel := 'sms';
    elsif NEW.note ~* '^\s*EMAIL\s+blast\y'  then NEW.channel := 'email';
    elsif NEW.note ~* '·\s*SMS\s*·'          then NEW.channel := 'sms';
    elsif NEW.note ~* '·\s*E-?MAIL\s*·'      then NEW.channel := 'email';
    end if;
  end if;
  return NEW;
end $$;

update public.project_blasts
   set channel = 'sms'
 where channel is null
   and (note ~* '^\s*SMS\s+blast\y' or note ~* '·\s*SMS\s*·');

update public.project_blasts
   set channel = 'email'
 where channel is null
   and (note ~* '^\s*EMAIL\s+blast\y' or note ~* '·\s*E-?MAIL\s*·');

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
--   -- the three PR00311 rows resolve:
--   select note, channel from public.project_blasts where note ilike 'SMS blast%';
--   -- all 'sms'
--
--   select channel, count(*) from public.project_blasts group by channel;
--   -- unknown falls from 21 to 18
--
--   -- and the remainder is genuinely unlabelled — PR00362's Campaign 221/242
--   -- rows plus a few empty notes. Those need a person, not a better regex.
--   select count(*), sum(send_cost_still_charged) from public.blast_channel_unknown;
--
--   -- proof of the trap itself, if you want to see it:
--   select 'SMS blast - x' ~* 'blast\b' as with_b,     -- false
--          'SMS blast - x' ~* 'blast\y' as with_y;     -- true
