// Per-project risk signal — "which surveys need touching today".
//
// ── WHY IT EXISTS ───────────────────────────────────────────────────────────
// SOCC already knew how to find projects at risk, but only through the
// `whats_at_risk` connector tool: you had to ASK. David (2026-09-11): "we should
// add a risk flag to surveys so they are touched on more when at risk." So the
// same judgement has to live on the survey itself — on the board card, in the
// list, on the project page — where somebody sees it without asking.
//
// ── ONE DEFINITION, NOT TWO ─────────────────────────────────────────────────
// The rules below are lifted from lib/mcp/data.ts whatsAtRisk() deliberately, so
// a project the connector calls at risk and a project the board colours red are
// the same project. A second, drifting definition of "at risk" would be worse
// than none: the first time the board and the assistant disagree, both stop
// being believed. This module is the one place; whatsAtRisk should come to use
// it too rather than keep its own copy.
//
// ── WHAT IT DELIBERATELY IS NOT ─────────────────────────────────────────────
// Not a score. A 0-100 number invites tuning and hides its reasoning; what a
// captain needs is WHICH thing is wrong so they can go fix that thing. So the
// output is a level plus the specific reasons, and the UI shows the reasons.
//
// Not finance-gated by itself. `overBudget` compares spend to the budget
// CEILING, which is finance-only (David/Shanu/Vineet), so callers pass
// `includeBudget` and everyone else simply never sees that reason — the level
// drops accordingly rather than the number being hidden behind an asterisk. A
// risk you cannot see the evidence for is not one you can act on.

import { overTargetCheck } from '@/lib/utils/overTarget'

export type RiskLevel = 'none' | 'watch' | 'at-risk' | 'critical'

export interface RiskReason {
  /** Stable key, for tests and for the connector. */
  code:
    | 'overdue'
    | 'due-soon'
    | 'fielding-behind'
    | 'over-budget'
    | 'over-target'
    | 'no-cost-recorded'
  /** One short sentence a captain can act on. */
  label: string
  level: Exclude<RiskLevel, 'none'>
}

export interface RiskInput {
  board_column?: string | null
  status?: string | null
  phase?: string | null
  due_date?: string | null
  n_target?: number | null
  n_internal_target?: number | null
  n_collected?: number | null
  n_actual?: number | null
  project_type?: string | null
  budget?: number | null
  actual_spend?: number | null
  /** Whether the caller may see budget-vs-spend at all. */
  includeBudget?: boolean
  /** Injectable for tests; defaults to today. ISO yyyy-mm-dd. */
  today?: string
}

export interface RiskVerdict {
  level: RiskLevel
  reasons: RiskReason[]
  /** The worst reason, for a one-line badge. */
  headline: string | null
}

const DAY = 86_400_000
const iso = (d: Date) => d.toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY)

/** Stages where fielding risk is meaningful. A Submitted project is not behind
 *  pace; it has not started. Mirrors whatsAtRisk's isActiveOperational intent. */
const LIVE_STAGES = new Set(['Fielding', 'Data QA', 'EdWin QA', 'Survey Programming', 'Doc Programming'])

const ORDER: Record<RiskLevel, number> = { none: 0, watch: 1, 'at-risk': 2, critical: 3 }

/**
 * Judge one project.
 *
 * SILENT ON CLOSED AND INACTIVE WORK. A delivered project cannot be rescued and
 * a paused one is paused on purpose; flagging either is noise that teaches people
 * to ignore the flag — the same doctrine as nFloor and overTarget.
 */
export function riskOf(input: RiskInput): RiskVerdict {
  const reasons: RiskReason[] = []
  const today = input.today ?? iso(new Date())

  const open = (input.status ?? 'Open') === 'Open' && (input.phase ?? 'Active') === 'Active'
  const stage = input.board_column ?? ''
  const live = open && LIVE_STAGES.has(stage)

  if (open && stage !== 'Delivery' && input.due_date) {
    const d = daysBetween(input.due_date, today)
    if (d < 0) {
      reasons.push({
        code: 'overdue',
        label: `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} past its due date`,
        level: 'critical',
      })
    } else if (d <= 3) {
      reasons.push({
        code: 'due-soon',
        label: d === 0 ? 'Due today' : `Due in ${d} day${d === 1 ? '' : 's'}`,
        level: 'watch',
      })
    }
  }

  // Behind pace: fielding, short of the committed floor, and the clock is nearly
  // out. Judged against n_target (the FLOOR we committed to), not n_target_max.
  if (live && stage === 'Fielding' && input.n_target != null && input.due_date) {
    const collected = Number(input.n_collected ?? 0)
    const target = Number(input.n_target)
    const d = daysBetween(input.due_date, today)
    if (collected < target && d <= 3) {
      const short = target - collected
      reasons.push({
        code: 'fielding-behind',
        label: `${short.toLocaleString('en-US')} N short with ${d < 0 ? 'the date passed' : d === 0 ? 'today left' : `${d} day${d === 1 ? '' : 's'} left`}`,
        level: d < 0 ? 'critical' : 'at-risk',
      })
    }
  }

  if (input.includeBudget && input.budget != null && input.actual_spend != null) {
    const over = Number(input.actual_spend) - Number(input.budget)
    if (over > 0) {
      reasons.push({
        code: 'over-budget',
        label: `$${Math.round(over).toLocaleString('en-US')} over its cost ceiling`,
        level: 'at-risk',
      })
    }
  }

  // Over-delivery is a risk to MARGIN, not to delivery, so it is a watch rather
  // than at-risk — and only while there is still spend left to prevent.
  if (live) {
    const ot = overTargetCheck({
      n_target: input.n_target,
      n_collected: input.n_collected,
      n_internal_target: input.n_internal_target,
      n_actual: input.n_actual,
      project_type: input.project_type,
    })
    if (ot.over) {
      reasons.push({
        code: 'over-target',
        label: `On track for ~${ot.projected.toLocaleString('en-US')} against a target of ${ot.target.toLocaleString('en-US')} — the excess is not billable`,
        level: 'watch',
      })
    }
  }

  // A fielded project with no cost recorded is not a delivery risk, but every
  // margin figure that includes it is wrong. 143 PS projects sat like this until
  // the 2026-09-11 import.
  if (live && (Number(input.n_collected ?? 0) > 0) && Number(input.actual_spend ?? 0) === 0) {
    reasons.push({
      code: 'no-cost-recorded',
      label: 'Collecting N with no cost recorded — its margin reads as pure profit',
      level: 'watch',
    })
  }

  const level = reasons.reduce<RiskLevel>((worst, r) => (ORDER[r.level] > ORDER[worst] ? r.level : worst), 'none')
  const worst = reasons.slice().sort((a, b) => ORDER[b.level] - ORDER[a.level])[0] ?? null
  return { level, reasons, headline: worst?.label ?? null }
}

/** Badge styling per level — one place, so the board, list and project page
 *  cannot drift apart. */
export const RISK_STYLE: Record<Exclude<RiskLevel, 'none'>, { label: string; className: string }> = {
  watch: { label: 'Watch', className: 'bg-yellow-500/12 text-yellow-700 dark:text-yellow-400 border-yellow-500/30' },
  'at-risk': { label: 'At risk', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  critical: { label: 'Critical', className: 'bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/30' },
}
