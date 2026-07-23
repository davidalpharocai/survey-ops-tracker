'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { FieldCell, DateCell, NumberCell, TextCell } from './fields'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import {
  useProjectBlasts,
  useAddBlast,
  useUpdateBlast,
  useDeleteBlast,
  type Blast,
} from '@/lib/hooks/useProjectBlasts'
import { blastTotal } from '@/lib/utils/blast'
import type { SurveyProject } from '@/lib/hooks/useProjects'

const TIP = {
  header:
    'Log each B2B blast: its $/bid (the per-completion reward), when it went out, how many people it reached, and how many completed. A blast’s cost ($/bid × completes) counts toward the project’s spend — we only pay for completes, not everyone reached.',
  sent: 'When the blast actually went out — pick the date and time (AM/PM).',
  people: 'How many people this blast reached. Informational — it does not drive the cost.',
  completes:
    'How many of those people completed the survey. Trickles in after send — editable. Cost = $/bid × completes.',
  bid: 'The per-completion reward (dollars paid per completed response). $/bid × completes = this blast’s cost.',
  cost: 'This blast’s spend = $/bid × completes. Feeds the project’s actual spend.',
  note: 'Optional note on who this blast targeted — e.g. “3PL companies + retailers”. Doesn’t affect the cost.',
}

function money(v: number): string {
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/**
 * The Money-section blast display for B2B / Rerun projects. Mirrors
 * `NSegmentsEditor`: a collapsible subheader with a right-aligned "+ Log blast",
 * one inset block per blast (fields wired straight through the blast hooks), and
 * a ✕ remove with a session-level Undo bar. Cost per blast stays $/bid ×
 * completes (via `blastTotal`); the DB trigger recomputes `actual_spend`.
 */
export function BlastBlocks({ project }: { project: SurveyProject }) {
  const supabase = createClient()
  const { data: blasts, isError } = useProjectBlasts(project.id)
  const add = useAddBlast(project.id)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  const [expanded, setExpanded] = useState(true)
  // Session-level Undo: the last-removed blast's payload. Cleared when re-added
  // or replaced by a newer removal.
  const [undo, setUndo] = useState<Blast | null>(null)

  if (isError) {
    return (
      <div className="border-t border-border pt-3 mt-1">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Blasts</p>
        <p className="text-xs text-muted-foreground/70">Blasts need the latest database migration.</p>
      </div>
    )
  }

  const list = blasts ?? []
  const count = list.length

  // The per-block ✕ deletes via its own useDeleteBlast; here we just stash the
  // removed blast so the Undo bar can re-add it.
  function handleRemove(blast: Blast) {
    setUndo(blast)
  }

  function handleUndo() {
    if (!undo) return
    add.mutate(
      {
        bid: undo.bid,
        people: undo.people,
        completes: undo.completes,
        blast_at: undo.blast_at,
        note: undo.note,
        created_by: undo.created_by ?? userName,
      },
      { onSuccess: () => setUndo(null) },
    )
  }

  return (
    <div className="border-t border-border pt-3 mt-1">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="text-sm leading-none text-primary">{expanded ? '▾' : '▸'}</span>
            Blasts · {count}
          </button>
          <InfoTooltip text={TIP.header} />
        </span>
        <button
          onClick={() =>
            add.mutate({ bid: 0, people: 0, completes: 0, blast_at: null, note: '', created_by: userName })
          }
          disabled={add.isPending}
          className="text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          {add.isPending ? 'Adding…' : '+ Log blast'}
        </button>
      </div>

      {undo && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          <span>Removed blast{undo.note ? ` “${undo.note}”` : ''}.</span>
          <button onClick={handleUndo} className="shrink-0 font-medium text-foreground/80 hover:text-foreground">
            ↩ Undo
          </button>
        </div>
      )}

      {expanded && (
        <div className="flex flex-col gap-2">
          {list.map((b, i) => (
            <BlastBlock key={b.id} blast={b} index={i} onRemove={handleRemove} />
          ))}
          {count === 0 && (
            <p className="text-xs text-muted-foreground/60">No blasts logged yet — use + Log blast.</p>
          )}
        </div>
      )}
    </div>
  )
}

/** One editable blast: sent date-time, reach, completes, $/bid, a read-only cost,
 *  and a description — each cell writes through useUpdateBlast. The ✕ hands the
 *  whole row up for session-level Undo and deletes it. */
function BlastBlock({
  blast,
  index,
  onRemove,
}: {
  blast: Blast
  index: number
  onRemove: (b: Blast) => void
}) {
  const update = useUpdateBlast(blast.project_id)
  const del = useDeleteBlast(blast.project_id)
  const save = (updates: Partial<Blast>) => update.mutate({ id: blast.id, updates })

  function remove() {
    onRemove(blast)
    del.mutate(blast.id)
  }

  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5">
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Blast {index + 1}
        </span>
        <button
          onClick={remove}
          title="Remove blast"
          className="shrink-0 text-sm text-muted-foreground/50 transition-colors hover:text-red-600 dark:hover:text-red-400"
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextCell
            label="Description"
            tooltip={TIP.note}
            value={blast.note}
            placeholder="e.g. 3PL companies + retailers"
            onSave={v => save({ note: v || null })}
          />
        </div>
        <DateCell
          label="Sent"
          tooltip={TIP.sent}
          mode="datetime"
          value={blast.blast_at}
          onSave={iso => save({ blast_at: iso })}
        />
        <NumberCell
          label="$ / bid"
          tooltip={TIP.bid}
          value={blast.bid}
          onSave={v => save({ bid: v ?? 0 })}
        />
        <NumberCell
          label="# people (reach)"
          tooltip={TIP.people}
          value={blast.people}
          onSave={v => save({ people: v ?? 0 })}
        />
        <NumberCell
          label="# completes"
          tooltip={TIP.completes}
          value={blast.completes}
          onSave={v => save({ completes: v ?? 0 })}
        />
        <FieldCell label="Cost" tooltip={TIP.cost}>
          <span className="tabular-nums">{money(blastTotal(blast))}</span>
        </FieldCell>
      </div>
    </div>
  )
}
