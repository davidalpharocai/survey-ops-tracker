'use client'

/**
 * Tile 2 — Where it was made and lost.
 *
 * Chart C2 is kept dollars per group, diverging around zero (teal kept to the
 * right, red lost to the left), each bar labelled "kept % · n". A group with
 * fewer than GROUP_MIN_N surveys in the margin set is muted and tagged "too few
 * to judge": one survey's price is not an account's pricing. The table beneath
 * carries every figure the chart draws and the ones it cannot (spend with no
 * price, per-respondent rates, route rows).
 *
 * Panel supplier is its own view, built by the panels slice
 * (components/finance/panels/PanelSupplierView.tsx) and rendered as-is.
 */

import { BarChart, fmtMoney, fmtMoneyCompact } from '@/components/charts'
import { FinanceCard, Empty } from '../tabs/Card'
import type { FinanceTabProps, Needs } from '../tabs/types'
import { PanelSupplierView } from '../panels/PanelSupplierView'
import { pctText } from '@/lib/finance/format'
import {
  GROUP_BY_OPTIONS, GROUP_MIN_N, type GroupRow, type LedgerRow, type ResultsDrillRequest, type ResultsModel,
} from '@/lib/finance/results'
import { fmtNum } from '@/lib/utils/number'
import { GroupTable } from './GroupTable'
import { Parts } from './Parts'
import { SurveyLedger } from './SurveyLedger'
import { TILE1_NEEDS } from './ResultsTile1'

const HELP = 'Who and what the margin comes from. Price and cost are both per billed respondent, so subtracting them gives what we keep per respondent. Every figure counts only the studies with both a client price and a recorded cost; spend on the rest is in the last column.'

export function ResultsTile2({ props, model, open }: {
  props: FinanceTabProps
  model: ResultsModel
  open: (req: ResultsDrillRequest) => void
}) {
  const by = model.groupBy
  if (by === 'panel') return <PanelSupplierView {...props} />

  // `clients` is already in TILE1_NEEDS: the loader drops demo accounts and
  // names every row from it, so it is a dependency of every grouping, not only
  // the one that prints account names.
  const needs: Needs = [
    ...TILE1_NEEDS,
    ...(by === 'contact' ? (['client_contacts'] as Needs) : []),
  ]
  const option = GROUP_BY_OPTIONS.find(o => o.id === by)
  const improveHref = props.hrefFor({ tab: 'improve' })
  const verdict = model.priceBlock
    ? undefined
    : <Parts parts={model.tile2.verdict} onAction={a => { if (a === 'unpriced') open({ kind: 'unpriced' }) }} improveHref={improveHref} />

  return (
    <FinanceCard
      id="results-where"
      title={`Where it was made and lost · by ${(option?.label ?? by).toLowerCase()}`}
      help={HELP}
      scope={props.scope.chip}
      ignored={props.scope.ignored}
      needs={needs}
      blocked={props.load.blocked}
      verdict={verdict}
    >
      {model.priceBlock ? (
        <Empty>{model.priceBlock}. These figures are missing, not zero.</Empty>
      ) : by === 'survey' ? (
        <SurveyView model={model} />
      ) : (
        <GroupView model={model} open={open} />
      )}
    </FinanceCard>
  )
}

function GroupView({ model, open }: { model: ResultsModel; open: (req: ResultsDrillRequest) => void }) {
  const rows = model.tile2.rows
  const drawn = rows.filter(r => r.measured > 0)
  const option = GROUP_BY_OPTIONS.find(o => o.id === model.groupBy)
  if (!rows.length) return <Empty>No delivered study is in this view.</Empty>
  return (
    <>
      <div className="px-4 py-3">
        <BarChart<GroupRow>
          ariaLabel={`What we keep by ${(option?.label ?? 'group').toLowerCase()}`}
          title={`Kept by ${(option?.label ?? 'group').toLowerCase()}`}
          info={`What we keep per ${(option?.label ?? 'group').toLowerCase()}, on its studies with both a client price and a recorded cost: teal kept, red lost. Each bar reads kept $ · kept % · studies. Faded bars have fewer than ${fmtNum(GROUP_MIN_N)} such studies and are too few to judge. Click a bar to see its studies, worst first.`}
          data={drawn}
          label={r => (r.sub ? `${r.label} · ${r.sub}` : r.label)}
          labelHeader={option?.label ?? 'Group'}
          value={r => r.kept}
          valueName="Kept $"
          valueFormat={v => fmtMoney(v)}
          valueLabel={{
            name: 'Kept $ · kept % · studies',
            text: r => `${fmtMoneyCompact(r.kept)} · ${pctText(r.keptPct)} · ${fmtNum(r.measured)}`,
            description: 'Kept dollars, kept as a share of the client price, and the studies with a price and a cost behind them.',
          }}
          diverging
          positiveLabel="Kept"
          negativeLabel="Lost"
          muted={r => r.tooFew}
          mutedNote="too few to judge"
          onSelect={r => open({ kind: 'group', key: r.key })}
          emptyMessage="No group here has a study with both a client price and a recorded cost."
        />
        {model.tile2.unmeasured > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {fmtNum(model.tile2.unmeasured)} more {model.tile2.unmeasured === 1 ? 'group has' : 'groups have'} no study with both a price and a
            cost, so {model.tile2.unmeasured === 1 ? 'it is' : 'they are'} only in the table, under Spend with no price.
          </p>
        )}
      </div>
      <GroupTable
        by={model.groupBy}
        rows={rows}
        onGroup={(r, route) => open({ kind: 'group', key: r.key, route })}
        onUnpriced={r => open({ kind: 'group-unpriced', key: r.key })}
      />
    </>
  )
}

function SurveyView({ model }: { model: ResultsModel }) {
  const measured = model.ledger.filter(l => l.inMargin)
  if (!model.ledger.length) return <Empty>No delivered study is in this view.</Empty>
  return (
    <>
      <div className="max-h-[520px] overflow-y-auto px-4 py-3">
        <BarChart<LedgerRow>
          ariaLabel="What we keep on each study, worst first"
          title="Kept by study"
          info="What we keep on each study with both a client price and a recorded cost, worst first: teal kept, red lost. A study given away at $0 shows its whole cost as a loss. Click a bar to open the project."
          data={measured}
          label={l => l.code ?? '(no code)'}
          labelHeader="Study"
          value={l => l.kept}
          valueName="Kept $"
          valueFormat={v => fmtMoney(v)}
          valueLabel={{
            name: 'Kept $ · kept %',
            text: l => `${fmtMoneyCompact(l.kept)} · ${l.free ? 'given away' : pctText(l.keptPct)}`,
          }}
          diverging
          positiveLabel="Kept"
          negativeLabel="Lost"
          href={l => `/projects/${l.id}`}
          emptyMessage="No study here has both a client price and a recorded cost."
        />
      </div>
      <SurveyLedger rows={model.ledger} />
    </>
  )
}
