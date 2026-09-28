'use client'

/**
 * Tile 1 — What clients pay vs what we spent.
 *
 * Four figures on ONE set of surveys (the margin set), the coverage line that
 * says how much of the delivered spend that set holds, the spend that is not in
 * the figures at all, chart C1 by month, and the computed verdict. Every figure
 * opens the surveys behind it; nothing here computes a number — it all comes
 * from lib/finance/results.ts.
 */

import { useState } from 'react'
import { Figure, FinanceCard, Note, Empty } from '../tabs/Card'
import type { FinanceTabProps, Needs } from '../tabs/types'
import {
  goalCostWords, RESULTS_NEEDS,
  type ResultsAction, type ResultsDrillRequest, type ResultsModel,
} from '@/lib/finance/results'
import { MonthChart } from './MonthChart'
import { Parts } from './Parts'
import { Waterfall } from './Waterfall'
import { fmtNum } from '@/lib/utils/number'

/** Every figure here is price and cost (lib/finance/results.ts RESULTS_NEEDS). */
export const TILE1_NEEDS: Needs = RESULTS_NEEDS

const HELP = {
  card: 'Did we make money on finished work? Client price and our cost on the same surveys — the delivered ones where we know both what the client pays and what we spent. “We keep” is what is left after field cost, before salaries and overhead.',
  price: 'What clients pay us: their price per respondent times respondents delivered, never more than the N they bought.',
  cost: 'Field cost on the same surveys: panel, blast rewards and sends, vendor costs, less rewards recovered. No salaries or overhead.',
  kept: 'What is left after field cost, before salaries and overhead.',
  budget: `A budget is the most we planned to spend — a cost ceiling, meant to be about ${goalCostWords()} per $1 of client price. Going over it is not the same as losing money.`,
}

export function ResultsTile1({ props, model, open }: {
  props: FinanceTabProps
  model: ResultsModel
  open: (req: ResultsDrillRequest, month?: { label: string; from: string; to: string }) => void
}) {
  const [waterfall, setWaterfall] = useState(false)
  const t1 = model.tile1
  const improveHref = props.hrefFor({ tab: 'improve' })
  const onAction = (a: ResultsAction) => {
    if (a === 'waterfall') setWaterfall(w => !w)
    else if (a === 'unpriced' || a === 'cancelled' || a === 'archived') open({ kind: a })
  }

  return (
    <FinanceCard
      id="results-money"
      title="What clients pay vs what we spent"
      help={HELP.card}
      scope={props.scope.chip}
      ignored={props.scope.ignored}
      needs={TILE1_NEEDS}
      blocked={props.load.blocked}
      verdict={model.priceBlock ? undefined : <Parts parts={model.verdict} onAction={onAction} improveHref={improveHref} />}
    >
      {model.priceBlock ? (
        // No prices came back, or a price table failed: every figure here
        // would be computed on an empty price map, so none is shown.
        <Note tone="neg">{model.priceBlock}. These figures are missing, not zero.</Note>
      ) : (
        <>
          {t1.surveys === 0 ? (
            <Empty>No delivered survey in this view has both a client price and a recorded cost.</Empty>
          ) : (
            <div className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x">
              <Figure
                label="Client price" help={HELP.price} tone="price"
                value={t1.text.price.value} sub={t1.text.price.sub}
                onOpen={() => open({ kind: 'price' })}
                openLabel={`Show the ${fmtNum(t1.surveys)} surveys behind the client price`}
              />
              <Figure
                label="Our cost" help={HELP.cost} tone="cost"
                value={t1.text.cost.value} sub={t1.text.cost.sub}
                onOpen={() => open({ kind: 'cost' })}
                openLabel="Show our cost on the same surveys"
              />
              <Figure
                label="We keep" help={HELP.kept} tone={t1.kept < 0 ? 'loss' : 'keep'}
                value={t1.text.kept.value} sub={t1.text.kept.sub}
                onOpen={() => open({ kind: 'kept' })}
                openLabel="Show what we keep on each survey, worst first"
              />
              <Figure
                label="Budget set at" help={HELP.budget}
                value={t1.text.budget.value} sub={t1.text.budget.sub}
                onOpen={t1.budget.withBudget > 0 ? () => open({ kind: 'budget' }) : undefined}
                openLabel="Show every delivered survey with a budget: spend ÷ budget and spend ÷ price"
              />
            </div>
          )}

          <Note>
            <Parts parts={model.coverage.parts} onAction={onAction} improveHref={improveHref} expanded={{ waterfall }} />
          </Note>
          {waterfall && (
            <Waterfall model={model.waterfall} onLine={line => open({ kind: 'line', line })} />
          )}
          <Note>
            <Parts parts={model.notIn.parts} onAction={onAction} improveHref={improveHref} />
          </Note>

          <div className="border-t border-border px-4 py-3">
            <MonthChart
              months={model.months}
              costReliableFrom={model.costReliableFrom}
              onSelect={m => open({ kind: 'month', key: m.key }, { label: m.label, from: m.from, to: m.to })}
            />
            {model.undated && model.undated.delivered > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {fmtNum(model.undated.delivered)} delivered {model.undated.delivered === 1 ? 'survey has' : 'surveys have'} no
                deliver, launch or submitted date: {model.undated.delivered === 1 ? 'it is' : 'they are'} in the figures above but in no month.
              </p>
            )}
          </div>
        </>
      )}
    </FinanceCard>
  )
}
