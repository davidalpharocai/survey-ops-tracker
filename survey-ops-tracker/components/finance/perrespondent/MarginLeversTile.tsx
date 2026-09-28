'use client'

/**
 * Tile 5 — Where more margin could come from.
 *
 * TWO lists, each on its own dollar axis (chart C5, one RangeChart per list):
 * SAVE COST (field cost we could stop spending) and EARN MORE (client price we
 * could quote for). A cost saving and a gross client-price dollar are different
 * currencies, so they are never drawn on one axis and never added up — and the
 * levers inside a list overlap, so there is no grand total anywhere on the
 * tile.
 *
 * Every lever is recomputed on ONE declared population — delivered and live
 * work in the window × account × route — which the scope chip prints. A lever
 * with fewer than MIN_CLASS_N surveys behind it reads "too few surveys here to
 * call" and draws no bar. Every lever's drill checks its rows against the
 * lever's own ids (lib/finance/perRespondent.ts leverDrill).
 */

import { useEffect, useState } from 'react'
import { RangeChart, fmtMoneyCompact } from '@/components/charts'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { EVIDENCE_HELP, MIN_CLASS_N, type Evidence } from '@/lib/finance/savings'
import { leverDrill, type LeverSlot, type PerRespondentModel } from '@/lib/finance/perRespondent'
import { FinanceCard } from '@/components/finance/tabs/Card'
import type { FinanceTabProps } from '@/components/finance/tabs/types'
import { RejectedRules, REJECTED_ANCHOR } from './RejectedRules'

const TILE_HELP =
  'Levers a manager could pull next week, each with its range, how firm the range is, what it gives up, one rule and the surveys behind it. ' +
  `Computed on delivered and live work in view. Save cost and earn more are different kinds of money, so they have separate axes and are never added; the levers overlap, so there is no total. A lever with fewer than ${MIN_CLASS_N} surveys behind it is not called.`

const SIDE = {
  save: {
    title: 'Save cost',
    help: 'Field cost we could stop spending: rewards, text sends and panel purchases. Each range is money that would not have left.',
    value: 'Could save',
    color: 'var(--chart-keep)',
  },
  earn: {
    title: 'Earn more',
    help: 'Client price we could quote for next time. Opportunities, not amounts anyone owes: over-delivery is a courtesy and is never billed.',
    value: 'Could earn',
    color: 'var(--chart-price)',
  },
} as const

/**
 * A badge is 11px uppercase — normal-size text for WCAG AA, which wants 4.5:1.
 * A token colour on a 14% tint of itself does not reach that (green 4.4:1
 * light, red 4.4:1 light and 4.5:1 dark), so the two coloured badges use the
 * pairing the chart tokens are built for: a solid fill with
 * `--chart-on-strong` on top — 5.4:1 / 6.2:1 for keep and 5.3:1 / 5.5:1 for
 * loss, light and dark. The other two badges already clear the bar (amber
 * 4.7:1 light, muted 7.4:1 light) and keep their lighter weight, which also
 * reads as the weaker evidence it is.
 */
const CONF_CLASS: Record<Evidence, string> = {
  measured: 'bg-[var(--chart-keep)] text-[var(--chart-on-strong)]',
  depends: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  direction: 'bg-muted text-muted-foreground',
}

/** The risk tag, on the same solid-fill rule as the measured badge. */
const RISK_CLASS = 'bg-[var(--chart-loss)] text-[var(--chart-on-strong)]'

export function MarginLeversTile({ model, tab }: { model: PerRespondentModel; tab: FinanceTabProps }) {
  const { load, hrefFor } = tab
  const t = model.levers
  const [open, setOpen] = useState(false)

  // A link to "#rejected-rules" (copied, or opened in a new tab) arrives with
  // the section open.
  useEffect(() => {
    try {
      if (window.location.hash === `#${REJECTED_ANCHOR}`) setOpen(true)
    } catch { /* no window: nothing to open */ }
  }, [])
  useEffect(() => {
    if (!open) return
    try {
      if (window.location.hash === `#${REJECTED_ANCHOR}`) {
        document.getElementById(REJECTED_ANCHOR)?.scrollIntoView({ block: 'start' })
      }
    } catch { /* jsdom / no layout */ }
  }, [open])

  const n = model.rejected.length
  const rejectedHref = `${hrefFor({})}#${REJECTED_ANCHOR}`

  return (
    <>
      <FinanceCard
        id="margin-levers"
        title="Where more margin could come from"
        help={TILE_HELP}
        scope={t.scope.chip}
        ignored={t.scope.ignored}
        needs={['survey_projects', 'project_blasts', 'project_suppliers', 'project_costs']}
        blocked={load.blocked}
        verdict={t.verdict}
      >
        <div className="grid gap-px bg-border md:grid-cols-2">
          <LeverList side="save" slots={t.save} model={model} tab={tab} />
          <LeverList side="earn" slots={t.earn} model={model} tab={tab} blocked={t.earnBlocked} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>Each list has its own axis. Nothing here is added up: the two lists are different kinds of money, and levers in one list overlap.</span>
          <a
            href={rejectedHref}
            onClick={() => setOpen(true)}
            className="font-medium text-primary underline-offset-2 hover:underline"
            title="Rules that look obvious and were tested against the data, with why they lose money"
          >
            {n} {n === 1 ? 'rule' : 'rules'} tested and rejected →
          </a>
        </div>
      </FinanceCard>
      {open && <RejectedRules model={model} onClose={() => setOpen(false)} />}
    </>
  )
}

