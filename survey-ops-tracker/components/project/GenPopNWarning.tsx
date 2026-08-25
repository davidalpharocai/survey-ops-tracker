'use client'
import { useState } from 'react'
import { nFloorCheck } from '@/lib/utils/nFloor'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { fmtNum } from '@/lib/utils/number'
import { toast } from '@/lib/utils/toast'

type P = {
  id: string
  audience: string | null
  project_type?: string | null
  /** The number this card judges — OUR internal goal, not the client's N target. */
  n_internal_target: number | null
  n_collected?: number | null
  n_actual: number | null
  /** Fielding ticked = n_collected is final, which is what turns the
   *  delivery-time re-check on. See nFloorCheck's `collectionFinal`. */
  stage_fielding?: boolean | null
  n_floor_override?: boolean | null
  n_floor_override_reason?: string | null
}

/** "A", "A and B", "A, B and C" — for naming exactly the numbers that are short. */
function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Soft advisory in the N & Audience card when a population-representative study
// sits below our internal sampling standard (national 1,350 / state 500).
//
// It judges N INTERNAL TARGET, never N Target: the floor is our own cushion, and
// a client contracting 1,000 while we internally target 1,350 is a correctly
// set-up project — the old version scolded exactly that. Two shapes follow from
// that:
//   · no internal target set at all → a plain SETUP prompt (go type the number).
//     Nothing to sign off, so no override.
//   · an internal target below the floor → the deliberate typed "override" +
//     optional reason, which persists on the project and can be undone.
//
// Once Fielding is ticked the same card also re-checks what we actually
// COLLECTED, and always re-checks the cleaned N ACTUAL — the check that has to
// happen before a project is marked Delivered. Gated on `stage_fielding` rather
// than running always, because n_collected climbs from zero and would otherwise
// sit under the floor (demanding a sign-off) for most of every field period.
export function GenPopNWarning({ project }: { project: P }) {
  const check = nFloorCheck({ ...project, collectionFinal: project.stage_fielding === true })
  const update = useUpdateProject()
  const [overriding, setOverriding] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [reason, setReason] = useState('')

  // Nothing to say only when the internal target is fine AND no
  // delivered/collected fact contradicts it.
  if (!check.applies || (check.band === 'ok' && !check.requiresOverride)) return null

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

  // Setup gap, not a sample problem: there is no number to judge yet, so ask for
  // one instead of asserting a shortfall against a blank field.
  //
  // Two conditions beyond the band, both learned the hard way:
  //   · `!project.n_floor_override` — an existing sign-off has to keep working.
  //     This branch used to sit ABOVE the override check below, so a project
  //     someone had already dismissed came back as a fresh amber banner with no
  //     Override button and no Undo on it: literally unclearable without typing
  //     a number into N Internal Target.
  //   · `started` — a fresh project has no internal target by definition, so
  //     typing "Gen pop" into a brand-new row would pop an amber warning
  //     instantly. Nagging at setup time is how a card teaches people to ignore
  //     it, and this module is deliberately biased toward silence.
  const started =
    project.stage_fielding === true ||
    (project.n_collected ?? 0) > 0 ||
    project.n_actual != null
  if (check.band === 'unset' && !check.requiresOverride && !project.n_floor_override && started) {
    return (
      <div className="mt-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
        ⓘ Gen-pop floor: no N Internal Target set. Our internal standard for a {scopeLabel}{' '}
        general-population study is {fmtNum(check.floor)} — set N Internal Target so this study can
        be checked against it.
      </div>
    )
  }

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

  // Name every number that is genuinely short and only those — and name them as
  // what they are, so a typed override reason is given against the figure the
  // project actually carries. A list rather than nested ternaries because the
  // three shortfalls are independent — our internal target, the N we collected,
  // the N we delivered — and any combination is real.
  const short: string[] = []
  if (check.band === 'warning') short.push(`N internal target ${fmtNum(check.internalTarget ?? 0)}`)
  if (check.shortfallCollected) short.push(`N collected ${fmtNum(project.n_collected ?? 0)}`)
  if (check.shortfallActual) short.push(`N actual ${fmtNum(project.n_actual ?? 0)}`)
  const shortfallText = `${joinAnd(short)} ${short.length > 1 ? 'are' : 'is'}`

  return (
    <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300 flex flex-col gap-1.5">
      <p>
        ⚠ Gen-pop floor: {shortfallText} under the {fmtNum(check.floor)} we target internally for a{' '}
        {scopeLabel} general-population study.
      </p>
      {/* A fact is short while the plan is blank — say so, or the fix looks like
          it is only ever "click override". */}
      {check.band === 'unset' && (
        <p className="text-amber-700/80 dark:text-amber-300/80">
          No N Internal Target is set on this project either.
        </p>
      )}
      {/* Say what the override is FOR at this point in the pipeline. Fielding is
          done, so this number won't grow on its own — the next step is delivery. */}
      {check.shortfallCollected && (
        <p className="text-amber-700/80 dark:text-amber-300/80">
          Fielding is marked done, so this is the N we finished with. Sign it off before delivering.
        </p>
      )}
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
