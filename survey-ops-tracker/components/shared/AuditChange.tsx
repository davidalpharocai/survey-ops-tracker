import { auditLabel, formatAuditValue } from '@/lib/utils/auditFormat'

/**
 * Renders one audit entry's "what changed" text. Handles three shapes:
 * a two-sided change (old → new), a one-sided add/set (just the new value),
 * and a removal/clear (just the old value, struck through).
 */
export function AuditChange({
  field,
  oldValue,
  newValue,
}: {
  field: string
  oldValue: string | null
  newValue: string | null
}) {
  const labelChip = (
    <span className="text-xs bg-muted text-foreground/70 px-1.5 py-0.5 rounded shrink-0">
      {auditLabel(field)}
    </span>
  )

  if (field === '(created)') {
    return (
      <span className="inline-flex items-center gap-2">
        {labelChip}
        <span className="text-foreground/90">Project created</span>
      </span>
    )
  }

  const hasOld = oldValue != null && oldValue !== ''
  const hasNew = newValue != null && newValue !== ''

  // Label chip clearly separates *what* changed from the old → new values;
  // old is muted + struck, new is bold foreground so the current value stands out.
  return (
    <span className="inline-flex items-center flex-wrap gap-x-1.5 gap-y-1">
      {labelChip}
      {hasOld && (
        <span className="text-muted-foreground line-through">{formatAuditValue(field, oldValue)}</span>
      )}
      {hasOld && hasNew && <span className="text-muted-foreground/50">→</span>}
      {hasNew && <span className="text-foreground font-medium">{formatAuditValue(field, newValue)}</span>}
      {!hasOld && !hasNew && <span className="text-muted-foreground">—</span>}
    </span>
  )
}