function LeverList({ side, slots, model, tab, blocked }: {
  side: 'save' | 'earn'
  slots: LeverSlot[]
  model: PerRespondentModel
  tab: FinanceTabProps
  blocked?: string | null
}) {
  const s = SIDE[side]
  const names = new Map(tab.load.raw.accounts.map(a => [a.id, a.name ?? '(unnamed account)']))
  const drill = (slot: LeverSlot) => {
    const spec = leverDrill(slot, model, tab.load.raw, id => names.get(id) ?? '(unknown account)')
    if (spec) tab.openDrill(spec)
  }
  return (
    <section className="min-w-0 bg-card px-4 py-3" aria-label={s.title}>
      <h3 className="flex items-center text-sm font-semibold">
        {s.title}
        <InfoTooltip text={s.help} />
      </h3>
      {blocked ? (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {blocked}. These figures are missing, not zero.
        </p>
      ) : (
        <>
          <div className="mt-2">
            <RangeChart
              ariaLabel={`${s.title}: the range each lever could be worth, in dollars`}
              data={slots}
              label={d => d.title}
              labelHeader="Lever"
              sublabel={d => (d.givesUp ? `Gives up ${d.givesUp}` : null)}
              low={d => d.low}
              high={d => d.high}
              confidence={d => d.confidence}
              muted={d => d.callable && d.lever?.evidence === 'direction'}
              mutedNote="direction only"
              missingText={d => d.reason}
              valueName={s.value}
              axisFormat={fmtMoneyCompact}
              color={s.color}
              onSelect={d => { if (d.lever) drill(d) }}
            />
          </div>
          <ol className="mt-3 divide-y divide-border/60 border-t border-border/60">
            {slots.map((slot, i) => <LeverRow key={slot.key} slot={slot} index={i} onOpen={() => drill(slot)} />)}
          </ol>
        </>
      )}
    </section>
  )
}

function LeverRow({ slot, index, onOpen }: { slot: LeverSlot; index: number; onOpen: () => void }) {
  const l = slot.lever
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-sm font-medium">
          <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>
          {l ? (
            <button
              type="button"
              onClick={onOpen}
              title="Show the surveys behind this lever"
              className="rounded text-left underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--chart-price)]"
            >
              {slot.title}
            </button>
          ) : slot.title}
        </span>
        <span className={'shrink-0 tabular-nums text-sm ' + (slot.callable ? 'font-semibold' : 'italic text-muted-foreground')}>
          {slot.range}
        </span>
      </div>
      {l && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span
            title={EVIDENCE_HELP[l.evidence]}
            className={'rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ' + CONF_CLASS[l.evidence]}
          >
            {slot.confidence}
          </span>
          {l.riskTag && (
            <span
              title={l.risk}
              className={'rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ' + RISK_CLASS}
            >
              {l.riskTag}
            </span>
          )}
          {l.free && !l.riskTag && (
            <span title="Acting on it costs nothing in quality, speed or delivery risk." className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              costs nothing to try
            </span>
          )}
        </div>
      )}
      {slot.reason && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{slot.reason}</p>}
      {l && (
        <>
          <p className="mt-1.5 text-[13px] leading-relaxed">
            <span className="font-medium">Rule:</span> {l.rule}
          </p>
          {/* The evidence carries the figure; a lever that is not called keeps
              its figure to itself (the too-few rule), so its evidence is not shown. */}
          {slot.callable && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{l.why}</p>}
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Gives up</span> {l.givesUp}.{' '}
            <span className="font-medium text-foreground">If it is wrong:</span> {l.risk}
          </p>
        </>
      )}
    </li>
  )
}
