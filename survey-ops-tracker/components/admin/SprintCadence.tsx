'use client'
import { useState } from 'react'
import { useSprintConfig, useUpdateSprintConfig } from '@/lib/hooks/useSprintConfig'
import { currentSprintNumber, sprintLabel } from '@/lib/utils/sprints'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

export function SprintCadence() {
  const { data: cfg, isLoading, isError } = useSprintConfig()
  const update = useUpdateSprintConfig()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const heading = 'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center'

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <h3 className={heading}>
        Sprint cadence
        <InfoTooltip text="Internal projects are planned in 2-week sprints. Set when Sprint 1 began; every sprint after rolls forward automatically and is numbered the same for everyone. Internal projects pick a sprint from this cadence." />
      </h3>

      {isError || (!isLoading && !cfg) ? (
        <p className="text-xs text-muted-foreground/70">Sprint cadence needs the latest database migration (033).</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <div className="text-foreground">
            Today is <span className="font-medium">{sprintLabel(currentSprintNumber(cfg!), cfg!)}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="text-xs">Sprint 1 started</span>
            {editing ? (
              <>
                <input
                  type="date"
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  className="bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
                />
                <button
                  onClick={() => {
                    if (draft) update.mutate(draft)
                    setEditing(false)
                  }}
                  className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded transition-colors"
                >
                  Save
                </button>
                <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground px-1">
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setDraft(cfg!.anchor_date.slice(0, 10))
                  setEditing(true)
                }}
                className="text-sm text-foreground hover:bg-accent rounded px-1.5 transition-colors cursor-pointer"
                title="Change when Sprint 1 began"
              >
                {new Date(cfg!.anchor_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground/60">
            Changing this renumbers all sprints. Set it once to match your real cadence.
          </p>
        </div>
      )}
    </div>
  )
}
