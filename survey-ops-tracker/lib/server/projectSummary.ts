import 'server-only'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import type { Blast } from '@/lib/hooks/useProjectBlasts'
import { formatDate } from '@/lib/utils/date'
import { pctOf, daysBetween, computePace, costPerComplete, blastCompletionRate } from '@/lib/utils/insights'
import { stageDurations, type StageHistoryRow } from '@/lib/utils/stageTiming'

// Deterministic facts + watch-outs for the ✦ Summary. Every number here is
// computed from real data (never invented) — the prose written around these
// facts (a later, separate task) may only phrase them, not alter them.

export interface SummaryInput {
  project: SurveyProject
  blasts: Blast[]
  stageHistory: StageHistoryRow[]
  now: Date | string
  /** Open to-do texts (e.g. parsed from latest_next_steps) — passed straight through. */
  openNextSteps?: string[]
}

export interface SummaryFacts {
  stage: string
  /** 'Open' | 'On hold' | 'Archived' — the project's lifecycle status. */
  status: string
  archived: boolean
  daysInStage: number | null
  delivered: boolean
  /** When delivered (with year, e.g. "Apr 9, 2026"); null if not delivered. */
  deliveredDate: string | null
  nCollected: number
  nTarget: number | null
  nPct: number | null
  spend: number
  budget: number | null
  spendPct: number | null
  costPerComplete: number | null
  pacePerDay: number | null
  projectedFinishISO: string | null
  overdueDays: number | null
  compliance: string
  flagsOn: string[]
  rerun: string | null
  blastCompletion: { firstPct: number | null; lastPct: number | null; dipped: boolean }
  nextSteps: string[]
  watchouts: string[]
}

const FLAG_LABELS: { key: keyof SurveyProject; label: string }[] = [
  { key: 'longitudinal', label: 'Longitudinal' },
  { key: 'voter_survey_qa', label: 'Voter Survey QA' },
  { key: 'citation_language_needed', label: 'Citation Language' },
  { key: 'row_level_data', label: 'Row-Level Data' },
  { key: 'terminations', label: 'Terminations' },
]

function toISO(now: Date | string): string {
  return typeof now === 'string' ? now : now.toISOString()
}

/** "Apr 9, 2026" (UTC-pinned, includes the year — unlike the year-less
 *  formatDate used for near-term due dates). null for empty input. */
function formatMonthDayYear(date: string | null | undefined): string | null {
  if (!date) return null
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Sort blasts chronologically by blast_at. Stable sort — blasts without a
 *  blast_at keep their original (created) order relative to one another. */
function sortBlasts(blasts: Blast[]): Blast[] {
  return [...blasts].sort((a, b) => (a.blast_at ?? '').localeCompare(b.blast_at ?? ''))
}

export function buildSummaryFacts(input: SummaryInput): SummaryFacts {
  const { project, blasts, stageHistory, openNextSteps } = input
  const nowISO = toISO(input.now)

  const stage = project.board_column
  const delivered = project.board_column === 'Delivery' || !!project.delivered_at

  // Lifecycle status — the UI relabels the 'Closed' DB value as "Archived"
  // ([[project-status-model]]), so use that word here too. Feeding this into the
  // facts is what stops the model reading a done/archived project as active.
  const archived = project.status === 'Closed'
  const status = archived ? 'Archived' : project.status === 'Hold' ? 'On hold' : 'Open'
  // Delivered date: the real delivered_at if recorded, else the planned deliver_date.
  const deliveredDate = delivered
    ? formatMonthDayYear(project.delivered_at ?? project.deliver_date)
    : null

  const durations = stageDurations(stageHistory, input.now)
  const ongoingStage = durations.find((d) => d.ongoing)
  const daysInStage = ongoingStage ? ongoingStage.days : null

  const nCollected = project.n_collected ?? 0
  const nTarget = project.n_target ?? null
  const nPct = pctOf(nCollected, nTarget)

  const spend = project.actual_spend ?? 0
  const budget = project.budget ?? null
  const spendPct = pctOf(spend, budget)
  const cpc = costPerComplete(spend, nCollected)

  const pace = computePace({
    collected: nCollected,
    target: nTarget,
    startISO: project.launch_date ?? project.created_at,
    todayISO: nowISO,
  })

  // Overdue is only meaningful while the project isn't delivered yet.
  let overdueDays: number | null = null
  if (!delivered && project.due_date) {
    overdueDays = daysBetween(project.due_date, nowISO)
  }

  // Only `compliance_override` lives on the project row itself — the client's
  // before/after-fielding requirements + review submissions live elsewhere
  // and aren't part of this input, so we can only report the per-project
  // override here, never a full "approved / outstanding" verdict.
  let compliance = 'n/a'
  if (project.compliance_override === true) compliance = 'compliance required (override)'
  else if (project.compliance_override === false) compliance = 'compliance waived (override)'

  const flagsOn = FLAG_LABELS.filter((f) => !!project[f.key]).map((f) => f.label)

  const rerun =
    project.longitudinal && project.rerun_number != null ? `Wave ${project.rerun_number}` : null

  const sorted = sortBlasts(blasts)
  const first = sorted[0] ?? null
  const last = sorted[sorted.length - 1] ?? null
  const firstPct = first ? blastCompletionRate(first) : null
  const lastPct = last ? blastCompletionRate(last) : null
  const dipped = firstPct != null && lastPct != null && lastPct < firstPct
  const blastCompletion = { firstPct, lastPct, dipped }

  const nextSteps = openNextSteps ?? []

  const watchouts: string[] = []
  if (overdueDays != null && overdueDays > 0 && !delivered) {
    watchouts.push(`Past due by ${overdueDays} day(s) (due ${formatDate(project.due_date)}).`)
  }
  if (spendPct != null && nPct != null && spendPct - nPct > 10) {
    watchouts.push(
      `Spending ahead of collection (${Math.round(spendPct)}% of budget for ${Math.round(nPct)}% of N).`
    )
  }
  if (dipped) {
    watchouts.push(
      `Blast completion dipped on the latest send (${Math.round(lastPct!)}% vs ${Math.round(firstPct!)}%).`
    )
  }

  return {
    stage,
    status,
    archived,
    daysInStage,
    delivered,
    deliveredDate,
    nCollected,
    nTarget,
    nPct,
    spend,
    budget,
    spendPct,
    costPerComplete: cpc,
    pacePerDay: pace.perDay,
    projectedFinishISO: pace.projectedFinishISO,
    overdueDays,
    compliance,
    flagsOn,
    rerun,
    blastCompletion,
    nextSteps,
    watchouts,
  }
}
