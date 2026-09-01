// Labels and formatting for AI-parsed project fields (quick add / quick edit)
import { fmtNum } from './number'
import { isInvertedNRange } from './nRange'

export const FIELD_LABELS: Record<string, string> = {
  project_name: 'Project Name',
  client: 'Client',
  project_type: 'Type',
  captain_name: 'Captain',
  salesperson: 'Salesperson',
  n_target: 'N Target',
  n_target_max: 'N Target max',
  n_collected: 'N Collected',
  n_actual: 'N Actual',
  audience_size: 'Total Available Audience Size',
  audience_used: 'Audience Size Used',
  budget: 'Budget',
  actual_spend: 'Actual Spend',
  submitted_date: 'Submitted',
  launch_date: 'Launch Date',
  due_date: 'Due Date',
  deliver_date: 'Deliver Date',
  longitudinal: 'Longitudinal',
  row_level_data: 'Row-Level Data',
  survey_tool_id: 'Survey IDs',
  slack_channel_url: 'Slack Channel',
  board_column: 'Board Column',
  scoping_stage: 'Scoping Stage',
  status: 'Status',
  note: 'Add Update',
}

const MONEY_FIELDS = new Set(['budget', 'actual_spend'])

/**
 * Parsed fields only a holder of `view_financials` may see or set.
 *
 * `budget` is a COST CEILING (the most we intend to spend), not revenue — but it
 * is restricted all the same, and the parse path has to strip it in BOTH
 * directions: out of the current-values context that goes to the model, and out
 * of the schema the model is allowed to return, so a non-holder can't write the
 * ceiling by describing it either. Cost to run — `actual_spend` — is public and
 * deliberately absent from this set.
 *
 * Shared by the client panel and app/api/parse-project/route.ts so the two can't
 * drift. The gate is soft: it hides and refuses, it does not secure.
 */
// budget is finance-only. actual_spend is here for a different reason: it is
// MAINTAINED BY A DATABASE TRIGGER (recompute_project_spend) from blasts,
// suppliers and cost lines, so a typed value is not merely unauthorised, it is
// wrong — the next child-row write silently overwrites it. The connector has
// always refused it (PROJECT_WRITE_FIELDS omits it); the browser's AI intake
// did not, so "Actual spend is 4200" in Quick Edit used to stick until the
// trigger next fired. The `=` marker beside that figure now says there is
// nothing to type there, which has to be true everywhere.
export const RESTRICTED_FIELDS = new Set(['budget', 'actual_spend'])

export function formatFieldValue(key: string, value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (MONEY_FIELDS.has(key) && typeof value === 'number') {
    return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
  return String(value)
}

/** The stored N range of the row being edited, so a one-ended parse can be
 *  completed into the pair migration 078's trigger insists on. */
export interface CurrentNRange {
  n_target: number | null
  n_target_max: number | null
}

function isNumOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v))
}

/**
 * Migration 078 made the N target a RANGE — `n_target` is the minimum,
 * `n_target_max` the maximum — and its enforce_n_target_range trigger RAISES on
 * max < min while seeing only the columns the PATCH carries. So "bump N to
 * 2,500" on a 1,000–1,200 project, sent as `n_target` alone, is compared against
 * the STORED max of 1,200 and blows up in the user's face. Whenever either end
 * moves we therefore send BOTH in one update object, so the trigger only ever
 * sees a consistent pair.
 *
 * With no `current` (a create — there is no stored end to collide with) a lone
 * end stays lone: the insert's max is null, which the trigger reads as "no upper
 * end agreed", the pre-078 single-number case.
 */
export function withNTargetPair(
  updates: Record<string, unknown>,
  current?: CurrentNRange
): Record<string, unknown> {
  if (!current) return updates
  const touchesMin = 'n_target' in updates
  const touchesMax = 'n_target_max' in updates
  if (!touchesMin && !touchesMax) return updates

  const minRaw = touchesMin ? updates.n_target : current.n_target
  const maxRaw = touchesMax ? updates.n_target_max : current.n_target_max
  // Anything that isn't a number or null (a model that answered "2,500") passes
  // through untouched — the DB is a better judge of it than a silent coerce that
  // could null out an agreed N.
  if (!isNumOrNull(minRaw) || !isNumOrNull(maxRaw)) return updates

  let max = maxRaw
  // The user moved the single number and said nothing about the top end: carry
  // the stored max only while it still makes sense, otherwise collapse it onto
  // the new min (one agreed number). The mirror case — a new max under the
  // stored min — is deliberately NOT repaired: dragging the minimum down would
  // quietly give away N we committed to, so it stays inverted and
  // nRangeComplaint says so out loud.
  if (!touchesMax && minRaw != null && max != null && max < minRaw) max = minRaw

  return { ...updates, n_target: minRaw, n_target_max: max }
}

/**
 * Human complaint about a transposed N range in a pending update, or null when
 * the pair is fine. Worded like migration 078's own RAISE so the DB path and
 * this one read the same, and checked BEFORE the PATCH so "N target 2,500 to
 * 2,000" comes back as a sentence in the panel instead of a Postgres error.
 */
export function nRangeComplaint(updates: Record<string, unknown>): string | null {
  const min = updates.n_target
  const max = updates.n_target_max
  if (!isNumOrNull(min) || !isNumOrNull(max)) return null
  if (!isInvertedNRange(min, max)) return null
  return (
    `N Target max (${fmtNum(max)}) cannot be below N Target min (${fmtNum(min)})` +
    ` — give the low end first, e.g. "N target ${fmtNum(max)} to ${fmtNum(min)}".`
  )
}

// Map parsed fields to a survey_projects update payload.
// captain_name → captain_id via team member lookup; note is handled separately.
// `current` is the row being edited — pass it so a one-ended N target change
// goes out as a pair (see withNTargetPair); omit it on a create.
export function fieldsToUpdates(
  fields: Record<string, unknown>,
  teamMembers: { id: string; name: string }[],
  current?: CurrentNRange
): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || key === 'note') continue
    if (key === 'captain_name') {
      const member = teamMembers.find(
        m => m.name.toLowerCase() === String(value).toLowerCase()
      )
      if (member) updates.captain_id = member.id
      continue
    }
    updates[key] = value
  }
  return withNTargetPair(updates, current)
}
