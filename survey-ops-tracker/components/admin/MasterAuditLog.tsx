'use client'
import Link from 'next/link'
import { useAuditLog } from '@/lib/hooks/useAudit'
import { formatAuditWhen, actorName } from '@/lib/utils/auditFormat'
import { AuditChange } from '@/components/shared/AuditChange'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

const LIMIT = 150

export function MasterAuditLog() {
  const { data: entries, isError, isLoading } = useAuditLog(LIMIT)

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Audit log
        <InfoTooltip text="Every field change across all projects, newest first — who, when, what changed, and old → new. 'system' = automated (nightly Edwin sync or import). Captured by the database, so it's complete." />
      </h3>

      {isError ? (
        <p className="text-xs text-muted-foreground/70">The audit log needs the latest database migration.</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-xs text-muted-foreground/50">No changes recorded yet.</p>
      ) : (
        <>
          <div className="flex flex-col max-h-[28rem] overflow-y-auto">
            {entries.map(e => (
              <div
                key={e.id}
                className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0 text-sm"
              >
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 w-28 pt-0.5">
                  {formatAuditWhen(e.changed_at)}
                  <span className="block text-muted-foreground/70">{actorName(e.changed_by)}</span>
                </span>
                <span className="shrink-0 w-44 min-w-0 pt-0.5">
                  {e.project ? (
                    <Link
                      href={`/projects/${e.project.id}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline truncate block"
                      title={`${e.project.project_name} · ${e.project.client}`}
                    >
                      {e.project.project_name}
                      <span className="block text-xs text-muted-foreground/70 truncate">
                        {e.project.client}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-muted-foreground/50">(deleted project)</span>
                  )}
                </span>
                <span className="flex-1 min-w-0 leading-snug">
                  <AuditChange field={e.field} oldValue={e.old_value} newValue={e.new_value} />
                </span>
              </div>
            ))}
          </div>
          {entries.length === LIMIT && (
            <p className="text-xs text-muted-foreground/50 mt-2">Showing the {LIMIT} most recent changes.</p>
          )}
        </>
      )}
    </div>
  )
}
