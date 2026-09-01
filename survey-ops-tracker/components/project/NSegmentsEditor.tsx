'use client'
import { Caret } from '@/components/shared/Caret'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { FieldCell, FieldSection, NumberCell, TextCell, useSavedFlash } from './fields'
import { GenPopNWarning } from './GenPopNWarning'
import {
  useProjectSegments,
  useSplitProject,
  useAddSegment,
  useUpdateSegment,
  useRemoveSegment,
  type ProjectSegment,
  type SegmentInput,
} from '@/lib/hooks/useProjectSegments'
import { useUpdateProject, type SurveyProject } from '@/lib/hooks/useProjects'
import { cn } from '@/lib/utils'
import { commitNumber } from '@/lib/utils/formula'
import { fmtNum } from '@/lib/utils/number'
import { audienceState } from '@/lib/utils/audience'
import {
  formatNRange,
  isInvertedNRange,
  resolveNRange,
  sumNRange,
  type NRange,
} from '@/lib/utils/nRange'
import type { Database } from '@/lib/supabase/types'

type ProjectUpdate = Database['public']['Tables']['survey_projects']['Update']

const TIP = {
  section:
    'Target and collected sample, plus who the survey is fielded to. Split into per-segment Ns (e.g. Buyers / Sellers) when a project needs separate targets — the totals here then sum the segments.',
  nTarget:
    'The number of survey responses to collect, as the range agreed with the client (minimum – maximum). One agreed number? Type it once and leave the max blank.',
  nInternal:
    'Your internal collection goal — usually a cushion above N Target to cover cleaning and terminations.',
  nCollected: 'Completes collected so far — also auto-syncs from the sheet.',
  nActual: 'Final usable response count after cleaning N Collected.',
  audienceSize:
    'How many contacts the team has handed us for this project. Our own supply — not an estimate of the market. Different from N (the responses we are collecting).',
  audienceUsed:
    'How many of those contacts we have actually drawn on so far. Leave blank if nobody has recorded it. Deliberately NOT the same as blast reach: re-sending to the same list raises reach without using up a single new contact.',
  audience:
    'Who the survey is fielded to — the target respondent profile (free text, e.g. "US adults 18+, likely voters").',
  segmentTotal:
    'The project N Target: the sum of the segment minimums through to the sum of the segment maximums.',
  segmentNote:
    'A note about THIS SEGMENT only — why its N is what it is, quota or audience quirks, who asked for it. The project has its own notes; this one travels with the segment.',
}

const WARN_TONE = 'text-amber-700 dark:text-amber-400'

/**
 * What is left of the contact list — the line that is the whole reason the
 * audience field was split in two.
 *
 * "Total available" alone cannot answer the only question anyone asks of it:
 * send to more of the list, or go ask the team for more contacts. The decision
 * itself lives in audienceState() (lib/utils/audience.ts) with its tests; this
 * component only renders it.
 */
function AudienceRemaining({ size, used }: { size: number | null; used: number | null }) {
  const state = audienceState(size, used)

  switch (state.kind) {
    // Nothing is known, so say nothing — "— left" is noise.
    case 'unknown':
      return null

    // Deliberately explicit rather than blank. 42 projects have a total and none
    // has a used figure, so silence here would read as "nothing spent" on all
    // of them.
    case 'unrecorded':
      return (
        <p className="text-xs text-muted-foreground/70">
          Fill in <span className="font-medium">Audience Size Used</span> to see how many contacts
          are still available.
        </p>
      )

    // Impossible for a pool, so one of the two numbers is wrong — four projects
    // are in this state today, all from the era when this field had one
    // ambiguous label. Named as a contradiction rather than rendered as a
    // negative remainder, which would read as a real quantity. The database
    // does NOT reject it: these cells save one field at a time and the two
    // numbers arrive weeks apart, so a hard guard would reject the normal order
    // of work (migration 094 explains at length).
    case 'over':
      return (
        <p className={`text-xs ${WARN_TONE}`}>
          Used ({fmtNum(state.used)}) is above the total available ({fmtNum(state.total)}) — one of
          these two numbers is wrong.
        </p>
      )

    case 'exhausted':
      return (
        <p className={`text-xs ${WARN_TONE}`}>
          <span className="font-medium">No contacts left</span> — the list is fully used. More
          responses means more incentive, or more contacts from the team.
        </p>
      )

    case 'remaining':
      return (
        <p className={`text-xs ${state.nearlyGone ? WARN_TONE : 'text-muted-foreground'}`}>
          <span className="font-medium">{fmtNum(state.left)}</span> of {fmtNum(state.total)} contacts
          still available
          {state.nearlyGone ? ' — nearly exhausted' : ''}
        </p>
      )
  }
}

