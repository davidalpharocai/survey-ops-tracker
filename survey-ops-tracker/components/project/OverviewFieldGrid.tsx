'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { getDueUrgency, urgencyTextClass, urgencySuffix } from '@/lib/utils/date'
import { useUpdateProject, type SurveyProject } from '@/lib/hooks/useProjects'
import type { Database } from '@/lib/supabase/types'
import { FieldSection, TextCell, DateCell, SelectCell } from './fields'
import { NSegmentsEditor } from './NSegmentsEditor'
import { SuppliersWidget } from './SuppliersWidget'
import { BlastBlocks } from './BlastBlocks'
import { BudgetWidget } from './BudgetWidget'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { OccamWordmark } from '@/components/shared/OccamWordmark'
import { isRerunProject } from '@/lib/reruns/isRerun'
import { RerunChip } from '@/components/reruns/RerunChip'

type ProjectUpdate = Database['public']['Tables']['survey_projects']['Update']

const TYPE_OPTIONS = [
  { value: 'PS', label: 'PS' },
  { value: 'B2B', label: 'B2B' },
]

const TIP = {
  submitted: 'Date the project was submitted into the pipeline.',
  launch: 'Date the survey went (or goes) live in the field. Auto-filled with the day the project first enters Fielding (only if left blank); editable anytime.',
  due: 'Internal deadline — when everything needs to be finished on our side.',
  deliver:
    'Client-facing deadline — when the client needs the project in hand. Often the same day as the internal due date.',
  rerun:
    'Date the next wave auto-spawns (arms the rerun cron); changing it re-arms it.',
  type: 'PS (PureSpectrum sample) or B2B (blast outreach). Drives which Money widget shows below. Rerun is shown as a separate ↻ chip, not a type.',
  surveyIds:
    "IDs of this project's surveys, comma separated. Auto-filled from the attached Google Sheet by the scheduled sync; manual edits stick unless the sheet changes.",
  longitudinal: 'Whether this is a longitudinal study tracked across multiple waves.',
  voterQa:
    'Voter surveys need an additional QA pass. Auto-set to Yes when the salesperson is Jenna or the project/client mentions "vote". Click to override.',
  citation:
    'Whether deliverables need citation language. Auto-set the same way as Voter Survey QA. Click to override.',
  rowLevel: 'Whether individual respondent-level data is included in the deliverable.',
  terminations: 'Whether any survey participants have been terminated (screened out) from the study.',
  occam: 'Whether this project uses Occam (our internal survey tool).',
}

/**
 * The main-column field-grid body of the project Overview: Details,
 * N & Audience, Money, and Flags. Self-contained — mounts `NSegmentsEditor`
 * and the existing Money widgets, and writes every field through
 * `useUpdateProject`. Does not render the pipeline card, the right rail, or
 * Latest/Next steps — those stay in `page.tsx`.
 */
