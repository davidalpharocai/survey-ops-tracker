'use client'
import { STAGE_ORDER } from '@/lib/utils/stage'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import type { BoardColumn } from '@/lib/utils/stage'

const STAGE_TO_FIELD: Record<string, keyof Pick<SurveyProject,
  'stage_doc_programming' | 'stage_survey_programming' | 'stage_edwin_qa' |
  'stage_fielding' | 'stage_data_qa' | 'stage_delivery'>> = {
  'Doc Programming': 'stage_doc_programming',
  'Survey Programming': 'stage_survey_programming',
  'EdWin QA': 'stage_edwin_qa',
  'Fielding': 'stage_fielding',
  'Data QA': 'stage_data_qa',
  'Delivery': 'stage_delivery',
}

function deriveColumn(updates: Record<string, boolean>): BoardColumn {
  if (!updates['stage_doc_programming']) return 'Submitted'
  if (!updates['stage_survey_programming']) return 'Doc Programming'
  if (!updates['stage_edwin_qa']) return 'Survey Programming'
  if (!updates['stage_fielding']) return 'EdWin QA'
  if (!updates['stage_data_qa']) return 'Fielding'
  if (!updates['stage_delivery']) return 'Data QA'
  return 'Delivery'
}

interface PipelineProgressProps {
  project: SurveyProject
}

export function PipelineProgress({ project }: PipelineProgressProps) {
  const updateProject = useUpdateProject()

  function toggleStage(stage: string) {
    const field = STAGE_TO_FIELD[stage]
    if (!field) return // Submitted has no checkbox

    const newValue = !project[field]

    // Build new checkbox state: if checking, also check all prior stages
    const newState: Record<string, boolean> = {
      stage_doc_programming: project.stage_doc_programming,
      stage_survey_programming: project.stage_survey_programming,
      stage_edwin_qa: project.stage_edwin_qa,
      stage_fielding: project.stage_fielding,
      stage_data_qa: project.stage_data_qa,
      stage_delivery: project.stage_delivery,
    }

    if (newValue) {
      // Check this stage and all prior stages
      for (const s of STAGE_ORDER.slice(1)) { // skip 'Submitted'
        const f = STAGE_TO_FIELD[s]
        if (!f) continue
        newState[f] = true
        if (s === stage) break
      }
    } else {
      // Uncheck this stage and all subsequent stages
      let unchecking = false
      for (const s of STAGE_ORDER.slice(1)) {
        const f = STAGE_TO_FIELD[s]
        if (!f) continue
        if (s === stage) unchecking = true
        if (unchecking) newState[f] = false
      }
    }

    const newColumn = deriveColumn(newState)
    updateProject.mutate({
      id: project.id,
      updates: { ...newState, board_column: newColumn },
    })
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        {STAGE_ORDER.map((stage, i) => {
          const field = STAGE_TO_FIELD[stage]
          const isDone = field ? project[field] : false
          const isCurrent = stage === project.board_column
          const isClickable = stage !== 'Submitted'

          return (
            <div key={stage} className="flex items-center gap-2">
              <button
                onClick={() => isClickable && toggleStage(stage)}
                disabled={!isClickable}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  isDone
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                    : isCurrent
                    ? 'bg-amber-500/15 border-amber-500/60 text-amber-400'
                    : 'bg-slate-800 border-slate-700 text-slate-500'
                } ${isClickable ? 'hover:border-slate-500 cursor-pointer' : 'cursor-default'}`}
              >
                <span>{isDone ? '✓' : isCurrent ? '▶' : '○'}</span>
                <span>{stage}</span>
                {isCurrent && <span className="text-slate-600 text-[10px]">(current)</span>}
              </button>
              {i < STAGE_ORDER.length - 1 && (
                <span className="text-slate-700 text-xs select-none">→</span>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-slate-600 mt-2">
        Checking a stage advances the project card on the board. Uncheck to move it back.
      </p>
    </div>
  )
}