/**
 * The "N & Audience" body of the project field grid. Renders the summed
 * top-level N fields (read-only when the project is split into segments,
 * editable otherwise) plus the audience, the gen-pop floor warning, and — when
 * segmented — a collapsible per-segment editor with add / remove + session Undo.
 */
export function NSegmentsEditor({ project }: { project: SurveyProject }) {
  const { data: segments = [] } = useProjectSegments(project.id)
  const updateProject = useUpdateProject()
  const split = useSplitProject(project.id)
  const addSeg = useAddSegment(project.id)
  const removeSeg = useRemoveSegment(project.id)

  const [expanded, setExpanded] = useState(false)
  // Session-level Undo: the last-removed segment's full payload. Cleared when
  // re-added or replaced by a newer removal.
  const [undo, setUndo] = useState<ProjectSegment | null>(null)

  const segmented = (project.segment_count ?? 0) > 0 || segments.length > 0
  const count = segments.length
  // Summed here as well as in the database (sync_segment_totals) so the total
  // reads correctly straight after a segment edit, before the re-summed parent
  // row round-trips back.
  const segmentTotal = sumNRange(segments)

  const saveProject = (updates: ProjectUpdate) =>
    updateProject.mutate({ id: project.id, updates })

  // When segmented, the top fields are a rollup of the segments — but they stay
  // directly editable. Editing a segment re-sums and overwrites the top on save;
  // a direct edit to a top field sticks until the next segment change rolls up.
  const sumNote = (base: string) =>
    segmented
      ? `${base} · Rolls up from ${count} segment${count === 1 ? '' : 's'}: editing a segment overwrites this on save, but a direct edit here stays until then.`
      : base

  function handleRemove(seg: ProjectSegment) {
    setUndo(seg)
    removeSeg.mutate(seg.id)
  }

  function handleUndo() {
    if (!undo) return
    addSeg.mutate({
      label: undo.label,
      n_target: undo.n_target,
      // Both ends, or Undo would restore the segment as an open-ended min.
      n_target_max: undo.n_target_max,
      n_internal_target: undo.n_internal_target,
      n_collected: undo.n_collected,
      n_actual: undo.n_actual,
      audience: undo.audience,
      audience_size: undo.audience_size,
      // Restored too, or Undo hands back the list without the spend against it
      // and "contacts still available" jumps back to the untouched full pool.
      audience_used: undo.audience_used,
      sort_order: undo.sort_order,
    })
    setUndo(null)
  }

  return (
    <FieldSection title="N & Audience" tooltip={TIP.section}>
      {/* Top-level N (summed + read-only when segmented, editable otherwise). */}
      <NRangeCell
        label="N Target"
        tooltip={sumNote(TIP.nTarget)}
        min={project.n_target}
        max={project.n_target_max}
        onSave={r => saveProject({ n_target: r.min, n_target_max: r.max })}
      />
      <NumberCell
        label="N Internal Target"
        tooltip={sumNote(TIP.nInternal)}
        value={project.n_internal_target ?? null}
        onSave={v => saveProject({ n_internal_target: v })}
      />
      <NumberCell
        label="N Collected"
        tooltip={sumNote(TIP.nCollected)}
        value={project.n_collected}
        onSave={v => saveProject({ n_collected: v ?? 0 })}
      />
      <NumberCell
        label="N Actual"
        tooltip={sumNote(TIP.nActual)}
        value={project.n_actual}
        onSave={v => saveProject({ n_actual: v })}
      />

      {/* Audience lives at the top level only in single-N mode; per segment otherwise. */}
      {!segmented && (
        <>
          <TextCell
            label="Audience"
            tooltip={TIP.audience}
            value={project.audience}
            placeholder="e.g. US adults 18+, likely voters"
            onSave={v => saveProject({ audience: v || null })}
          />
          <NumberCell
            label="Total Available Audience Size"
            tooltip={TIP.audienceSize}
            value={project.audience_size}
            onSave={v => saveProject({ audience_size: v })}
          />
          <NumberCell
            label="Audience Size Used"
            tooltip={TIP.audienceUsed}
            value={project.audience_used}
            onSave={v => saveProject({ audience_used: v })}
          />
          <div className="sm:col-span-2">
            <AudienceRemaining size={project.audience_size} used={project.audience_used} />
          </div>
        </>
      )}

      {/* Full-width rows below the 2-col cell grid. */}
      <div className="sm:col-span-2">
        {/* Once split, the top-level Audience field is no longer rendered (see the
            `!segmented` guard above) and sync_segment_totals rolls up the N
            columns but NOT audience — so the parent row keeps whatever string
            was there before the split, invisible and uneditable. Feeding that to
            the floor check meant a Buyers/Sellers project could show a gen-pop
            warning sourced from a stale pre-split audience nobody could see or
            correct. Judge the segments' own audiences instead. */}
        <GenPopNWarning
          project={{
            ...project,
            audience: segmented
              ? segments.map(sg => sg.audience).filter(Boolean).join('; ') || null
              : project.audience,
          }}
        />
      </div>

      {undo && (
        <div className="sm:col-span-2 mt-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          <span>
            Removed segment{undo.label ? ` “${undo.label}”` : ''}.
          </span>
          <button
            onClick={handleUndo}
            className="shrink-0 font-medium text-foreground/80 hover:text-foreground"
          >
            ↩ Undo
          </button>
        </div>
      )}

      {!segmented ? (
        <div className="sm:col-span-2 pt-2">
          <button
            onClick={() =>
              split.mutate({
                n_target: project.n_target,
                n_target_max: project.n_target_max,
                n_internal_target: project.n_internal_target,
                n_collected: project.n_collected,
                n_actual: project.n_actual ?? null,
                audience: project.audience,
                audience_size: project.audience_size,
                audience_used: project.audience_used,
              })
            }
            className="text-sm font-medium text-primary hover:underline"
            title="Track separate collections (e.g. Buyers / Sellers) under this project — add as many segments as you need"
          >
            ＋ Split into segments
          </button>
        </div>
      ) : (
        <div className="sm:col-span-2 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-foreground/90 transition-colors hover:text-foreground"
            >
              <Caret open={expanded} className="text-primary" />
              N Segments · {count}
            </button>
            <button
              onClick={() => addSeg.mutate(segments.length)}
              className="text-sm font-medium text-primary hover:underline"
            >
              + Add segment
            </button>
          </div>
          {count > 0 && (
            <p className="mb-2 text-[11px] text-muted-foreground" title={TIP.segmentTotal}>
              Segment N Target total: {formatNRange(segmentTotal.min, segmentTotal.max, '—')}
            </p>
          )}
          {expanded && (
            <div className="flex flex-col gap-2">
              {segments.map((s, i) => (
                <SegmentBlock key={s.id} segment={s} index={i} onRemove={handleRemove} />
              ))}
            </div>
          )}
        </div>
      )}
    </FieldSection>
  )
}

