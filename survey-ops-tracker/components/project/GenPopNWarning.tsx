'use client'
import { useState } from 'react'
import { nFloorCheck } from '@/lib/utils/nFloor'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { fmtNum } from '@/lib/utils/number'
import { toast } from '@/lib/utils/toast'

type P = {
  id: string
  salesperson: string | null
  audience: string | null
  n_target: number | null
  n_actual: number | null
  n_floor_override?: boolean | null
  n_floor_override_reason?: string | null
}

// Soft warning shown in the Sample N card when a Jenna general-population study
// is below its expected N floor. Dismiss deliberately (type "override") with an
// optional reason; the override persists on the project and can be undone.
export function GenPopNWarning({ project }: { project: P }) {
  const check = nFloorCheck(project)
  const update = useUpdateProject()
  const [overriding, setOverriding] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [reason, setReason] = useState('')

  if (!check.applies || (!check.shortfallTarget && !check.shortfallActual)) return null

  function setOverride(on: boolean, why: string | null) {
    update.mutate(
      { id: project.id, updates: { n_floor_override: on, n_floor_override_reason: on ? why : null } },
      {
        onSuccess: () => {
          toast(on ? 'Override saved.' : 'Warning re-enabled.', 'success')
          setOverriding(false)
          setConfirmText('')
          setReason('')
        },
        onError: (e) => {
          const msg = (e as Error).message ?? ''
          toast(
            msg.includes('n_floor_override')
              ? 'This needs the new column — run migration 056 in Supabase, then try again.'
              : msg || 'Could not save. Please try again.'
          )
        },
      }
    )
  }

  const scopeLabel = check.scope === 'state' ? 'state-level' : 'national'

  // Overridden: quiet acknowledgment line + Undo.
  if (project.n_floor_override) {
    return (
      <div className="mt-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground flex items-start justify-between gap-2">
        <span>
          Gen-pop N floor ({fmtNum(check.floor)}) overridden
          {project.n_floor_override_reason ? ` — ${project.n_floor_override_reason}` : ''}.
        </span>
        <button
          onClick={() => setOverride(false, null)}
          disabled={update.isPending}
          className="text-muted-foreground/70 hover:text-foreground shrink-0 disabled:opacity-40"
        >
          Undo
        </button>
      </div>
    )
  }

  const shortfallText =
    check.shortfallTarget && check.shortfallActual
      ? `N target ${fmtNum(project.n_target ?? 0)} and N actual ${fmtNum(project.n_actual ?? 0)} are`
      : check.shortfallActual
        ? `N actual ${fmtNum(project.n_actual ?? 0)} is`
        : `N target ${fmtNum(project.n_target ?? 0)} is`

  return (
    <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300 flex flex-col gap-1.5">
      <p>
        ⚠ Gen-pop floor: {shortfallText} under the {fmtNum(check.floor)} expected for a {scopeLabel}{' '}
        general-population study.
      </p>
      {!overriding ? (
        <button onClick={() => setOverriding(true)} className="self-start underline hover:no-underline">
          Override
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type override to confirm"
            className="bg-background border border-border rounded px-2 py-1 text-foreground text-xs focus:outline-none focus:border-ring"
          />
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional) — why this N is intentional"
            className="bg-background border border-border rounded px-2 py-1 text-foreground text-xs focus:outline-none focus:border-ring resize-none"
          />
          <div className="flex items-center gap-3">
            <button
              disabled={confirmText.trim().toLowerCase() !== 'override' || update.isPending}
              onClick={() => setOverride(true, reason.trim() || null)}
              className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-1 rounded transition-colors disabled:opacity-40"
            >
              Confirm override
            </button>
            <button
              onClick={() => {
                setOverriding(false)
                setConfirmText('')
                setReason('')
              }}
              className="text-xs text-amber-700/80 dark:text-amber-300/80 hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
