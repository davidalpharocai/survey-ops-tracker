import { getDueDateStatus, getDueUrgency, formatDate } from '@/lib/utils/date'
import { NProgressBar } from '@/components/shared/NProgressBar'
import type { SurveyProject } from '@/lib/hooks/useProjects'

// Full-card border by due-date urgency; overrides the stage color on the left edge
const URGENCY_BORDER: Record<string, string> = {
  overdue: 'border-2 border-red-500',
  tomorrow: 'border-2 border-orange-500',
  twodays: 'border-2 border-amber-300 dark:border-amber-400/70',
}

const STAGE_BORDER: Record<string, string> = {
  'Submitted': 'border-l-blue-500',
  'Doc Programming': 'border-l-amber-500',
  'Survey Programming': 'border-l-amber-500',
  'EdWin QA': 'border-l-cyan-500',
  'Fielding': 'border-l-emerald-500',
  'Data QA': 'border-l-violet-500',
  'Delivery': 'border-l-muted-foreground',
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
  const dueDateStatus = getDueDateStatus(project.due_date)
  const urgency = getDueUrgency(project.due_date)
  const urgencyBorder = urgency ? URGENCY_BORDER[urgency] : undefined
  const stageBorder = STAGE_BORDER[project.board_column] ?? 'border-l-muted-foreground'
  const border = urgencyBorder
    ? `border-l-4 ${urgencyBorder}`
    : `border border-border border-l-4 ${stageBorder}`
  const snippet = project.latest_next_steps
    ? project.latest_next_steps.slice(0, 100) +
      (project.latest_next_steps.length > 100 ? '…' : '')
    : null

  return (
    <div
      onClick={onClick}
      className={`bg-background rounded-lg p-3 ${border} cursor-pointer hover:ring-1 hover:ring-ring transition-all`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-foreground text-sm font-semibold leading-tight">
          {project.project_name}
        </span>
        {project.project_type && (
          <span
            className={`text-[11px] px-2 py-0.5 rounded shrink-0 ${TYPE_BADGE[project.project_type] ?? ''}`}
          >
            {project.project_type}
          </span>
        )}
      </div>

      {/* Client */}
      <p className="text-muted-foreground text-xs mb-3">{project.client}</p>

      {/* N Progress */}
      <NProgressBar collected={project.n_collected} target={project.n_target} />

      {/* Latest/Next Steps snippet */}
      {snippet && (
        <p className="text-muted-foreground text-xs mt-2 leading-relaxed line-clamp-2">
          {snippet}
        </p>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between mt-3">
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
