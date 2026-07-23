'use client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import { stageLabel } from '@/lib/utils/stage'
import { stageDurations } from '@/lib/utils/stageTiming'
import { useStageHistory } from '@/lib/hooks/useStageHistory'
import type { SurveyProject } from '@/lib/hooks/useProjects'

const card = 'bg-card border border-border shadow-sm rounded-xl p-3'
const sectionTitle = 'text-xs uppercase tracking-widest text-muted-foreground font-medium mb-2 flex items-center'

/**
 * Insights panel showing how long the project has spent in each pipeline
 * stage. The clock starts at Doc Programming — Submitted → Doc Programming
 * is intake time and is deliberately not tracked (see stageTiming.ts).
 *
 * Additive: renders its own empty state (and stays out of the way) until
 * migration 062 has run and the project has advanced past Submitted.
 */
export function StageTimePanel({ project }: { project: SurveyProject }) {
  const { data: rows = [] } = useStageHistory(project.id)
  const durations = stageDurations(rows, new Date())

  const totalDays = durations.reduce((s, d) => s + d.days, 0)
  const maxDays = Math.max(1, ...durations.map((d) => d.days))

  return (
    <div className={card}>
      <p className={sectionTitle}>
        Time in each stage
        <span className="ml-2 inline-flex items-center text-[10px] uppercase tracking-wide font-medium text-primary bg-primary/10 border border-primary/30 rounded-full px-1.5 py-0.5 normal-case">
          New
        </span>
        <InfoTooltip text="Days spent in each stage. The clock starts when the project moves to Doc Programming — intake time before Doc isn't tracked." />
      </p>

      {durations.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          Stage timing will appear once this project advances to Doc Programming (starts logging then).
        </p>
      ) : (
        <>
          <p className="text-[12px] text-muted-foreground mb-2">
            Submitted → Doc Programming <span className="italic">· not tracked</span> · {fmtNum(totalDays)} days since Doc Programming
          </p>

          <div className="flex flex-col gap-1.5">
            {durations.map((d, i) => {
              const frac = Math.max(d.days / maxDays, 0.04)
              return (
                <div key={`${d.stage}-${i}`} className="flex items-center gap-2 text-[12px]">
                  <span className="w-32 shrink-0 truncate text-foreground" title={stageLabel(d.stage)}>
                    {stageLabel(d.stage)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full ${d.ongoing ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                        style={{ width: `${Math.min(100, frac * 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                    {fmtNum(d.days)}d{d.ongoing ? ' · now' : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
