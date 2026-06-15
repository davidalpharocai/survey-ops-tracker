'use client'
import { getDueDateStatus, getDueUrgency, formatDate } from '@/lib/utils/date'
import { deriveWaitingOn } from '@/lib/utils/waitingOn'
import { isStale } from '@/lib/utils/stale'
import { NProgressBar } from '@/components/shared/NProgressBar'
import type { SlimProject } from '@/lib/hooks/useProjects'
import { useLatestSubmissionStatuses } from '@/lib/hooks/useSubmissions'

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
  project: SlimProject
  onClick?: () => void
  /** Newly assigned to the viewer and not yet opened — green border + NEW! badge */
  isNew?: boolean
}

export function ProjectCard({ project, onClick, isNew }: ProjectCardProps) {
  const onHold = project.status === 'Hold'
  const closed = project.status === 'Closed'
  // Hold takes precedence over NEW if both somehow apply
  const showNew = !!isNew && !onHold
  const dueDateStatus = getDueDateStatus(project.due_date)
  // Closed and Hold projects drop the due-date urgency treatment — they're
  // done or paused, so red/orange/amber would be misleading.
  const urgency = onHold || closed ? null : getDueUrgency(project.due_date)
  const urgencyBorder = urgency ? URGENCY_BORDER[urgency] : undefined
  const border = onHold
    ? 'border-2 border-muted-foreground/40 border-l-4 border-l-muted-foreground/50'
    : closed
    ? 'border border-border border-l-4 border-l-muted-foreground/30'
    : showNew
    ? 'border-2 border-emerald-500 border-l-4 border-l-emerald-500'
    : urgencyBorder
    ? `border-l-4 ${urgencyBorder}`
    : 'border border-border border-l-4 border-l-foreground/80'
  const { data: complianceStatuses } = useLatestSubmissionStatuses()
  const complianceStatus = complianceStatuses?.get(project.id)
  const snippet = project.latest_next_steps
    ? project.latest_next_steps.slice(0, 100) +
      (project.latest_next_steps.length > 100 ? '…' : '')
    : null
  const priorityChip = PRIORITY_CHIP[project.priority ?? '']
  const stale = isStale(project)
  const waitingOn = deriveWaitingOn(project)
  // Only surface external waits — "Us — x" is already implied by the column
  const showWaitingOn = waitingOn === 'Client' || waitingOn.startsWith('Field')

  return (
    <div
      onClick={onClick}
      className={`relative bg-background rounded-lg p-2.5 ${border} ${
        onHold ? 'opacity-60' : ''
      } cursor-pointer hover:ring-1 hover:ring-ring transition-colors`}
    >
      {/* Hold badge floats on the top-right corner, on purpose */}
      {onHold && (
        <span
          className="absolute -top-2.5 right-2 text-[11px] px-2 py-0.5 rounded-full bg-muted border border-muted-foreground/40 text-muted-foreground"
          title="On hold — paused; greyed out and sorted to the bottom of the column"
        >
          ⏸ Hold
        </span>
      )}

      {/* NEW! badge floats on the top-right corner, like Hold */}
      {showNew && (
        <span
          className="absolute -top-2.5 right-2 rounded-full bg-emerald-500/15 border border-emerald-500 text-emerald-700 dark:text-emerald-300 px-2 text-[11px] font-medium"
          title="Newly assigned to you — opens the project to dismiss"
        >
          NEW!
        </span>
      )}

      {/* Title row — wraps so badges drop to their own line on narrow cards
          instead of crushing the title into one-letter-per-line */}
      <div className="flex items-start justify-between gap-x-2 gap-y-1 mb-1 flex-wrap">
        <span className="text-foreground text-sm font-semibold leading-tight break-words flex-1 basis-28 min-w-0">
          {project.project_name}
        </span>
        <span className="flex items-center gap-1 flex-wrap justify-end shrink-0">
          {stale && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded-full bg-muted border border-muted-foreground/40 text-muted-foreground whitespace-nowrap"
              title="No dates set and no updates in 30+ days — review whether this project is still real."
            >
              💤 Stale?
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
          {complianceStatus && (
            <span
              title={`Compliance: ${complianceStatus.replace('_', ' ')}`}
              className={`text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${
                complianceStatus === 'approved'
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  : complianceStatus === 'rejected'
                    ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                    : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
              }`}
            >
              {complianceStatus === 'pending_review' ? 'Compliance ⏳' : complianceStatus === 'approved' ? 'Compliance ✓' : 'Compliance ✕'}
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
              title={`Project captain: ${project.captain.name}${
                (project.co_captain_ids ?? []).length > 0
                  ? ` (+${project.co_captain_ids!.length} co-captain${project.co_captain_ids!.length > 1 ? 's' : ''} — see project page)`
                  : ''
              }`}
            >
              {project.captain.initials}
              {(project.co_captain_ids ?? []).length > 0 && (
                <span className="text-muted-foreground"> +{project.co_captain_ids!.length}</span>
              )}
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
              onHold || closed
                ? 'text-muted-foreground'
                : dueDateStatus === 'overdue'
                ? 'text-red-600 dark:text-red-400'
                : dueDateStatus === 'soon'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground'
            }`}
          >
            {!onHold && !closed && dueDateStatus === 'overdue' && '⚠ '}
            {formatDate(project.due_date)}
          </span>
        )}
      </div>
    </div>
  )
}
