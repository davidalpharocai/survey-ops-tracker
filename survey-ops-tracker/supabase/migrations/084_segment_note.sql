-- 084: N segments get a freeform note — project_segments was the last
-- detail/money child table without one.
--
-- Precedent is 077 (project_launches.note): one nullable text column, no
-- backfill, nothing derived from it. project_blasts already has `note` (shown as
-- its "Description"), project_launches got one in 077, rerun_meta in 055 —
-- project_segments (039, extended by 062 / 078 / 082) had none, so "why is the
-- Sellers N 500" had nowhere to live and ended up in the PROJECT's notes, where
-- it stops being attached to the segment it explains.
--
-- WHAT IS DELIBERATELY NOT IN THIS FILE
--
-- · sync_segment_totals() is NOT rebuilt. It rolls the segments' N columns up
--   onto the parent project, and a freeform note has no sum — the same reason
--   082 left that function alone when it added price_per_n. Not touching it also
--   means this file cannot regress it: 078 step 4 owns the live version, and a
--   copy pasted here would silently become the definition the next time someone
--   re-runs 084.
--
-- · project_segments_price_audit (082) is NOT widened. It is scoped hard to
--   price_per_n so it can never fire on an ordinary segment edit, and a note is
--   not money: nothing gates, bills, or reconciles on it. A note change writes
--   no audit row, exactly like a launch note (077) or a blast description (058).
--
-- · mcp_add_segment does NOT gain a p_note. A ninth parameter means dropping the
--   8-arg signature 078 created and re-issuing its grants; if that drop's type
--   list is off by one, `create or replace` leaves TWO all-defaulted overloads
--   behind and every named-arg call from runAddSegment (lib/mcp/writes.ts) then
--   fails with "function is not unique" — add_segment stops working altogether.
--   What that risk would buy is one round trip: runAddSegment already returns the
--   new row, so a connector that wants to add a segment WITH a note can add it
--   and then call update_segment on the id it just got back.
--
-- · mcp_update_segment DOES gain the arm — see step 2. That one is not optional
--   polish and not deferrable.
--
-- DARK-SHIP / APPLY ORDER: unlike 078, this file can be applied at any time,
-- before or after the code that reads the note ships.
--   · READING is safe either way. lib/hooks/useProjectSegments.ts selects `*`,
--     so pre-084 the rows just arrive with no `note` key at all, and
--     components/project/NSegmentsEditor.tsx tests for that key and hides the
--     note control entirely rather than rendering a field that cannot save.
--   · WRITING is NOT safe pre-084: PostgREST fails the ENTIRE request when a
--     PATCH body names a column missing from its schema cache. So the note is
--     written by its own single-column update and is never bundled into the
--     patch that carries the N fields — a stale schema cache can then cost you
--     the note, never the numbers.
--   · lib/server/clone.ts's copyProjectSegments names its columns explicitly in
--     BOTH its select and its insert, so `note` must NOT be added there until
--     this file is applied — it would 400 every clone AND every auto-spawned
--     rerun wave. When it is added, use 082's price_per_n shape: read the note
--     in its own query and spread the key only when that read succeeded.
--
-- Apply by hand in the Supabase SQL editor (David). Standalone and re-runnable.
-- Wrapped in an explicit transaction so a failure in step 2 cannot leave the
-- column in place while mcp_update_segment still silently drops writes to it.
begin;

-- 1) The column. Nullable, no default, no backfill: NULL means "nobody wrote a
--    note", which is the state every existing segment is in and is not the same
--    as an empty string. The app normalises a cleared note back to NULL.
alter table public.project_segments add column if not exists note text;

comment on column public.project_segments.note is
  'Freeform note about THIS ONE SEGMENT — why its N is what it is, quota or audience quirks, who asked for it. Per-segment, not per-project (the project has its own notes and latest_next_steps). Nothing is derived from it: no rollup, no cost, no gate, no audit row.';

-- 2) The connector / in-app-assistant update RPC: 078 step 6's body verbatim
--    plus ONE arm for note. Same signature (uuid, jsonb, text), so this is a
--    true replace — no new overload, and no grants to re-issue.
--
--    The arm is what makes the column reachable at all from the connector. The
--    function resolves every column as `case when p_patch ? 'col' then ... end`,
--    and a jsonb patch key that NO arm mentions is never read: without this,
--    update_segment would answer success, write nothing, and the person who
--    dictated the note would believe it was saved. That is 078 step 6's argument,
--    and it applies to a sentence of context the same way it applies to a number.
--
--    `p_patch->>'note'` with no nullif(): unlike the int columns, an empty string
--    here is a real (if pointless) value, and the app already sends NULL rather
--    than '' when a note is cleared. Matching label's treatment, one line above.
create or replace function public.mcp_update_segment(p_segment uuid, p_patch jsonb, p_actor text)
returns public.project_segments language plpgsql security definer set search_path = public as $$
declare r public.project_segments;
begin
  perform set_config('app.actor', p_actor, true);
  update project_segments set
    label       = case when p_patch ? 'label'       then p_patch->>'label' else label end,
    n_target    = case when p_patch ? 'n_target'    then nullif(p_patch->>'n_target','')::int else n_target end,
    n_target_max = case when p_patch ? 'n_target_max' then nullif(p_patch->>'n_target_max','')::int else n_target_max end,
    n_collected = case when p_patch ? 'n_collected' then coalesce(nullif(p_patch->>'n_collected','')::int, 0) else n_collected end,
    n_actual    = case when p_patch ? 'n_actual'    then nullif(p_patch->>'n_actual','')::int else n_actual end,
    note        = case when p_patch ? 'note'        then p_patch->>'note' else note end
  where id = p_segment
  returning * into r;
  if not found then raise exception 'Segment not found'; end if;
  return r;
end $$;

commit;
