import type { SurveyProject } from '@/lib/hooks/useProjects'

// Column order mirrors the original Survey Ops sheet where possible
const COLUMNS: { header: string; value: (p: SurveyProject) => unknown }[] = [
  { header: 'Project Name', value: p => p.project_name },
  { header: 'Client', value: p => p.client },
  { header: 'Type', value: p => p.project_type },
  { header: 'Phase', value: p => p.phase },
  { header: 'Status', value: p => p.status },
  { header: 'Scoping Stage', value: p => p.scoping_stage },
  { header: 'Board Column', value: p => p.board_column },
  { header: 'Captain', value: p => p.captain?.initials },
  { header: 'Salesperson', value: p => p.salesperson },
  { header: 'Submitted', value: p => p.submitted_date },
  { header: 'Launch Date', value: p => p.launch_date },
  { header: 'Due Date', value: p => p.due_date },
  { header: 'Deliver Date', value: p => p.deliver_date },
  { header: 'N Target', value: p => p.n_target },
  { header: 'N Collected', value: p => p.n_collected },
  { header: 'N Actual', value: p => p.n_actual },
  { header: 'Audience Size', value: p => p.audience_size },
  { header: 'Budget', value: p => p.budget },
  { header: 'Actual Spend', value: p => p.actual_spend },
  { header: 'Longitudinal', value: p => p.longitudinal },
  { header: 'Voter Survey QA', value: p => p.voter_survey_qa },
  { header: 'Citation Language', value: p => p.citation_language_needed },
  { header: 'Row-Level Data', value: p => p.row_level_data },
  { header: 'Terminations', value: p => p.terminations },
  { header: 'Survey IDs', value: p => p.survey_tool_id },
  { header: 'Slack Channel', value: p => p.slack_channel_url },
  { header: 'Linked Documents', value: p => (p.linked_documents ?? []).join(' ') },
  { header: 'Latest/Next Steps', value: p => p.latest_next_steps },
]

function cell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  const s = String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function exportProjectsCsv(projects: SurveyProject[]) {
  const lines = [
    COLUMNS.map(c => cell(c.header)).join(','),
    ...projects.map(p => COLUMNS.map(c => cell(c.value(p))).join(',')),
  ]
  // BOM so Excel opens UTF-8 correctly
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `survey-ops-export-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
