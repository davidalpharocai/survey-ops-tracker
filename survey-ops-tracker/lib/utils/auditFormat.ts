// Human-readable labels and values for the field audit log.
import { FIELD_LABELS } from './quickFields'

export const AUDIT_LABELS: Record<string, string> = {
  ...FIELD_LABELS,
  captain: 'Captain',
  phase: 'Phase',
  priority: 'Priority',
  blocked_by: 'Blocked By',
  '(created)': 'Created',
  next_step_added: 'Next step added',
  next_step_completed: 'Next step completed',
  next_step_reopened: 'Next step reopened',
  next_step_edited: 'Next step edited',
  next_step_removed: 'Next step removed',
  bid_added: 'Bid added',
  bid_changed: 'Bid changed',
  bid_removed: 'Bid removed',
}

export function auditLabel(field: string): string {
  return AUDIT_LABELS[field] ?? field
}

const MONEY = new Set(['budget', 'actual_spend', 'bid_added', 'bid_changed', 'bid_removed'])

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
