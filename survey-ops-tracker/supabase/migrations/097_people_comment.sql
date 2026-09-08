-- 097: correct project_blasts.people's comment, which 095 made false.
--
-- 091 wrote: "Informational — it does not drive the cost, but it IS the
-- denominator of the completion rate". That was exactly true when written.
--
-- 095 then made `people` a factor in money: send cost = people x cost_per_send,
-- and across the live blasts that is over $4,500 of real spend. 095 added
-- comments for the two columns it CREATED and updated neither factor of the
-- product it introduced, so the live catalog now tells the next reader that the
-- number driving the largest cost on some projects is informational.
--
-- Worth a migration of its own rather than waiting for the next one that touches
-- this table. A comment is the definition of record for anyone reading the schema
-- rather than the app, and a stale-but-confident definition is the exact failure
-- that made audience_size mean two different things for a year (094), that put a
-- deleted advisory in a live tool description, and that had NSegmentsEditor
-- describing a market estimate for a field holding our own contact list.
--
-- Verified before writing: read back through PostgREST's OpenAPI document, which
-- publishes column comments as descriptions, so the wrong text was confirmed
-- present rather than assumed.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable. No data change,
-- no code depends on it.
begin;

comment on column public.project_blasts.people is
  'How many MESSAGES this blast sent. Drives the SEND COST (people x cost_per_send, migration 095) and is the denominator of the completion rate. Counts SENDS, not unique recipients: re-sending to the same list adds to this every time and is charged every time, which is why PR00309 reads 95,788 against a pool of 31,545 contacts. NULL means NOT RECORDED, and the send cost is then unknown rather than zero; 0 asserts the blast genuinely reached nobody.';

commit;
