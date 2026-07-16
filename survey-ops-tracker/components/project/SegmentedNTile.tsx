'use client'
import { useState } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { NProgressBar } from '@/components/shared/NProgressBar'
import { fmtNum } from '@/lib/utils/number'
import {
  useProjectSegments,
  useSplitProject,
  useAddSegment,
  useUpdateSegment,
  useRemoveSegment,
  useUnsplitProject,
  type ProjectSegment,
} from '@/lib/hooks/useProjectSegments'
import type { SurveyProject } from '@/lib/hooks/useProjects'

const tile = 'relative border shadow-sm rounded-xl p-2.5 flex flex-col gap-1'
// Default card styling vs. an accented "lead tile" treatment (used as the first
// hero stat — the number that matters most).
const tilePlain = `${tile} bg-card border-border`
const tileAccent = `${tile} bg-primary/[0.04] border-primary/30`

// Once delivered, surface the final N Actual in the tile corner (the number that
// matters post-delivery). Shown when delivered_at is set and N Actual is known.
function DeliveredActualBadge({ project }: { project: SurveyProject }) {
  if (!project.delivered_at || project.n_actual == null) return null
  return (
    <span
      className="absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-medium px-1.5 py-0.5"
      title="Final N Actual (project delivered)"
    >
      ✓ Actual {fmtNum(project.n_actual)}
    </span>
  )
}
const numOrNull = (s: string) => {
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

/** The hero "N collected" tile. Single editable N by default; when split, shows
 *  the total (read-only, summed) plus an editable row per labeled segment. */
export function SegmentedNTile({
  project,
  tooltip,
  onSaveCollected,
  accent = false,
}: {
  project: SurveyProject
  tooltip: string
  onSaveCollected: (next: number | null) => void
  accent?: boolean
}) {
  const { data: segments = [] } = useProjectSegments(project.id)
  const split = useSplitProject(project.id)
  const addSeg = useAddSegment(project.id)
  const unsplit = useUnsplitProject(project.id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const cls = accent ? tileAccent : tilePlain
  const segmented = (project.segment_count ?? 0) > 0 || segments.length > 0

  const TotalNumber = (
    <span className="text-xl font-semibold text-foreground leading-tight">
      {fmtNum(project.n_collected)}
      {project.n_target != null ? (
        <span className="text-base font-normal text-muted-foreground"> / {fmtNum(project.n_target)}</span>
      ) : (
        <span className="text-xs font-normal text-muted-foreground/60"> · no target</span>
      )}
    </span>
  )

  if (segmented) {
    return (
      <div className={cls}>
        <DeliveredActualBadge project={project} />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center">
            N collected · total
            <InfoTooltip text="This project's N is split into segments, each with its own target. The total here is the sum of the segments — edit them below." />
          </span>
          <button
            onClick={() => {
              if (window.confirm('Merge the segments back into a single N? The breakdown is removed; the total stays.')) unsplit.mutate()
            }}
            className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
            title="Merge segments back into one N"
          >
            merge
          </button>
        </div>
        {TotalNumber}
        <div className="mt-1 mb-2">
          <NProgressBar collected={project.n_collected} target={project.n_target} showLabel={false} />
        </div>
        <div className="flex flex-col gap-2">
          {segments.map(s => (
            <SegmentRow key={s.id} segment={s} projectId={project.id} canRemove={segments.length > 1} />
          ))}
        </div>
        {segments.length < 2 && (
          <button
            onClick={() => addSeg.mutate(segments.length)}
            className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline mt-1 self-start"
          >
            + Add segment
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={cls}>
      <DeliveredActualBadge project={project} />
      <span className="text-xs text-muted-foreground flex items-center">
        N collected
        <InfoTooltip text={tooltip} />
      </span>
      {editing ? (
        <div className="flex gap-1.5 items-center">
          <input
            autoFocus
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-20 min-w-0 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
            onKeyDown={e => {
              if (e.key === 'Enter') { onSaveCollected(numOrNull(draft) ?? 0); setEditing(false) }
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button
            onClick={() => { onSaveCollected(numOrNull(draft) ?? 0); setEditing(false) }}
            className="text-xs bg-muted hover:bg-accent text-foreground px-2 py-1 rounded transition-colors"
          >
            Save
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setDraft(String(project.n_collected)); setEditing(true) }}
          className="text-xl font-semibold text-foreground leading-tight text-left cursor-pointer hover:bg-accent rounded-md px-1.5 -ml-1.5 transition-colors"
          title="Click to edit"
        >
          {fmtNum(project.n_collected)}
          {project.n_target != null ? (
            <span className="text-base font-normal text-muted-foreground"> / {fmtNum(project.n_target)}</span>
          ) : (
            <span className="text-xs font-normal text-muted-foreground/60"> · no target</span>
          )}
        </button>
      )}
      <div className="mt-1">
        <NProgressBar collected={project.n_collected} target={project.n_target} showLabel={false} />
      </div>
      <button
        onClick={() => split.mutate({ n_target: project.n_target, n_collected: project.n_collected, n_actual: project.n_actual ?? null })}
        className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline mt-1 self-start"
        title="Track two collections (e.g. Buyers / Sellers) under this project"
      >
        ＋ Split into segments
      </button>
    </div>
  )
}

function SegmentRow({ segment, projectId, canRemove }: { segment: ProjectSegment; projectId: string; canRemove: boolean }) {
  const update = useUpdateSegment(projectId)
  const remove = useRemoveSegment(projectId)
  const [label, setLabel] = useState(segment.label)
  const [collected, setCollected] = useState(segment.n_collected?.toString() ?? '0')
  const [target, setTarget] = useState(segment.n_target?.toString() ?? '')
  const [actual, setActual] = useState(segment.n_actual?.toString() ?? '')

  const field = 'w-14 bg-background border border-border rounded px-1.5 py-0.5 text-foreground focus:outline-none focus:border-ring'

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          onBlur={() => { if (label !== segment.label) update.mutate({ id: segment.id, updates: { label: label.trim() } }) }}
          placeholder="Segment name (e.g. Buyers)"
          className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
        />
        {canRemove && (
          <button onClick={() => remove.mutate(segment.id)} title="Remove segment" className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 text-sm shrink-0">
            ×
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <label className="text-muted-foreground">Collected</label>
        <input type="number" value={collected} onChange={e => setCollected(e.target.value)}
          onBlur={() => { const v = numOrNull(collected) ?? 0; if (v !== segment.n_collected) update.mutate({ id: segment.id, updates: { n_collected: v } }) }} className={field} />
        <label className="text-muted-foreground">Target</label>
        <input type="number" value={target} onChange={e => setTarget(e.target.value)}
          onBlur={() => { const v = numOrNull(target); if (v !== segment.n_target) update.mutate({ id: segment.id, updates: { n_target: v } }) }} className={field} />
        <label className="text-muted-foreground">Actual</label>
        <input type="number" value={actual} onChange={e => setActual(e.target.value)}
          onBlur={() => { const v = numOrNull(actual); if (v !== segment.n_actual) update.mutate({ id: segment.id, updates: { n_actual: v } }) }} className={field} />
      </div>
      <NProgressBar collected={segment.n_collected} target={segment.n_target} showLabel={false} />
    </div>
  )
}
