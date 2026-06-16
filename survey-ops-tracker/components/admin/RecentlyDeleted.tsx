'use client'
import { useState } from 'react'
import { useDeletedProjects, useRestoreProject, usePermanentlyDeleteProject } from '@/lib/hooks/useProjects'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { formatDate } from '@/lib/utils/date'

export function RecentlyDeleted() {
  const { data: deleted = [], isLoading } = useDeletedProjects()
  const restore = useRestoreProject()
  const purge = usePermanentlyDeleteProject()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Recently deleted ({deleted.length})
        <InfoTooltip text="Deleted projects are kept here so a mistaken delete is reversible. Restore puts a project back exactly as it was. Delete forever is permanent — it also removes the project's steps, bids, activity, and audit history." />
      </h3>

      {isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : deleted.length === 0 ? (
        <p className="text-xs text-muted-foreground/50">Nothing in the trash — deleted projects show up here.</p>
      ) : (
        <div className="flex flex-col max-h-[18rem] overflow-y-auto thin-scroll pr-1">
          {deleted.map(p => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0"
            >
              <span className="min-w-0">
                <span className="text-sm text-foreground truncate">{p.project_name}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {p.project_code ? `${p.project_code} · ` : ''}{p.client} · deleted {formatDate(p.deleted_at)}
                </span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => restore.mutate(p.id)}
                  className="text-xs border border-border text-foreground hover:border-ring px-2 py-1 rounded transition-colors"
                  title="Put this project back on the board, unchanged"
                >
                  ↺ Restore
                </button>
                {confirmingId === p.id ? (
                  <span className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        purge.mutate(p.id)
                        setConfirmingId(null)
                      }}
                      className="text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded transition-colors"
                    >
                      Delete forever
                    </button>
                    <button
                      onClick={() => setConfirmingId(null)}
                      className="text-xs text-muted-foreground hover:text-foreground px-1"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmingId(p.id)}
                    className="text-xs text-muted-foreground/60 hover:text-red-600 dark:hover:text-red-400 px-1 transition-colors"
                    title="Permanently delete — cannot be undone"
                  >
                    🗑
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
