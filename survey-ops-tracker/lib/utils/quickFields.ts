// Labels and formatting for AI-parsed project fields (quick add / quick edit)

export const FIELD_LABELS: Record<string, string> = {
  project_name: 'Project Name',
  client: 'Client',
  project_type: 'Type',
  captain_name: 'Captain',
  salesperson: 'Salesperson',
  n_target: 'N Target',
  n_collected: 'N Collected',
  n_actual: 'N Actual',
  audience_size: 'Audience Size',
  budget: 'Budget',
  actual_spend: 'Actual Spend',
  submitted_date: 'Submitted',
  launch_date: 'Launch Date',
  due_date: 'Due Date',
  deliver_date: 'Deliver Date',
  longitudinal: 'Longitudinal',
  row_level_data: 'Row-Level Data',
  terminations: 'Terminations',
  voter_survey_qa: 'Voter Survey QA',
  citation_language_needed: 'Citation Language',
  survey_tool_id: 'Survey IDs',
  slack_channel_url: 'Slack Channel',
  board_column: 'Board Column',
  scoping_stage: 'Scoping Stage',
  status: 'Status',
  note: 'Add Update',
}

const MONEY_FIELDS = new Set(['budget', 'actual_spend'])

export function formatFieldValue(key: string, value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (MONEY_FIELDS.has(key) && typeof value === 'number') {
    return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
  return String(value)
}

// Map parsed fields to a survey_projects update payload.
// captain_name → captain_id via team member lookup; note is handled separately.
export function fieldsToUpdates(
  fields: Record<string, unknown>,
  teamMembers: { id: string; name: string }[]
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
  return updates
}