/**
 * Is the note column there yet, and what does it say?
 *
 * Migration 084 is applied BY HAND, at a different time from this deploy, so both
 * schemas have to work. useProjectSegments selects `*`, which makes key PRESENCE
 * the honest signal: pre-084 the row arrives with NO `note` key at all, post-084
 * it arrives with `note: null`. That costs no extra query — contrast
 * useProjectFinancials, which needs its own isolated read because price_per_n
 * also sits behind a whole table (082) that may be missing.
 *
 * `supported: false` hides the note affordance COMPLETELY rather than offering a
 * field whose save can only fail: PostgREST rejects the entire request when a
 * body names a column missing from its schema cache. And because this reads the
 * live row, the note appears by itself the moment the SQL is applied — no second
 * deploy, no flag.
 *
 * Exported for its own test: the pre-migration branch is the half that cannot be
 * exercised against a database that already has the column.
 */
export function readSegmentNote(segment: unknown): {
  supported: boolean
  note: string | null
} {
  // `unknown` in, deliberately: whether a row HAS a note is a runtime fact about
  // the database, not something the generated types can settle — types.ts is
  // regenerated in its own pass and, pre-084, would be RIGHT to omit the column.
  const supported = typeof segment === 'object' && segment !== null && 'note' in segment
  const raw = supported ? (segment as { note?: unknown }).note : null
  // '' and '   ' both mean "no note". The editor below writes null when cleared,
  // but a row touched by SQL or the connector can hold either.
  return {
    supported,
    note: typeof raw === 'string' && raw.trim() !== '' ? raw : null,
  }
}

