export type MergeField = {
  key: string
  label: string
  /** Finance-only: dropped from the preview entirely unless the user holds
   *  `view_financials`. Same flag, same meaning as CsvColumn.restricted in
   *  lib/utils/exportCsv.ts — one word in one list, so the next restricted
   *  field is a one-line change in both places. */
  restricted?: true
}

// Scalar fields a user resolves in the preview (only differing ones surface).
// voter_survey_qa, terminations and citation_language_needed are absent on
// purpose — retired from the UI (the first two 2026-08-24, citation 2026-08-26),
// so there is nothing for a human to reason about; the survivor simply keeps its
// own value and all three columns are retained in the DB.
//
// `budget` is marked restricted because the preview renders BOTH records' values
// side by side — merging two projects would otherwise print two cost ceilings to
// any analyst, which is the one place a restricted number gets shown twice at
// once. Cost-to-run (actual_spend) is not in this list at all: it is a trigger-
// computed rollup of the child rows the merge already combines, so there is
// nothing for a human to pick.
export const PROJECT_MERGE_FIELDS: MergeField[] = [
  { key: 'project_name', label: 'Project name' },
  { key: 'project_type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'scoping_stage', label: 'Scoping stage' },
  { key: 'submitted_date', label: 'Submitted' },
  { key: 'launch_date', label: 'Launch date' },
  { key: 'due_date', label: 'Due date' },
  { key: 'deliver_date', label: 'Deliver date' },
  { key: 'n_target', label: 'N target' },
  { key: 'n_internal_target', label: 'N internal target' },
  { key: 'n_actual', label: 'N actual' },
  { key: 'audience_size', label: 'Total available audience size' },
  { key: 'audience_used', label: 'Audience size used' },
  { key: 'salesperson', label: 'Salesperson' },
  { key: 'priority', label: 'Priority' },
  { key: 'budget', label: 'Total budget', restricted: true },
  { key: 'category', label: 'Category' },
  { key: 'objective', label: 'Objective' },
  { key: 'longitudinal', label: 'Longitudinal' },
  { key: 'row_level_data', label: 'Row-level data' },
]

export const CLIENT_MERGE_FIELDS: MergeField[] = [
  { key: 'name', label: 'Client name' },
  { key: 'code', label: 'Client ID' },
  { key: 'compliance_before_fielding', label: 'Compliance before fielding' },
  { key: 'compliance_after_fielding', label: 'Compliance after fielding' },
  { key: 'compliance_contact', label: 'Compliance contact' },
  { key: 'compliance_notes', label: 'Compliance notes' },
]

/**
 * The fields this user resolves. `canViewFinancials` must come from
 * useCanViewFinancials(), which is false while the capability query is in
 * flight — so a modal opened before the check resolves is a preview WITHOUT the
 * money, never one with it.
 *
 * A dropped field is simply never picked, so `buildSurvivorUpdate` leaves it out
 * of the patch and the survivor keeps its own value — exactly what happens to
 * the retired flag columns named above. Nothing is
 * overwritten with the loser's number behind the user's back.
 */
export function mergeFieldsFor(fields: MergeField[], canViewFinancials: boolean): MergeField[] {
  return canViewFinancials ? fields : fields.filter(f => !f.restricted)
}

/** True when this field list had any finance-only field withheld from it — what
 *  the modal uses to say the survivor's value stands, rather than staying quiet
 *  about a field the user can't see. */
export function hasWithheldFields(fields: MergeField[], canViewFinancials: boolean): boolean {
  return !canViewFinancials && fields.some(f => f.restricted)
}

// Array columns that always UNION (never a pick).
const PROJECT_ARRAY_FIELDS = ['linked_documents', 'co_captain_ids'] as const

type Row = Record<string, unknown>

/** Fields (from `fields`) whose values differ between survivor and loser. */
export function conflicts(survivor: Row, loser: Row, fields: MergeField[]): MergeField[] {
  return fields.filter(f => !valuesEqual(survivor[f.key], loser[f.key]))
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null)
}

/**
 * The `update` payload for the survivor: for each conflicting field where the
 * user picked 'loser', take the loser's value; union the array columns.
 * `picks` maps fieldKey -> 'survivor' | 'loser'.
 */
export function buildSurvivorUpdate(
  survivor: Row,
  loser: Row,
  picks: Record<string, 'survivor' | 'loser'>
): Row {
  const update: Row = {}
  for (const [key, choice] of Object.entries(picks)) {
    if (choice === 'loser') update[key] = loser[key] ?? null
  }
  for (const key of PROJECT_ARRAY_FIELDS) {
    const s = (survivor[key] as unknown[] | null) ?? []
    const l = (loser[key] as unknown[] | null) ?? []
    if (s.length || l.length) update[key] = Array.from(new Set([...s, ...l]))
  }
  return update
}
