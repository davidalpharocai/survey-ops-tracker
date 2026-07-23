'use client'

import { useState } from 'react'
import { FieldSection, NumberCell, TextCell } from './fields'
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
import type { Database } from '@/lib/supabase/types'

type ProjectUpdate = Database['public']['Tables']['survey_projects']['Update']

const TIP = {
  section:
    'Target and collected sample, plus who the survey is fielded to. Split into per-segment Ns (e.g. Buyers / Sellers) when a project needs separate targets — the totals here then sum the segments.',
  nTarget: "Total number of survey responses you're aiming to collect.",
  nInternal:
    'Your internal collection goal — usually a cushion above N Target to cover cleaning and terminations.',
  nCollected: 'Completes collected so far — also auto-syncs from the sheet.',
  nActual: 'Final usable response count after cleaning N Collected.',
  audienceSize:
    'Total size of the panel or population being surveyed. Different from N (target responses).',
  audience:
    'Who the survey is fielded to — the target respondent profile (free text, e.g. "US adults 18+, likely voters").',
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

  const [expanded, setExpanded] = useState(true)
  // Session-level Undo: the last-removed segment's full payload. Cleared when
  // re-added or replaced by a newer removal.
  const [undo, setUndo] = useState<ProjectSegment | null>(null)

  const segmented = (project.segment_count ?? 0) > 0 || segments.length > 0
  const count = segments.length

  const saveProject = (updates: ProjectUpdate) =>
    updateProject.mutate({ id: project.id, updates })

  // When segmented, the top fields are trigger-summed — note that they're edited
  // per segment below.
  const sumNote = (base: string) =>
    segmented
      ? `${base} · Σ across ${count} segment${count === 1 ? '' : 's'} — edit per segment below.`
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
      <NumberCell
        label="N Target"
        tooltip={sumNote(TIP.nTarget)}
        value={project.n_target}
        readOnly={segmented}
        onSave={v => saveProject({ n_target: v })}
      />
      <NumberCell
        label="N Internal Target"
        tooltip={sumNote(TIP.nInternal)}
        value={project.n_internal_target ?? null}
        readOnly={segmented}
        onSave={v => saveProject({ n_internal_target: v })}
      />
      <NumberCell
        label="N Collected"
        tooltip={sumNote(TIP.nCollected)}
        value={project.n_collected}
        readOnly={segmented}
        onSave={v => saveProject({ n_collected: v ?? 0 })}
      />
      <NumberCell
        label="N Actual"
        tooltip={sumNote(TIP.nActual)}
        value={project.n_actual}
        readOnly={segmented}
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
                n_collected: project.n_collected,
                n_actual: project.n_actual ?? null,
              })
            }
            className="text-[12px] text-blue-600 hover:underline dark:text-blue-400"
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
              className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="text-[10px]">{expanded ? '▾' : '▸'}</span>
              N Segments · {count}
            </button>
            <button
              onClick={() => addSeg.mutate(segments.length)}
              className="text-[12px] text-blue-600 hover:underline dark:text-blue-400"
            >
              + Add segment
            </button>
          </div>
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
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
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
        <NumberCell
          label="N Target"
          value={segment.n_target}
          onSave={v => save({ n_target: v })}
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