/**
 * A cached segment row as this file has to treat it: the generated ProjectSegment
 * plus the OPTIONAL note column, because pre-084 it genuinely is not there. Used
 * for the optimistic patch below — `Row` itself would reject `note` as an excess
 * property, which is TypeScript telling the truth about a schema this code is
 * deliberately written to straddle.
 */
type SegmentRow = ProjectSegment & { note?: string | null }

/**
 * Pre-084, PostgREST answers PGRST204 — "Could not find the 'note' column of
 * 'project_segments' in the schema cache". The UI hides the control in that case,
 * so this only fires when a schema cache is stale (or the column was reverted).
 * Name the migration rather than repeating a raw PostgREST string at the user.
 */
function needsNoteMigration(e: unknown): boolean {
  const err = e as { code?: string; message?: string }
  return err?.code === 'PGRST204' || /schema cache/i.test(err?.message ?? '')
}

/**
 * The note write, deliberately ISOLATED from useUpdateSegment — the posture
 * useSetSegmentRate (lib/hooks/useProjectFinancials.ts) takes for price_per_n,
 * for the same two reasons:
 *  · a PATCH body that names a column PostgREST cannot see fails ENTIRELY, so the
 *    note must never ride along with n_target / n_collected. On its own, a stale
 *    schema cache costs you the note; bundled, it would cost you the numbers.
 *  · useUpdateSegment's payload IS the N contract (it asserts 078's min+max pair
 *    on every call). A freeform sentence has no business in that type.
 *
 * Only the segments cache is invalidated: a note moves no total, no spend and no
 * board field, so ['project'] and ['projects'] are deliberately left alone.
 */
