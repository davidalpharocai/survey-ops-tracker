import 'server-only'
import { getCheckboxesForColumn, type BoardColumn } from '@/lib/utils/stage'

// Whitelisted editable fields for update_project (the tool-facing subset).
export const PROJECT_WRITE_FIELDS = [
  'project_name','client','project_type','captain_id','co_captain_ids','salesperson','priority','blocked_by',
  'submitted_date','launch_date','due_date','deliver_date','rerun_date',
  'n_target','n_collected','n_actual','n_internal_target','audience_size','budget',
  'longitudinal','voter_survey_qa','citation_language_needed','row_level_data','terminations',
  'survey_tool_id','slack_channel_url','latest_next_steps',
] as const

type Patch = Record<string, unknown>

/** Keep only whitelisted keys actually present; report everything else the caller tried to set. */
export function pickProjectPatch(input: Patch): { patch: Patch; rejected: string[] } {
  const allow = new Set<string>(PROJECT_WRITE_FIELDS)
  const patch: Patch = {}
  const rejected: string[] = []
  for (const k of Object.keys(input)) {
    if (allow.has(k)) patch[k] = input[k]
    else rejected.push(k)
  }
  return { patch, rejected }
}

/** Coupled stage columns. For a normal advance use getCheckboxesForColumn; for delivery set all six true. */
export function stageColumnsFor(opts: { toColumn?: BoardColumn; markDelivered?: boolean }) {
  if (opts.markDelivered) {
    return {
      board_column: 'Delivery' as const,
      stage_doc_programming: true, stage_survey_programming: true, stage_edwin_qa: true,
      stage_fielding: true, stage_data_qa: true, stage_delivery: true,
    }
  }
  const col = opts.toColumn as BoardColumn
  return { board_column: col, ...getCheckboxesForColumn(col) }
}

/** {field:[old,new]} for only the fields whose value changed. */
export function diffSummary(before: Patch, patch: Patch): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {}
  for (const k of Object.keys(patch)) {
    if ((before[k] ?? null) !== (patch[k] ?? null)) out[k] = [before[k] ?? null, patch[k] ?? null]
  }
  return out
}
