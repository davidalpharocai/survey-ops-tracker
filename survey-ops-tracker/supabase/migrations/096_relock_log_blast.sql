-- 096: URGENT. Re-lock mcp_log_blast, which 095 left executable by anyone.
--
-- RUN THIS BEFORE ANYTHING ELSE TODAY.
--
-- WHAT HAPPENED
--
-- 095 step 8 had to change mcp_log_blast's signature (to add p_cost_per_send),
-- and a signature change means DROP + CREATE rather than CREATE OR REPLACE. A
-- newly created function gets Postgres's DEFAULT ACL, which is EXECUTE TO
-- PUBLIC. The old function's REVOKE died with the old function. 095 did not
-- re-issue it.
--
-- Every earlier migration that reshaped this function carried the revoke/grant
-- pair -- 046, 058, 060, 076, 091 -- precisely because of this. 095 broke a
-- five-migration streak and nobody noticed until the change was reviewed.
--
-- CONFIRMED LIVE, not inferred. Calling the RPC over PostgREST with the ANON key
-- (the one shipped in the browser bundle, so effectively public) with a
-- deliberately malformed uuid returns 22P02 "invalid input syntax for type uuid"
-- -- i.e. it got PAST the permission check and failed on the argument. The same
-- probe against my_role, mcp_write_project, mcp_update_blast, mcp_add_segment
-- and mcp_update_segment returns 42501 "permission denied", which is what
-- correct looks like and proves the probe can tell the difference.
--
-- THE EXPOSURE, stated plainly: mcp_log_blast is SECURITY DEFINER, so it runs as
-- the owner and bypasses RLS on project_blasts. Anyone with the anon key could
-- insert a blast row against ANY project id and, through the recompute trigger,
-- move that project's actual_spend -- and therefore its budget-used bar and its
-- margin. Reads are unaffected (RLS on the tables is untouched); this is a write
-- and money-integrity hole, not a data leak.
--
-- The 10th argument has a DEFAULT, so a 9-argument call resolves to this same
-- function: there is no second, still-locked overload that callers might be
-- using instead. Every caller is on the exposed one.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable. No data change.
begin;

-- Belt and braces on the signature: name it in full so a future overload cannot
-- silently take the revoke instead.
revoke execute on function
  public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text, numeric)
  from public, anon, authenticated;

grant execute on function
  public.mcp_log_blast(uuid, numeric, int, int, timestamptz, text, text, text, text, numeric)
  to service_role;

commit;

-- VERIFY, from a terminal, that it took -- do not take the absence of an error
-- as proof. Expect 42501 "permission denied for function mcp_log_blast":
--
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/mcp_log_blast" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"p_project":"not-a-uuid","p_bid":null,"p_people":null,"p_completes":null,
--          "p_blast_at":null,"p_note":"","p_created_by":"x","p_idem":"x","p_actor":"x"}'
--
-- 22P02 means it is STILL OPEN.
--
-- STANDING RULE for whoever next changes a mcp_* signature: DROP + CREATE resets
-- the ACL. Re-issue the revoke/grant in the same migration, every time, and probe
-- it with the anon key afterwards rather than assuming.
