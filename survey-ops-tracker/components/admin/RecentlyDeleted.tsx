'use client'
import { useDeletedProjects, useRestoreProject } from '@/lib/hooks/useProjects'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { formatDate } from '@/lib/utils/date'

/**
 * The trash: projects removed from the board, kept so a mistaken delete is
 * reversible.
 *
 * THERE IS NO PERMANENT DELETE HERE, AND THERE NEVER WAS. This card used to
 * carry a "Delete forever" button whose tooltip promised it also removed the
 * project's steps, bids, activity and audit history. It removed nothing, and
 * said nothing: survey_projects has RLS enabled and no DELETE policy has ever
 * existed in any migration, so the statement matched zero rows and PostgREST
 * answered 200 with an empty body. supabase-js returns error: null for that, so
 * the mutation's onError never fired -- the confirm closed, the list refetched,
 * and the project was still sitting there. Measured 2026-09-23 against
 * production: 38 projects in the trash, the oldest from July, four of them
 * named "Test".
 *
 * Even the service role cannot do it for a project that has been worked on.
 * project_steps and project_bids carry AFTER DELETE audit triggers (migration
 * 029) that INSERT a project_audit row for the project -- while the cascade is
 * deleting that same project -- so the insert violates
 * project_audit_project_id_fkey and the whole delete rolls back. Purging one
 * means removing its steps and bids first, by hand, with the parent still
 * standing.
 *
 * David's call, 2026-09-23: keep permanent deletion impossible, and stop the
 * button claiming otherwise. Nothing has suffered for its absence -- a trashed
 * project is invisible everywhere else in the app. A button that lies is worse
 * than a button that is not there.
 */
export function RecentlyDeleted() {
  const { data: deleted = [], isLoading } = useDeletedProjects()
  const restore = useRestoreProject()

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Recently deleted ({deleted.length})
        <InfoTooltip text="Projects removed from the board are kept here so a mistaken delete is reversible. Restore puts one back exactly as it was, with its steps, activity and history intact. Nothing is ever destroyed from this screen — a project stays in this list until someone with database access removes it deliberately." />
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
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
