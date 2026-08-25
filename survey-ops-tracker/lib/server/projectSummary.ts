import 'server-only'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import type { Blast } from '@/lib/hooks/useProjectBlasts'
import { formatDate } from '@/lib/utils/date'
import { pctOf, daysBetween, computePace, costPerComplete, blastCompletionRate, segmentPaces, type SegmentPaceRow } from '@/lib/utils/insights'
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
  /** N segments (2+) for per-segment pacing; omit/empty for a single-N project. */
  segments?: { label: string | null; n_target: number | null; n_collected: number | null }[]
  /**
   * Does the person who asked for this summary hold `view_financials`? Gates the
   * cost CEILING (budget) and every comparison against it — see the note above
   * SummaryFacts.budget.
   *
   * DEFAULTS TO FALSE, deliberately. This file is a SEPARATE transport out of the
   * app: the facts object is POSTed to Anthropic and returned to the browser, and
   * the only thing keeping revenue prose off other people's screens today is the
   * ✦ Summary preview allowlist (lib/utils/summaryPreview.ts), which documents its
   * own '*' GA switch. Containment by allowlist is containment by luck — flipping
   * that switch would ship budget narration to everyone. So the money is gated on
   * the capability instead, and a caller who doesn't pass this flag gets no
   * budget: the failure mode is a missing sentence, not a leak.
   */
  canViewFinancials?: boolean
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
  /** Per-segment pace (empty unless the project has 2+ N segments). */
  segments: SegmentPaceRow[]
  /** What the project has actually cost so far. Public to the whole team. */
  spend: number
  /** The cost CEILING (the most we mean to spend), NOT client revenue. null both
   *  when no budget is set AND when the caller may not see it — the narrative
   *  treats those the same way (it just doesn't mention a budget), so nothing
   *  downstream has to tell them apart. */
  budget: number | null
  /** spend ÷ budget — a budget comparison, so it follows budget's visibility. */
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

// voter_survey_qa and terminations are deliberately absent: both were retired
// from the UI on 2026-08-24. The columns and their history are kept so either
// can be resurfaced, but nothing user-facing should name them — and this list
// feeds prose the user reads.
const FLAG_LABELS: { key: keyof SurveyProject; label: string }[] = [
  { key: 'longitudinal', label: 'Longitudinal' },
  { key: 'citation_language_needed', label: 'Citation Language' },
  { key: 'row_level_data', label: 'Row-Level Data' },
  { key: 'occam', label: 'Occam' },
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
  // ([[project-status-model]]), so use that word here too. Cancelled (client
  // pulled the plug) is also off-board, so it counts as archived but keeps its
  // own label. Feeding this into the facts is what stops the model reading a
  // done/archived/cancelled project as active.
  const archived = project.status === 'Closed' || project.status === 'Cancelled'
  const status =
    project.status === 'Cancelled'
      ? 'Cancelled'
      : project.status === 'Closed'
      ? 'Archived'
      : project.status === 'Hold'
      ? 'On hold'
      : 'Open'
  // Delivered date: prefer `deliver_date` — the "Delivery date" shown in the
  // Details grid — so the summary matches what the user sees on the page; fall
  // back to the internal `delivered_at` stamp (when the stage flipped) only if
  // no delivery date is set.
  const deliveredDate = delivered
    ? formatMonthDayYear(project.deliver_date ?? project.delivered_at)
    : null

  const durations = stageDurations(stageHistory, input.now)
  const ongoingStage = durations.find((d) => d.ongoing)
  const daysInStage = ongoingStage ? ongoingStage.days : null

  const nCollected = project.n_collected ?? 0
  const nTarget = project.n_target ?? null
  const nPct = pctOf(nCollected, nTarget)

  // Per-segment pace (2+ segments) — the total nPct can read "complete" while a
  // segment sits under its OWN target, so surface each segment independently.
  const segments = input.segments ?? []
  const segRows: SegmentPaceRow[] = segments.length >= 2
    ? segmentPaces({
        segments,
        startISO: project.launch_date ?? project.created_at,
        dueISO: project.due_date ?? null,
        todayISO: nowISO,
        delivered,
      })
    : []

  // Spend and cost-per-complete are cost-to-run: public. The ceiling and
  // anything measured against it are not.
  const canViewFinancials = input.canViewFinancials === true
  const spend = project.actual_spend ?? 0
  const budget = canViewFinancials ? project.budget ?? null : null
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
  // Quotes the % of budget, so it rides on spendPct — null (no budget set, or the
  // caller may not see it) means no watch-out, not a silent leak in the prose.
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
  const segBehind = segRows.filter((s) => s.onTrack === false)
  if (!delivered && segBehind.length > 0) {
    const list = segBehind.map((s) => `${s.label} (~${Math.round(s.projectedPct ?? 0)}% projected)`).join(', ')
    watchouts.push(`Segment(s) behind their own target: ${list}. Total N can look complete while a segment lags.`)
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
    segments: segRows,
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
