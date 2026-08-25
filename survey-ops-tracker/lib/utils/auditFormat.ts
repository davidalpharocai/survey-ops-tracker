// Human-readable labels and values for the field audit log.
import { FIELD_LABELS } from './quickFields'

export const AUDIT_LABELS: Record<string, string> = {
  ...FIELD_LABELS,
  captain: 'Captain',
  phase: 'Phase',
  priority: 'Priority',
  blocked_by: 'Blocked By',
  category: 'Category',
  objective: 'Objective',
  sprint_number: 'Sprint',
  project_code: 'Project ID',
  '(created)': 'Created',
  '(deleted)': 'Deleted',
  '(restored)': 'Restored',
  next_step_added: 'Next step added',
  next_step_completed: 'Next step completed',
  next_step_reopened: 'Next step reopened',
  next_step_edited: 'Next step edited',
  next_step_removed: 'Next step removed',
  supplier_added: 'Supplier added',
  supplier_changed: 'Supplier changed',
  supplier_removed: 'Supplier removed',
  price_per_n_set: 'Price per N set',
  price_per_n_changed: 'Price per N',
  segment_price_set: 'Segment price set',
  segment_price_changed: 'Segment price',
}

export function auditLabel(field: string): string {
  return AUDIT_LABELS[field] ?? field
}

/** Every audit `field` whose value carries restricted money: the price-per-N
 *  rate (project default and per-segment override alike) and the budget ceiling.
 *
 *  Matched on the PREFIX, not a name list, because that is what 082 designed for
 *  — its triggers write price_per_n_set / price_per_n_changed / segment_price_set
 *  / segment_price_changed precisely so one predicate covers all four, and so a
 *  fifth name added in SQL is caught the day it lands rather than the day someone
 *  spots a rate in the feed. `budget` has been in project_audit since 078 and is
 *  restricted under the same decision, so it joins them here.
 *
 *  `actual_spend` is deliberately absent: cost to run is public, same as blasts,
 *  launches, supplier CPI and cost lines. Only revenue-shaped money hides.
 *
 *  The single source of truth for that question — every reader of project_audit
 *  (both audit hooks, and the connector's history tools) asks it here. */
export function isRestrictedAuditField(field: string): boolean {
  return field === 'budget' || /^(price_per_n|segment_price)/.test(field)
}

const MONEY = new Set(['budget', 'actual_spend'])

export function formatAuditValue(field: string, value: string | null): string {
  if (value == null || value === '') return '—'
  if (value === 'true') return 'Yes'
  if (value === 'false') return 'No'
  if (MONEY.has(field)) {
    const n = Number(value)
    if (!isNaN(n)) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
  const dm = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (dm) {
    // Build a local date from the parts so a 'YYYY-MM-DD' value isn't shifted
    // a day by UTC parsing.
    const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]))
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return value.length > 80 ? value.slice(0, 80) + '…' : value
}

/** "Jun 12, 3:42 PM" — compact stamp for log rows. */
export function formatAuditWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Email → display name ("david@alpharoc.ai" → "david"); 'system' stays as-is. */
export function actorName(actor: string): string {
  if (actor === 'system') return 'system'
  return actor.includes('@') ? actor.split('@')[0] : actor
}