function useSetSegmentNote(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  const key = ['segments', projectId]
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string | null }) => {
      // `note` is not in the generated Database type yet (types.ts is regenerated
      // in its own pass), so this one write goes through an untyped handle.
      const db = supabase as unknown as SupabaseClient
      const { error } = await db.from('project_segments').update({ note }).eq('id', id)
      if (error) throw error
    },
    // Optimistic, in useClientNotes' shape. Not a nicety: the note row is only
    // rendered when the ROW has a note, so writing the first one would make the
    // editor close onto nothing for the length of a round trip — which reads
    // exactly like "it didn't save". Rolling back on error is what makes this
    // safe pre-084 as well: the restored snapshot has no `note` key, so the
    // affordance disappears again instead of showing a note the table can't hold.
    onMutate: async ({ id, note }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<SegmentRow[]>(key)
      qc.setQueryData<SegmentRow[]>(key, old =>
        (old ?? []).map(s => (s.id === id ? { ...s, note } : s)),
      )
      return previous
    },
    onError: (e: Error, _vars, previous) => {
      qc.setQueryData(key, previous)
      toast(
        needsNoteMigration(e)
          ? 'Segment notes need the project_segments note migration (084) in Supabase, then try again.'
          : "Couldn't save the note — it was reverted.",
      )
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

/**
 * One segment's note: a full-width row at the foot of the segment card that is
 * CLICK-TO-EDIT AS A WHOLE LINE — the treatment a blast's description got in the
 * deliberate 2026-07-21 change, rather than the launch note's always-visible
 * textarea (077 / SuppliersWidget). The difference matters here: a segment card
 * already carries a label, an N range, an internal target, collected, actual,
 * audience, audience size and a price override, so a permanently open textarea
 * per segment would push the numbers out of view. The editor is still a textarea,
 * because a note is a sentence and not a field.
 *
 * The empty state renders NOTHING — no placeholder row, no empty box. The
 * "＋ Note" trigger lives in the card's existing header row instead, so a segment
 * without a note is not one pixel taller than before. Fully controlled (the
 * header trigger has to be able to open it) and so testable on its own, the way
 * NRangeCell is.
 */
export function SegmentNote({
  note,
  editing,
  onOpen,
  onClose,
  onSave,
}: {
  note: string | null
  editing: boolean
  onOpen: () => void
  onClose: () => void
  /** null when the note is cleared — never '' (see readSegmentNote). */
  onSave: (note: string | null) => void
}) {
  const [saved, flash] = useSavedFlash()
  const escaped = useRef(false)

  // Uncontrolled textarea seeded from defaultValue — the same shape the launch
  // note uses: no draft state to keep in sync, and a background refetch mid-edit
  // cannot overwrite what is being typed.
  function commit(e: React.FocusEvent<HTMLTextAreaElement>) {
    if (escaped.current) {
      escaped.current = false
      onClose()
      return
    }
    const next = e.target.value.trim() || null
    // Only write when something actually changed — opening and closing a note
    // should not spend a round trip or refetch the list.
    if (next !== note) {
      onSave(next)
      flash()
    }
    onClose()
  }

  if (editing) {
    return (
      <FieldCell label="Note" tooltip={TIP.segmentNote} editing saved={saved}>
        <textarea
          autoFocus
          rows={2}
          defaultValue={note ?? ''}
          aria-label="Segment note"
          placeholder="e.g. client asked for the oversample here — quota is regional"
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault()
              escaped.current = true
              e.currentTarget.blur()
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              // Enter alone has to stay a newline in a multi-line note, so the
              // keyboard save is the usual ⌘/Ctrl+Enter.
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          className="w-full resize-y rounded border border-border bg-muted px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          This segment only. Enter adds a line · click away or ⌘/Ctrl+Enter to save · Esc
          to cancel.
        </p>
      </FieldCell>
    )
  }

  // No note and not editing: render nothing at all. This is the line that keeps
  // an un-noted segment from growing a row.
  if (!note) return null

  return (
    <FieldCell label="Note" tooltip={TIP.segmentNote} editable onEdit={onOpen} saved={saved}>
      {/* FieldCell truncates the value slot to a single line, so a 500-word note
          can never stretch the card; title= keeps all of it readable on hover. */}
      <span className="truncate" title={note}>
        {note}
      </span>
    </FieldCell>
  )
}

/** One editable segment: name, full N, audience, and a per-segment note — each
 *  cell writes through useUpdateSegment (the note through its own isolated
 *  write). The ✕ hands the whole row up for session-level Undo. */
function SegmentBlock({
  segment,
  index,
  onRemove,
}: {
  segment: ProjectSegment
  index: number
  onRemove: (s: ProjectSegment) => void
}) {
  const update = useUpdateSegment(segment.project_id)
  const save = (updates: Partial<SegmentInput>) => update.mutate({ id: segment.id, updates })
  const setNote = useSetSegmentNote(segment.project_id)
  // Note state is lifted here because two controls open the same editor: the
  // "＋ Note" trigger in the header (the empty state) and the note row itself.
  const { supported: noteSupported, note } = readSegmentNote(segment)
  const [editingNote, setEditingNote] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5">
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Segment {index + 1}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {/* The empty-state trigger rides in this EXISTING header row, so a
              segment with no note stays exactly as tall as it is today. Hidden
              entirely pre-084 (readSegmentNote), and replaced by the note row
              itself once there is something to click. */}
          {noteSupported && !note && !editingNote && (
            <>
              <button
                type="button"
                onClick={() => setEditingNote(true)}
                title="Add a note about this segment"
                className="text-[11px] font-medium text-primary hover:underline"
              >
                ＋ Note
              </button>
              <InfoTooltip text={TIP.segmentNote} />
            </>
          )}
          <button
            onClick={() => onRemove(segment)}
            title="Remove segment"
            className="text-sm text-muted-foreground/50 transition-colors hover:text-red-600 dark:hover:text-red-400"
          >
            ✕
          </button>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextCell
            label="Segment name"
            value={segment.label}
            placeholder="e.g. Buyers"
            onSave={v => save({ label: v })}
          />
        </div>
        <NRangeCell
          label="N Target"
          tooltip={TIP.nTarget}
          min={segment.n_target}
          max={segment.n_target_max}
          onSave={r => save({ n_target: r.min, n_target_max: r.max })}
        />
        <NumberCell
          label="N Internal Target"
          value={segment.n_internal_target}
          onSave={v => save({ n_internal_target: v })}
        />
        <NumberCell
          label="N Collected"
          value={segment.n_collected}
          onSave={v => save({ n_collected: v ?? 0 })}
        />
        <NumberCell
          label="N Actual"
          value={segment.n_actual}
          onSave={v => save({ n_actual: v })}
        />
        <TextCell
          label="Audience"
          value={segment.audience}
          placeholder="e.g. US adults 18+"
          onSave={v => save({ audience: v || null })}
        />
        <NumberCell
          label="Total Available Audience Size"
          tooltip={TIP.audienceSize}
          value={segment.audience_size}
          onSave={v => save({ audience_size: v })}
        />
        <NumberCell
          label="Audience Size Used"
          tooltip={TIP.audienceUsed}
          value={segment.audience_used}
          onSave={v => save({ audience_used: v })}
        />
        {/* Per segment, and never summed to the project. Two segments can draw on
            the SAME handed-over list, so adding their pools would overstate
            supply — the same double-count that made PR00309's blast reach three
            times its actual audience. Migration 094 keeps audience out of
            sync_segment_totals for this reason. */}
        <div className="sm:col-span-2">
          <AudienceRemaining size={segment.audience_size} used={segment.audience_used} />
        </div>
        {noteSupported && (note || editingNote) && (
          <div className="sm:col-span-2">
            <SegmentNote
              note={note}
              editing={editingNote}
              onOpen={() => setEditingNote(true)}
              onClose={() => setEditingNote(false)}
              onSave={v => setNote.mutate({ id: segment.id, note: v })}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** Draft text -> a number, null (cleared), or 'bad' (unparseable). Same
 *  `=`-sum and comma handling as NumberCell, via the shared commitNumber. */
function parseDraft(raw: string): number | null | 'bad' {
  const s = commitNumber(raw)
  if (s === '—') return null
  const n = parseFloat(s.replace(/,/g, ''))
  return Number.isNaN(n) ? 'bad' : n
}

/**
 * Inline editor for the N-target RANGE — ONE cell that saves BOTH ends in a
 * single object.
 *
 * That is not a style choice. Migration 078's enforce_n_target_range trigger
 * raises when max < min, and it only sees the columns a patch actually carries,
 * so saving one end at a time has no safe order: widening 100..200 to 1000..2000
 * fails if the min goes first, and narrowing it back fails if the max goes
 * first. Two independent inline cells therefore cannot work — hence a combined
 * editor whose only exit is `onSave({ min, max })`.
 *
 * The common case is still one number: an empty max means "one agreed N" and
 * mirrors the min, and when the two ends already match, the max box opens blank
 * behind a "same as min" placeholder — so changing an agreed N stays a single
 * edit rather than two.
 */
export function NRangeCell({
  label,
  tooltip,
  min,
  max,
  onSave,
}: {
  label: string
  tooltip?: string
  min: number | null
  max: number | null
  onSave: (range: NRange) => void
}) {
  const [editing, setEditing] = useState(false)
  const [loDraft, setLoDraft] = useState('')
  const [hiDraft, setHiDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, flash] = useSavedFlash()
  const escaped = useRef(false)
  // Set while the editor is closing, so the unmount blur of whichever input
  // still holds focus cannot fire a second, stale commit.
  const closing = useRef(false)
  const boxRef = useRef<HTMLDivElement>(null)

  function begin() {
    const r = resolveNRange(min, max)
    setLoDraft(r.min != null ? String(r.min) : '')
    // Equal ends ARE the single-number case, so the max box starts empty.
    setHiDraft(r.max != null && r.max !== r.min ? String(r.max) : '')
    setError(null)
    escaped.current = false
    closing.current = false
    setEditing(true)
  }

  function commit() {
    if (closing.current) return
    if (escaped.current) {
      escaped.current = false
      closing.current = true
      setError(null)
      setEditing(false)
      return
    }
    const lo = parseDraft(loDraft)
    const hi = parseDraft(hiDraft)
    if (lo === 'bad' || hi === 'bad') {
      // Unparseable — keep the editor open and leave BOTH stored values alone
      // rather than writing half a range.
      setError('Not a number')
      return
    }
    // Either end on its own means one agreed number; never emit a half pair.
    const range = resolveNRange(lo, hi)
    if (isInvertedNRange(range.min, range.max)) {
      // Caught here so a transposed range is reported next to the two boxes that
      // caused it. The database guards this too, but its message only arrives
      // after a save has already failed.
      setError(`Max (${fmtNum(range.max)}) is below min (${fmtNum(range.min)}) — swap them?`)
      return
    }
    closing.current = true
    onSave(range)
    flash()
    setError(null)
    setEditing(false)
  }

  // Only commit when focus truly leaves the cell — tabbing from the min box to
  // the max box must not save a half-typed range.
  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const next = e.relatedTarget as Node | null
    if (next && boxRef.current?.contains(next)) return
    commit()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      escaped.current = true
      e.currentTarget.blur()
    }
  }

  const inputClass = cn(
    'min-w-0 flex-1 rounded border bg-muted px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none',
    error ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-ring',
  )

  if (editing) {
    return (
      <FieldCell label={label} tooltip={tooltip} editing saved={saved}>
        <div ref={boxRef}>
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              aria-label={`${label} minimum`}
              value={loDraft}
              placeholder="e.g. 1350"
              aria-invalid={error != null}
              onChange={e => {
                setLoDraft(e.target.value)
                if (error) setError(null)
              }}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className={inputClass}
            />
            <span aria-hidden="true" className="shrink-0 text-sm text-muted-foreground">
              –
            </span>
            <input
              type="text"
              inputMode="numeric"
              aria-label={`${label} maximum`}
              value={hiDraft}
              placeholder="same as min"
              aria-invalid={error != null}
              onChange={e => {
                setHiDraft(e.target.value)
                if (error) setError(null)
              }}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className={inputClass}
            />
          </div>
          {error ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Min – max. Leave the max blank for a single agreed N.
            </p>
          )}
        </div>
      </FieldCell>
    )
  }

  const display = formatNRange(min, max, '')

  return (
    <FieldCell label={label} tooltip={tooltip} editable onEdit={begin} saved={saved}>
      {display === '' ? (
        <span className="text-muted-foreground/50">— set</span>
      ) : (
        <span className="truncate">{display}</span>
      )}
    </FieldCell>
  )
}
