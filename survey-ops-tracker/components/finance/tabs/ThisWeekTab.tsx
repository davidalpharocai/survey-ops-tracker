'use client'

/**
 * Finance · This week (Tab 2 of the finance spec).
 *
 * Live work only — started, not yet delivered — plus the Hold bucket beside it.
 * Each row is one decision: what happened, what is at stake, what to do, and a
 * button that puts the action on the survey's own next-step list. Every figure
 * comes from lib/finance/thisWeek.ts `buildThisWeekModel`; this file loads the
 * few extra reads the tab needs (in ../thisweek/useThisWeekExtras) and renders.
 *
 * Three cards, in the order a busy reader acts on them:
 *   1. Decisions this week — the header figures, then every verb group ranked
 *      by dollars at stake, each live survey drawn as a bullet (Chart C3).
 *   2. On hold — its own bucket, never summed into a live figure (David,
 *      2026-09-24: "im trying to minimize # of holds").
 *   3. Credit pools — one bar per contract.
 */

import { useEffect, useMemo, useRef } from 'react'
import { priceBlockText, costFloorText } from '@/lib/finance/load'
import { describe as describeFilter, TAB_RULES } from '@/lib/finance/filters'
import { money } from '@/lib/finance/format'
import {
  buildThisWeekModel, creditPoolDrill, thisWeekDrills, VERB_META,
  type ThisWeekInput,
} from '@/lib/finance/thisWeek'
import { fmtNum } from '@/lib/utils/number'
import type { FinanceTabProps } from './types'
import { Empty, FinanceCard, Figure, Note } from './Card'
import { DecisionGroup } from '../thisweek/DecisionGroup'
import { CreditPools } from '../thisweek/CreditPools'
import { useHoldSince, useOwners, useSeriesRecords, useTermDollars } from '../thisweek/useThisWeekExtras'

const GUIDANCE =
  'Live work only: started, not yet delivered, plus surveys on hold. Each row is one decision — what happened, what is at stake, what to do. ' +
  'The date range does not apply here, because an overspending survey matters whenever it launched.'

