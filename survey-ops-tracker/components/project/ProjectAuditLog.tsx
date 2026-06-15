'use client'
import { useProjectAudit } from '@/lib/hooks/useAudit'
import { formatAuditWhen, actorName } from '@/lib/utils/auditFormat'
import { AuditChange } from '@/components/shared/AuditChange'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

export function ProjectAuditLog({ projectId }: { projectId: string }) {
  const { data: entries, isError, isLoading } = useProjectAudit(projectId)

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Audit Log
        <InfoTooltip text="Every field change on this project, captured automatically — who changed what, when, and the old → new value. 'system' means an automated update (nightly Edwin sync or an import)." />
      </h3>

      {isError ? (
        <p className="text-xs text-muted-foreground/70">The audit log needs the latest database migration.</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-xs text-muted-foreground/50">No changes recorded yet.</p>
      ) : (
        <div className="flex flex-col">
          {entries.map(e => (
            <div
              key={e.id}
              className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0 text-sm"
            >
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 w-32 pt-0.5">
                {formatAuditWhen(e.changed_at)}
                <span className="block text-muted-foreground/70">{actorName(e.changed_by)}</span>
              </span>
              <span className="flex-1 min-w-0 leading-snug">
                <AuditChange field={e.field} oldValue={e.old_value} newValue={e.new_value} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
