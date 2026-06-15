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
  if (field === '(created)') return <span className="text-foreground/90">Project created</span>

  const hasOld = oldValue != null && oldValue !== ''
  const hasNew = newValue != null && newValue !== ''

  return (
    <>
      <span className="text-foreground/90 font-medium">{auditLabel(field)}</span>{' '}
      {hasOld && (
        <span className="text-muted-foreground line-through">{formatAuditValue(field, oldValue)}</span>
      )}
      {hasOld && hasNew && <span className="text-muted-foreground/60"> → </span>}
      {hasNew && <span className="text-foreground">{formatAuditValue(field, newValue)}</span>}
      {!hasOld && !hasNew && <span className="text-muted-foreground">—</span>}
    </>
  )
}