export function OverviewFieldGrid({ project }: { project: SurveyProject }) {
  const updateProject = useUpdateProject()
  const save = (updates: ProjectUpdate) => updateProject.mutate({ id: project.id, updates })

  // Delivered projects (board_column 'Delivery') drop the proximity treatment —
  // the work is done, so due/delivery dates no longer warn. Both the internal
  // Due date and the client-facing Delivery date get the same tier colors +
  // label (overdue only once the date has actually passed).
  const delivered = project.board_column === 'Delivery'
  const dueUrgency = delivered ? null : getDueUrgency(project.due_date)
  const deliverUrgency = delivered ? null : getDueUrgency(project.deliver_date)

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:bg-card/70 hover:shadow-md hover:backdrop-blur-sm">
      <FieldSection title="Details" first>
        <DateCell
          label="Submitted date"
          tooltip={TIP.submitted}
          mode="date"
          value={project.submitted_date}
          onSave={v => save({ submitted_date: v })}
        />
        <DateCell
          label="Launch date"
          tooltip={TIP.launch}
          mode="date"
          value={project.launch_date}
          onSave={v => save({ launch_date: v })}
        />
        <DateCell
          label="Due date"
          tooltip={TIP.due}
          mode="date"
          value={project.due_date}
          toneClass={urgencyTextClass(dueUrgency)}
          suffix={urgencySuffix(dueUrgency, project.due_date) || undefined}
          onSave={v => save({ due_date: v })}
        />
        <DateCell
          label="Delivery date"
          tooltip={TIP.deliver}
          mode="date"
          value={project.deliver_date}
          toneClass={urgencyTextClass(deliverUrgency)}
          suffix={urgencySuffix(deliverUrgency, project.deliver_date) || undefined}
          onSave={v => save({ deliver_date: v })}
        />
        {project.longitudinal && (
          <DateCell
            label="Rerun date"
            tooltip={TIP.rerun}
            mode="date"
            value={project.rerun_date ?? null}
            onSave={iso => updateProject.mutate({ id: project.id, updates: { rerun_date: iso, rerun_spawned_at: null } })}
          />
        )}
        <TextCell
          label="Survey IDs"
          tooltip={TIP.surveyIds}
          value={project.survey_tool_id}
          placeholder="e.g. SV-1042, SV-1043"
          onSave={v => save({ survey_tool_id: v || null })}
        />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <SelectCell
              label="Type"
              tooltip={TIP.type}
              value={project.project_type ?? ''}
              options={TYPE_OPTIONS}
              onSave={v => save({ project_type: v as 'PS' | 'B2B' })}
            />
          </div>
          {isRerunProject(project) && (
            <div className="pb-1.5 shrink-0">
              <RerunChip />
            </div>
          )}
        </div>
      </FieldSection>

      <NSegmentsEditor project={project} />

      <FieldSection title="Money">
        {/* Full-width — the widgets below manage their own internal layout. */}
        <div className="sm:col-span-2 flex flex-col gap-3">
          {/* Rerun is a dimension, not a type — a rerun wave still carries its
              base type (PS/B2B) on project_type, so it maps to one widget
              below like any other project. PS -> Suppliers (PureSpectrum),
              B2B -> blast blocks. Untyped shows both (doesn't map cleanly). */}
          {project.project_type === 'PS' && (
            <SuppliersWidget
              projectId={project.id}
              nTarget={project.n_target}
              nInternalTarget={project.n_internal_target}
              nActual={project.n_actual}
            />
          )}
          {project.project_type === 'B2B' && <BlastBlocks project={project} />}
          {/* Legacy 'Rerun' rows predate the type/dimension split and were
              never re-typed to PS/B2B — keep showing both widgets for them
              (same as untyped) rather than dropping Money entirely. */}
          {(project.project_type === 'Rerun' || project.project_type == null) && (
            <>
              <SuppliersWidget
                projectId={project.id}
                nTarget={project.n_target}
                nInternalTarget={project.n_internal_target}
                nActual={project.n_actual}
              />
              <BlastBlocks project={project} />
            </>
          )}
          {/* Budget summary sits under the supplier/blast config — reuses
              BudgetWidget wholesale (it already renders budget editing, the
              computed actual-spend/cost-per-N rows, and the spend bar). */}
          <div className="border-t border-border pt-3 mt-1">
            <BudgetWidget
              projectId={project.id}
              budget={project.budget ?? null}
              nCollected={project.n_collected}
              actualSpend={project.actual_spend ?? null}
            />
          </div>
        </div>
      </FieldSection>

      <FieldSection title="Flags">
        <div className="sm:col-span-2 flex flex-wrap gap-1.5">
          <FlagChip
            label="Longitudinal"
            icon="🔁"
            value={project.longitudinal ?? false}
            tone="emerald"
            tooltip={TIP.longitudinal}
            onToggle={v => save({ longitudinal: v })}
          />
          <FlagChip
            label="Voter Survey QA"
            icon="🗳️"
            value={project.voter_survey_qa ?? false}
            tone="amber"
            tooltip={TIP.voterQa}
            onToggle={v => save({ voter_survey_qa: v })}
          />
          <FlagChip
            label="Citation Language"
            icon="❝"
            value={project.citation_language_needed ?? false}
            tone="amber"
            tooltip={TIP.citation}
            onToggle={v => save({ citation_language_needed: v })}
          />
          <FlagChip
            label="Row-Level Data"
            icon="🔢"
            value={project.row_level_data}
            tone="emerald"
            tooltip={TIP.rowLevel}
            onToggle={v => save({ row_level_data: v })}
          />
          <FlagChip
            label="Terminations"
            icon="⛔"
            value={project.terminations}
            tone="red"
            tooltip={TIP.terminations}
            onToggle={v => save({ terminations: v })}
          />
          <FlagChip
            label={<OccamWordmark className="h-3 w-auto" />}
            ariaLabel="Occam"
            value={project.occam ?? false}
            tone="sky"
            tooltip={TIP.occam}
            onToggle={v => save({ occam: v })}
          />
        </div>
      </FieldSection>
    </div>
  )
}

const CHIP_ON: Record<'red' | 'amber' | 'emerald' | 'sky', string> = {
  red: 'bg-red-500/15 text-red-600 dark:text-red-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  sky: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
}

/**
 * Small (~10px) click-to-toggle flag chip. ON = filled meaning-color + a
 * check/warn marker; OFF = dimmed dashed outline. The toggle button and the
 * InfoTooltip are separate elements (not nested) so the tooltip's own
 * trigger button stays valid HTML. Writes straight through `onToggle`, which
 * callers wire to the same `survey_projects` boolean column `FlagChip` in
 * `page.tsx` uses.
 */
function FlagChip({
  label,
  value,
  tone,
  icon,
  ariaLabel,
  tooltip,
  onToggle,
}: {
  /** Text label, or a node (e.g. the Occam wordmark, where the logo IS the text). */
  label: ReactNode
  value: boolean
  tone: 'red' | 'amber' | 'emerald' | 'sky'
  /** Leading emoji/glyph. Omit when the label node already carries the identity. */
  icon?: ReactNode
  /** Accessible name when `label` is a node (SVG) rather than readable text. */
  ariaLabel?: string
  tooltip?: string
  onToggle: (next: boolean) => void
}) {
  const mark = value ? (tone === 'red' ? '⚠' : '✓') : '○'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full pl-2 pr-0.5 py-0.5 text-[10px] leading-none transition-colors',
        value ? CHIP_ON[tone] : 'border border-border bg-transparent text-muted-foreground',
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(!value)}
        aria-pressed={value}
        aria-label={ariaLabel}
        className="inline-flex items-center gap-1 cursor-pointer whitespace-nowrap hover:opacity-80 transition-opacity"
      >
        {/* Leading meaning-glyph (emoji don't follow text color, so dim it
            explicitly when the flag is OFF to match the muted chip). */}
        {icon && (
          <span aria-hidden="true" className={cn('text-[11px] leading-none', !value && 'opacity-50 grayscale')}>
            {icon}
          </span>
        )}
        <span aria-hidden="true">{mark}</span>
        {label}
      </button>
      {tooltip && <InfoTooltip text={tooltip} />}
    </span>
  )
}
