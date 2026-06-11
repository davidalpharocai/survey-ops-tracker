import { getDueDateStatus, getDueUrgency, formatDate } from '@/lib/utils/date'
import { deriveWaitingOn } from '@/lib/utils/waitingOn'
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

const TYPE_TITLE: Record<string, string> = {
  'PS': 'PureSpectrum — consumer panel via the PureSpectrum tool',
  'B2B': 'B2B — expert/business panel',
  'Rerun': 'Rerun — repeat wave of an earlier study',
}

const PRIORITY_CHIP: Record<string, { symbol: string; classes: string; label: string }> = {
  high: {
    symbol: '⚑',
    classes: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    label: 'High priority — sorts to the top of its column',
  },
  urgent: {
    symbol: '‼',
    classes: 'bg-red-500/15 text-red-600 dark:text-red-400',
    label: 'Urgent priority — sorts to the top of its column',
  },
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
  const priorityChip = PRIORITY_CHIP[project.priority ?? '']
  const waitingOn = deriveWaitingOn(project)
  // Only surface external waits — "Us — x" is already implied by the column
  const showWaitingOn = waitingOn === 'Client' || waitingOn.startsWith('Field')

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
            <span
              className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground"
              title="On hold — paused; greyed out and sorted to the bottom of the column"
            >
              ⏸ Hold
            </span>
          )}
          {priorityChip && (
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded ${priorityChip.classes}`}
              title={priorityChip.label}
            >
              {priorityChip.symbol}
            </span>
          )}
          {project.project_type && (
            <span
              className={`text-[11px] px-2 py-0.5 rounded ${TYPE_BADGE[project.project_type] ?? ''}`}
              title={TYPE_TITLE[project.project_type]}
            >
              {project.project_type}
            </span>
          )}
        </span>
      </div>

      {/* Client */}
      <p className="text-muted-foreground text-xs mb-2">{project.client}</p>

      {/* N Progress */}
      <div title="Responses collected so far vs the response goal (N Target)">
        <NProgressBar collected={project.n_collected} target={project.n_target} />
      </div>

      {/* Latest/Next Steps snippet */}
      {snippet && (
        <p className="text-muted-foreground text-xs mt-2 leading-relaxed line-clamp-2">
          {snippet}
        </p>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="flex items-center gap-1.5 min-w-0">
          {project.captain ? (
            <span
              className="text-xs bg-muted text-foreground/80 px-2 py-0.5 rounded-full shrink-0"
              title={`Project captain: ${project.captain.name}`}
            >
              {project.captain.initials}
            </span>
          ) : (
            <span
              className="text-xs bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full shrink-0"
              title="No project captain assigned yet"
            >
              Unassigned !
            </span>
          )}
          {showWaitingOn && (
            <span className="text-[10px] text-muted-foreground truncate" title={`Waiting on: ${waitingOn}`}>
              ⏳ {waitingOn}
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
            {dueDateStatus === 'overdue' && '⚠ '}
            {formatDate(project.due_date)}
          </span>
        )}
      </div>
    </div>
  )
}
