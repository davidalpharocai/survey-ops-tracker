'use client'
import { Caret } from '@/components/shared/Caret'

import { useRef, useState } from 'react'
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
    'Total size of the panel or population being surveyed. Different from N (target responses).',
  audience:
    'Who the survey is fielded to — the target respondent profile (free text, e.g. "US adults 18+, likely voters").',
  segmentTotal:
    'The project N Target: the sum of the segment minimums through to the sum of the segment maximums.',
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
            label="Audience Size"
            tooltip={TIP.audienceSize}
            value={project.audience_size}
            onSave={v => saveProject({ audience_size: v })}
          />
        </>
      )}

      {/* Full-width rows below the 2-col cell grid. */}
      <div className="sm:col-span-2">
        <GenPopNWarning project={project} />
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

/** One editable segment: name, full N, and audience — each cell writes through
 *  useUpdateSegment. The ✕ hands the whole row up for session-level Undo. */
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

  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5">
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Segment {index + 1}
        </span>
        <button
          onClick={() => onRemove(segment)}
          title="Remove segment"
          className="shrink-0 text-sm text-muted-foreground/50 transition-colors hover:text-red-600 dark:hover:text-red-400"
        >
          ✕
        </button>
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
          label="Audience Size"
          value={segment.audience_size}
          onSave={v => save({ audience_size: v })}
        />
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