export function ThisWeekTab(props: FinanceTabProps) {
  const { load, ix, items, population, side, filter, today, scope, accountName, openDrill, registerExport } = props
  const raw = load.raw

  const holdIds = useMemo(() => side.map(it => it.p.id), [side])
  const holdSince = useHoldSince(holdIds)
  const series = useSeriesRecords()
  const termDollars = useTermDollars()
  const owners = useOwners()

  const blockedTables = useMemo(() => load.blocked.map(b => b.table), [load.blocked])
  // /finance is gated server-side to finance holders, so this tab only ever
  // renders for one; the prices it reads are theirs to see.
  const priceBlocked = useMemo(() => priceBlockText(load, { canViewFinancials: true }), [load])
  const costFloor = useMemo(() => costFloorText(load), [load])

  const input = useMemo<ThisWeekInput>(() => ({
    population, side, items,
    projects: raw.projects,
    rates: raw.rates,
    blasts: raw.blasts,
    suppliers: raw.suppliers,
    launches: raw.launches,
    costs: raw.costs,
    ix,
    terms: raw.terms,
    filter, today, accountName,
    blocked: blockedTables,
    priceBlocked,
    termDollars, series, holdSince, owners,
  }), [population, side, items, raw, ix, filter, today, accountName, blockedTables, priceBlocked, termDollars, series, holdSince, owners])

  const model = useMemo(() => buildThisWeekModel(input), [input])
  const drills = useMemo(() => thisWeekDrills(input, model, scope.chip), [input, model, scope.chip])

  // The shell's "Export what you see" writes the verb rows — every decision on
  // the page, holds included and labelled. Held in a ref so a new callback
  // identity from the shell never re-registers (or loops).
  const reg = useRef(registerExport)
  reg.current = registerExport
  useEffect(() => {
    reg.current({ name: 'finance-this-week-decisions', columns: model.exportColumns, rows: model.exportRows })
  }, [model])
  useEffect(() => () => reg.current(null), [])

  const holdScope = useMemo(() => describeFilter(filter, {
    tab: 'this-week', today, count: side.length,
    accountName: filter.account ? accountName(filter.account) : null,
    rule: { ...TAB_RULES['this-week'], classes: ['hold'], side: [], word: 'On hold', ignoredNote: 'On hold — all dates' },
  }), [filter, today, side.length, accountName])

  const h = model.header
  const moving = model.groups.some(g => (g.verb === 'freeze' || g.verb === 'stop') && g.rows.length > 0)
  // A group is drawn when it has rows, could not run, is still loading, or
  // found nothing but could not see all of its population (its note says so).
  const shown = model.groups.filter(g => g.rows.length || g.blocked.length || g.pending || g.note)
  const poolScope = [
    'Credit contracts',
    filter.account ? accountName(filter.account) : 'All accounts',
    `${fmtNum(model.pools.length)} ${model.pools.length === 1 ? 'pool' : 'pools'}`,
  ].join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <FinanceCard
        id="this-week-decisions"
        title="Decisions this week"
        help="Every live survey that needs a decision, grouped by what to do and ranked by the dollars at stake. Delivered free trials, credit contracts and recurring series appear too when they need a decision this week. Surveys on hold have their own card below."
        scope={scope.chip}
        ignored={scope.ignored}
        needs={['survey_projects']}
        blocked={load.blocked}
        verdict={model.verdict}
        tone={moving ? 'alert' : undefined}
      >
        <Note>{GUIDANCE}</Note>
        <p className="px-4 pt-3 text-sm leading-relaxed">{h.sentence}</p>
        <div className="grid grid-cols-2 lg:grid-cols-5">
          <Figure
            label="Live surveys"
            help="Sold and running: not yet delivered, not on hold, not cancelled. The date filter does not apply."
            value={fmtNum(h.live)}
            sub="Surveys on hold are not in this count"
          />
          <Figure
            label="Spent so far"
            help="Recorded field cost on the live surveys: blast rewards and sends, panel CPI × completes, vendor lines, less rewards recovered. No salaries or overhead."
            value={h.spendBlocked ? '—' : money(h.spent)}
            sub={h.spendBlocked ?? costFloor ?? `On ${fmtNum(h.live)} live ${h.live === 1 ? 'survey' : 'surveys'}`}
            tone="cost"
            // With every cost table missing there is nothing to drill into: the
            // rows would all read $0 and the strip would call them reconciled.
            onOpen={h.spendBlocked ? undefined : () => openDrill(drills.spent)}
            openLabel="Show the spend on each live survey"
          />
          <Figure
            label="Worth at target"
            help="Price per N × the N sold, on the live surveys that have both. An upper bound: surveys often land short. Unsold scoping is never in it."
            value={h.priceBlocked ? '—' : money(h.worthAtTarget)}
            sub={h.priceBlocked
              ? h.priceBlocked
              : `${fmtNum(h.pricedWithTarget)} of ${fmtNum(h.live)} have a price and a target; ${fmtNum(h.noPrice)} have no price and ${fmtNum(h.noTarget)} no target`}
            tone="price"
            onOpen={drills.worth ? () => openDrill(drills.worth!) : undefined}
            openLabel="Show each live survey's value at target"
          />
          <Figure
            label="On hold"
            help="Paused surveys. Their own bucket: never in the live count, the spend or the value above."
            value={fmtNum(h.holds)}
            sub={h.spendBlocked ?? costFloor ?? `${money(h.holdSpend)} spent, kept out of the live figures`}
            onOpen={h.spendBlocked ? undefined : () => openDrill(drills.hold)}
            openLabel="Show the spend on each held survey"
          />
          <Figure
            label="Unsold scoping"
            help="Surveys still being scoped or priced and not buying respondents. Not sold, so they are counted here and valued nowhere."
            value={fmtNum(h.scoping)}
            sub="Counted, never in the pipeline figure"
          />
        </div>
        {/* A partial cost failure leaves a figure that is a floor, and says so.
            A total one leaves no figure at all: the header sentence and both
            money figures already carry that reason, so "floor only" — which
            would be a floor of $0 — is not repeated here. */}
        {!h.spendBlocked && costFloor && <Note tone="neg">{costFloor}</Note>}
        {shown.map(g => <DecisionGroup key={g.verb} group={g} />)}
        {model.overlapNote && (
          <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground" title="The same survey can appear under two or three verbs, so the group totals are not additive.">
            {model.overlapNote}
          </p>
        )}
        {model.clear.length > 0 && (
          <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground" title="These checks ran on every live survey in view and found nothing to do">
            Clear this week: {model.clear.map(v => VERB_META[v].label.toLowerCase()).join(', ')}.
          </p>
        )}
      </FinanceCard>

      <FinanceCard
        id="this-week-holds"
        title="On hold — its own bucket"
        help="Every paused survey, with how long it has been paused where the change log records a real status change. None of these is counted in any live figure. Each one needs a decision: resume it or cancel it."
        scope={holdScope.chip}
        ignored={holdScope.ignored}
        needs={['survey_projects']}
        blocked={load.blocked}
        verdict={model.holdVerdict}
      >
        {/* The cost caveat belongs on THIS card too. Its figures are spend, and
            the card that carries the caveat is a scroll away: a hold ranked at
            $0 because a cost table failed must never read as a hold that cost
            nothing. `needs` stays at survey_projects on purpose — one failed
            cost table would otherwise hide the holds themselves, and a held
            survey still needs a decision. When EVERY cost table failed there is
            no floor to state: each row says so in its own "At stake", and the
            group note below repeats it once. */}
        {!h.spendBlocked && costFloor && <Note tone="neg">{costFloor}</Note>}
        {model.hold.rows.length ? <DecisionGroup group={model.hold} /> : <Empty>No survey is on hold.</Empty>}
      </FinanceCard>

      <FinanceCard
        id="this-week-credits"
        title="Credit pools"
        help="One bar per credit contract: credits drawn on delivered and on live work against the pool, with the share of the term gone. Credits are counts. Any dollar value is derived and says how."
        scope={poolScope}
        ignored={[...scope.ignored, ...(filter.route !== 'all' ? ['Route: a pool counts every route'] : [])]}
        needs={['client_terms', 'survey_projects']}
        blocked={load.blocked}
        verdict={model.poolsVerdict}
      >
        {/* The agreed dollar value of a contract is a read of its own. When it
            fails, the rate below is implied by the contract's own priced
            surveys and the card has to say so — an implied rate and an agreed
            one are printed the same way otherwise. */}
        {model.poolsNote && (
          <Note tone={model.poolsNote.startsWith('Blocked') ? 'neg' : undefined}>{model.poolsNote}</Note>
        )}
        <div className="px-4 py-3">
          <CreditPools pools={model.pools} today={today} onOpen={p => openDrill(creditPoolDrill(input, p))} />
        </div>
      </FinanceCard>
    </div>
  )
}
