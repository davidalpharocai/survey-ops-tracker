'use client'
import { getDueDateStatus, formatDate } from '@/lib/utils/date'
import type { SlimProject } from '@/lib/hooks/useProjects'
import type { SprintConfig } from '@/lib/utils/sprints'
import { sprintLabel } from '@/lib/utils/sprints'

const PRIORITY_CHIP: Record<string, { symbol: string; classes: string; label: string }> = {
  high: { symbol: '⚑', classes: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', label: 'High priority' },
  urgent: { symbol: '‼', classes: 'bg-red-500/15 text-red-600 dark:text-red-400', label: 'Urgent priority' },
}

export function InternalCard({
  project,
  sprintConfig,
  onClick,
}: {
  project: SlimProject
  sprintConfig: SprintConfig | null
  onClick?: () => void
}) {
  const dueDateStatus = getDueDateStatus(project.due_date)
  const priorityChip = PRIORITY_CHIP[project.priority ?? '']
  const sprintNum = (project as { sprint_number?: number | null }).sprint_number
  const category = (project as { category?: string | null }).category

  return (
    <div
      onClick={onClick}
      className="relative bg-background rounded-lg p-2.5 border border-border border-l-4 border-l-foreground/80 cursor-pointer hover:ring-1 hover:ring-ring transition-colors"
    >
      <div className="flex items-start justify-between gap-x-2 gap-y-1 mb-1 flex-wrap">
        <span className="text-foreground text-sm font-semibold leading-tight break-words flex-1 basis-28 min-w-0">
          {project.project_name}
        </span>
        <span className="flex items-center gap-1 flex-wrap justify-end shrink-0">
          {priorityChip && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded ${priorityChip.classes}`} title={priorityChip.label}>
              {priorityChip.symbol}
            </span>
          )}
          {category && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400">
              {category}
            </span>
          )}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="flex items-center gap-1.5 min-w-0">
          {project.captain ? (
            <span
              className="text-xs bg-muted text-foreground/80 px-2 py-0.5 rounded-full shrink-0"
              title={`Owner: ${project.captain.name}`}
            >
              {project.captain.initials}
            </span>
          ) : (
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full shrink-0" title="No owner yet">
              —
            </span>
          )}
          {sprintNum != null && (
            <span
              className="text-[10px] text-muted-foreground"
              title={sprintConfig ? sprintLabel(sprintNum, sprintConfig) : `Sprint ${sprintNum}`}
            >
              S{sprintNum}
            </span>
          )}
        </span>
        {project.due_date && (
          <span
            className={`text-xs ${
              dueDateStatus === 'overdue'
                ? 'text-red-600 dark:text-red-400'
                : dueDateStatus === 'soon'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground'
            }`}
          >
            {formatDate(project.due_date)}
          </span>
        )}
      </div>
    </div>
  )
}
