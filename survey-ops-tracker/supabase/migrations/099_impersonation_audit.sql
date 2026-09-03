-- 099: let permission_audit record an impersonation.
--
-- WHY
--
-- David, 2026-09-02: "admins should have the ability to sign in as users, ie
-- sales." The immediate need is that Alex could not sign in for three days and
-- the only way to check what he would see was to mint him a token by hand from a
-- script. An admin should be able to answer "what does this person see" from the
-- app.
--
-- Signing in as someone else is an access event, so it belongs in the same
-- append-only history as granting a role. permission_audit already exists (085)
-- and already has the right shape -- actor, subject, target, reason -- but its
-- `action` CHECK allows only the four grant/revoke verbs, so an insert would be
-- rejected. This widens it by two.
--
-- WHY THE CHECK IS KEPT rather than dropped: it is the reason a typo cannot
-- quietly create a fifth kind of audit row that no reader knows to look for. Two
-- new verbs, spelled out, is the point.
--
-- WHAT THE APP ENFORCES, recorded here because it is the load-bearing part of
-- the design and is NOT enforced by this file:
--
--   * Only a holder of the `admin` role may start an impersonation.
--   * The target must be a `sales` or `compliance` profile -- the two tiers
--     whose RLS is SELECT-only. That is what makes the session genuinely
--     read-only: writes are refused by Postgres, not hidden by the interface. An
--     app-level "please do not save" guard would have to be added to all 46
--     browser write paths and would still be a convention rather than a control.
--   * Analysts and admins are therefore NOT valid targets, which also means an
--     admin can never impersonate UP into finance access they do not hold, or
--     sideways into another admin.
--
-- If impersonating an analyst is ever needed, it needs writes, and writes need
-- the actor recorded honestly -- a JWT claim on the target user, not a header a
-- browser could forge. That is a bigger change and deliberately not in here.
--
-- Apply by hand in the Supabase SQL editor (David). Re-runnable. No data change.
begin;

alter table public.permission_audit
  drop constraint if exists permission_audit_action_check;

alter table public.permission_audit
  add constraint permission_audit_action_check
  check (action in (
    'grant_role', 'revoke_role', 'grant_capability', 'revoke_capability',
    -- 099: `subject` is the person being impersonated, `actor` the admin doing
    -- it, `target` the tier being viewed (so a reader can see at a glance that a
    -- read-only tier was viewed without opening the profile).
    'impersonate_start', 'impersonate_stop'
  ));

comment on table public.permission_audit is
  'Append-only history of every access change AND every impersonation. subject = the person whose access changed or who was impersonated, target = the role/capability or the tier viewed, actor = who did it.';

commit;

-- Read the impersonation history:
--
--   select at, actor, action, subject, target
--     from public.permission_audit
--    where action like 'impersonate%'
--    order by at desc;
