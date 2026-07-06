export type MergeField = { key: string; label: string }

// Scalar fields a user resolves in the preview (only differing ones surface).
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
  { key: 'audience_size', label: 'Audience size' },
  { key: 'salesperson', label: 'Salesperson' },
  { key: 'priority', label: 'Priority' },
  { key: 'budget', label: 'Total budget' },
  { key: 'category', label: 'Category' },
  { key: 'objective', label: 'Objective' },
  { key: 'longitudinal', label: 'Longitudinal' },
  { key: 'voter_survey_qa', label: 'Voter survey QA' },
  { key: 'citation_language_needed', label: 'Citation language' },
  { key: 'row_level_data', label: 'Row-level data' },
  { key: 'terminations', label: 'Terminations' },
]

export const CLIENT_MERGE_FIELDS: MergeField[] = [
  { key: 'name', label: 'Client name' },
  { key: 'code', label: 'Client ID' },
  { key: 'compliance_before_fielding', label: 'Compliance before fielding' },
  { key: 'compliance_after_fielding', label: 'Compliance after fielding' },
  { key: 'compliance_contact', label: 'Compliance contact' },
  { key: 'compliance_notes', label: 'Compliance notes' },
]

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
