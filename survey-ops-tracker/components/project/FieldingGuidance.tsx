'use client'

import { useState } from 'react'
import { useProjectBlasts } from '@/lib/hooks/useProjectBlasts'
import { useProjectSuppliers } from '@/lib/hooks/useProjectSuppliers'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import { fieldingGuidance, GUIDANCE_STYLE, EVIDENCE_DATE } from '@/lib/fielding/guidance'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

/**
 * What the measured history says to do about this survey.
 *
 * ── WHY EVERY ITEM SHOWS ITS WORKING ────────────────────────────────────────
 * The rules behind this panel came from 47 candidate findings, of which 35 were
 * refuted when a second pass re-measured them — including several that read as
 * confidently as the four that survived. So each item carries the sample size
 * and the measurement date, and the reader can open "how do we know" on any of
 * them. Advice nobody can audit is advice nobody should take, and this team has
 * now watched a plausible number be wrong often enough to want the receipts.
 *
 * ── IT RENDERS NOTHING RATHER THAN RENDERING "ALL CLEAR" ────────────────────
 * A panel that says "no guidance" every day is a panel people stop reading, and
 * then it is not there on the day it matters. Delivered, held, closed and
 * scoping work gets no panel at all.
 */
export function FieldingGuidance({
  project,
  /** Tab mode. Inline the panel simply disappears when it has nothing to say;
   *  as a TAB it must explain the blank, or clicking it looks broken. */
  showEmpty = false,
}: { project: SurveyProject; showEmpty?: boolean }) {
  const { data: blasts } = useProjectBlasts(project.id)
  const { data: suppliers } = useProjectSuppliers(project.id)
  const [open, setOpen] = useState<string | null>(null)

  const items = fieldingGuidance({
    n_target: project.n_target,
    n_collected: project.n_collected,
    n_actual: project.n_actual,
    board_column: project.board_column,
    status: project.status,
    phase: project.phase,
    blasts: blasts ?? [],
    suppliers: suppliers ?? [],
  })

  if (items.length === 0) {
    if (!showEmpty) return null
    const finished = project.board_column === 'Delivery'
      || project.status === 'Hold' || project.status === 'Closed' || project.status === 'Cancelled'
    return (
      <section className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-sm font-medium">No guidance for this survey</p>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
          {finished
            ? 'The fielding decisions on this one are already made. Guidance only appears while a survey is open and still has choices left in it.'
            : 'Nothing here yet — guidance needs a target N, or blasts and launches on file, before it has anything to price or compare. It appears as soon as either exists.'}
        </p>
      </section>
    )
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <h3 className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Fielding guidance
        </span>
        <InfoTooltip text={`What this survey's own route, N and blast history imply, priced against every survey SOCC has recorded. Measured ${EVIDENCE_DATE}. Cost only — client rates are recorded on 4 of 322 delivered surveys, so nothing here can speak to margin.`} />
      </h3>

      {items.map(g => {
        const style = GUIDANCE_STYLE[g.level]
        const isOpen = open === g.code
        return (
          <div key={g.code} className="border-b border-border/60 px-4 py-3 last:border-0">
            <div className="flex items-start gap-2.5">
              <span className={`mt-px shrink-0 rounded-full border px-2 py-px text-[11px] ${style.className}`}>
                {style.label}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{g.headline}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{g.detail}</p>
                {/* Collapsed by default: the evidence must be ALWAYS available
                    and never in the way. Four items each shouting their sample
                    size is a wall nobody reads. */}
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : g.code)}
                  className="mt-1.5 text-[11px] text-muted-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
                >
                  {isOpen ? 'Hide the working' : 'How do we know?'}
                </button>
                {isOpen && (
                  <p className="mt-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                    {g.evidence}
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}
