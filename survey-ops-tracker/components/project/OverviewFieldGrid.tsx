'use client'

import { cn } from '@/lib/utils'
import { getDueUrgency } from '@/lib/utils/date'
import { useUpdateProject, type SurveyProject } from '@/lib/hooks/useProjects'
import type { Database } from '@/lib/supabase/types'
import { FieldSection, TextCell, DateCell, SelectCell } from './fields'
import { NSegmentsEditor } from './NSegmentsEditor'
import { SuppliersWidget } from './SuppliersWidget'
import { BlastConfigWidget } from './BlastConfigWidget'
import { BudgetWidget } from './BudgetWidget'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

type ProjectUpdate = Database['public']['Tables']['survey_projects']['Update']

const TYPE_OPTIONS = [
  { value: 'PS', label: 'PS' },
  { value: 'B2B', label: 'B2B' },
  { value: 'Rerun', label: 'Rerun' },
]

const TIP = {
  submitted: 'Date the project was submitted into the pipeline.',
  launch: 'Date the survey went (or goes) live in the field.',
  due: 'Internal deadline — when everything needs to be finished on our side.',
  deliver:
    'Client-facing deadline — when the client needs the project in hand. Often the same day as the internal due date.',
  type: 'PS (PureSpectrum sample), B2B (blast outreach), or Rerun. Drives which Money widget shows below.',
  surveyIds:
    "IDs of this project's surveys, comma separated. Auto-filled from the attached Google Sheet by the scheduled sync; manual edits stick unless the sheet changes.",
  longitudinal: 'Whether this is a longitudinal study tracked across multiple waves.',
  voterQa:
    'Voter surveys need an additional QA pass. Auto-set to Yes when the salesperson is Jenna or the project/client mentions "vote". Click to override.',
  citation:
    'Whether deliverables need citation language. Auto-set the same way as Voter Survey QA. Click to override.',
  rowLevel: 'Whether individual respondent-level data is included in the deliverable.',
  terminations: 'Whether any survey participants have been terminated (screened out) from the study.',
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

  // Delivered projects (board_column 'Delivery') drop the overdue treatment —
  // same convention as the board card's due-date border.
  const delivered = project.board_column === 'Delivery'
  const dueWarn = !!project.due_date && !delivered && getDueUrgency(project.due_date) === 'overdue'

  return (
    <div className="flex flex-col">
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
          warn={dueWarn}
          suffix={dueWarn ? ' · overdue' : undefined}
          onSave={v => save({ due_date: v })}
        />
        <DateCell
          label="Delivery date"
          tooltip={TIP.deliver}
          mode="date"
          value={project.deliver_date}
          onSave={v => save({ deliver_date: v })}
        />
        <SelectCell
          label="Type"
          tooltip={TIP.type}
          value={project.project_type ?? ''}
          options={TYPE_OPTIONS}
          onSave={v => save({ project_type: v as 'PS' | 'B2B' | 'Rerun' })}
        />
        <TextCell
          label="Survey IDs"
          tooltip={TIP.surveyIds}
          value={project.survey_tool_id}
          placeholder="e.g. SV-1042, SV-1043"
          onSave={v => save({ survey_tool_id: v || null })}
        />
      </FieldSection>

      <NSegmentsEditor project={project} />

      <FieldSection title="Money">
        {/* Full-width — the widgets below manage their own internal layout. */}
        <div className="sm:col-span-2 flex flex-col gap-3">
          {/* PS -> Suppliers (PureSpectrum), B2B -> Blast Configuration.
              Rerun/untyped show both (they don't map cleanly to one). */}
          {project.project_type === 'PS' && (
            <SuppliersWidget
              projectId={project.id}
              nTarget={project.n_target}
              nInternalTarget={project.n_internal_target}
              nActual={project.n_actual}
            />
          )}
          {project.project_type === 'B2B' && <BlastConfigWidget projectId={project.id} />}
          {(project.project_type === 'Rerun' || project.project_type == null) && (
            <>
              <SuppliersWidget
                projectId={project.id}
                nTarget={project.n_target}
                nInternalTarget={project.n_internal_target}
                nActual={project.n_actual}
              />
              <BlastConfigWidget projectId={project.id} />
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
            value={project.longitudinal ?? false}
            tone="emerald"
            tooltip={TIP.longitudinal}
            onToggle={v => save({ longitudinal: v })}
          />
          <FlagChip
            label="Voter Survey QA"
            value={project.voter_survey_qa ?? false}
            tone="amber"
            tooltip={TIP.voterQa}
            onToggle={v => save({ voter_survey_qa: v })}
          />
          <FlagChip
            label="Citation Language"
            value={project.citation_language_needed ?? false}
            tone="amber"
            tooltip={TIP.citation}
            onToggle={v => save({ citation_language_needed: v })}
          />
          <FlagChip
            label="Row-Level Data"
            value={project.row_level_data}
            tone="emerald"
            tooltip={TIP.rowLevel}
            onToggle={v => save({ row_level_data: v })}
          />
          <FlagChip
            label="Terminations"
            value={project.terminations}
            tone="red"
            tooltip={TIP.terminations}
            onToggle={v => save({ terminations: v })}
          />
        </div>
      </FieldSection>
    </div>
  )
}

const CHIP_ON: Record<'red' | 'amber' | 'emerald', string> = {
  red: 'bg-red-500/15 text-red-600 dark:text-red-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
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
  tooltip,
  onToggle,
}: {
  label: string
  value: boolean
  tone: 'red' | 'amber' | 'emerald'
  tooltip?: string
  onToggle: (next: boolean) => void
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full pl-2 pr-0.5 py-0.5 text-[10px] leading-none transition-colors',
        value ? CHIP_ON[tone] : 'border border-dashed border-border bg-transparent text-muted-foreground',
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(!value)}
        aria-pressed={value}
        className="cursor-pointer whitespace-nowrap hover:opacity-80 transition-opacity"
      >
        {value ? (tone === 'red' ? `⚠ ${label}` : `✓ ${label}`) : `○ ${label}`}
      </button>
      {tooltip && <InfoTooltip text={tooltip} />}
    </span>
  )
}
