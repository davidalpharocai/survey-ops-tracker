import { getDueDateStatus, getDueUrgency, formatDate } from '@/lib/utils/date'
import { NProgressBar } from '@/components/shared/NProgressBar'
import type { SurveyProject } from '@/lib/hooks/useProjects'

// Full-card border by due-date urgency; overrides the neutral left edge
const URGENCY_BORDER: Record<string, string> = {
  overdue: 'border-2 border-red-500',
  tomorrow: 'border-2 border-orange-500',
  twodays: 'border-2 border-amber-300 dark:border-amber-400/70',
}

const TYPE_BADGE: Record<string, string> = {
  'PS': 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  'B2B': 'bg-violet-500/20 text-violet-600 dark:text-violet-400',
  'Rerun': 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
}

interface ProjectCardProps {
  project: SurveyProject
  onClick?: () => void
}

export function ProjectCard({ project, onClick }: ProjectCardProps) {
  const onHold = project.status === 'Hold'
  const dueDateStatus = getDueDateStatus(project.due_date)
  const urgency = getDueUrgency(project.due_date)
  const urgencyBorder = urgency ? URGENCY_BORDER[urgency] : undefined
  // Hold: greyed out, grey border, urgency colors suppressed (it's paused)
  const border = onHold
    ? 'border-2 border-muted-foreground/40 border-l-4 border-l-muted-foreground/50'
    : urgencyBorder
    ? `border-l-4 ${urgencyBorder}`
    : 'border border-border border-l-4 border-l-foreground/80'
  const snippet = project.latest_next_steps
    ? project.latest_next_steps.slice(0, 100) +
      (project.latest_next_steps.length > 100 ? '…' : '')
    : null

  return (
    <div
      onClick={onClick}
      className={`bg-background rounded-lg p-2.5 ${border} ${
        onHold ? 'opacity-60' : ''
      } cursor-pointer hover:ring-1 hover:ring-ring transition-all`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-foreground text-sm font-semibold leading-tight">
          {project.project_name}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {onHold && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
              ⏸ Hold
            </span>
          )}
          {project.project_type && (
            <span
              className={`text-[11px] px-2 py-0.5 rounded ${TYPE_BADGE[project.project_type] ?? ''}`}
            >
              {project.project_type}
            </span>
          )}
        </span>
      </div>

      {/* Client */}
      <p className="text-muted-foreground text-xs mb-2">{project.client}</p>

      {/* N Progress */}
      <NProgressBar collected={project.n_collected} target={project.n_target} />

      {/* Latest/Next Steps snippet */}
      {snippet && (
        <p className="text-muted-foreground text-xs mt-2 leading-relaxed line-clamp-2">
          {snippet}
        </p>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between mt-2">
        {project.captain ? (
          <span className="text-xs bg-muted text-foreground/80 px-2 py-0.5 rounded-full">
            {project.captain.initials}
          </span>
        ) : (
          <span className="text-xs bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">
            Unassigned !
          </span>
        )}
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
            {dueDateStatus === 'overdue' && '⚠ '}
            {formatDate(project.due_date)}
          </span>
        )}
      </div>
    </div>
  )
}
