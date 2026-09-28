'use client'

/**
 * Tile 4 — What one respondent costs.
 *
 * Two cards, panel and blast, each with its own axis. They are never averaged
 * together: a qualified blast respondent costs tens of times a panel one, and
 * a blended figure would describe the mix of work, not either route.
 *
 * On each card one dumbbell (chart C4) is drawn from ONE reconciled set of
 * surveys (lib/finance/cpqr.ts): the ring is pooled cost per complete bought,
 * the dot pooled cost per qualified respondent, so the line between them —
 * "QA removed x%" — IS the scrub on those surveys. The old page printed two
 * cards from two populations and claimed that identity falsely. Clicking the
 * row opens the route's surveys ranked by the dollars each cost above typical.
 */

import Link from 'next/link'
import { DumbbellChart, fmtCount } from '@/components/charts'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { pctText } from '@/lib/finance/format'
import {
  belowFloorDrill, routeDrill,
  type PerRespondentModel, type RouteCard,
} from '@/lib/finance/perRespondent'
import { FinanceCard, Note } from '@/components/finance/tabs/Card'
import type { FinanceTabProps } from '@/components/finance/tabs/types'
import { withParam } from './href'

const TILE_HELP =
  'Pooled over one set of delivered surveys whose cost records add up: the ring is cost per complete bought, the dot is cost per qualified respondent (after QA), so the gap between them is exactly what QA removed. ' +
  'The box is the typical survey — the middle half, median ticked. Panel and blast are on their own axes and never averaged. Click a row for its surveys.'

const LINE_HELP = {
  coverage: 'Which delivered surveys this card counts. A survey is left out when its field rows do not cover the N it claims (its cost per respondent would read too low), or when its N actual counts only some of its segments.',
  recovered: 'Blast rewards that went unclaimed and came back. The card is net of them; the figure before they came back is shown too, because recoveries are booked in batches.',
  quote: 'Cost per BILLED respondent — the same denominator as a client price — times 1 ÷ (1 − the 50% goal). At or above it, spend stays within about half the price on the typical survey. The safer floor uses the dearer quarter of surveys instead of the typical one. The typical cost is rounded before the multiple is applied, so the floor is exactly the multiple of the figure printed beside it.',
  priced: 'Delivered surveys fielded ONLY this way in view with a client price above $0, compared with the floor. A $0 price is left out: free work is not a quote. A survey fielded both ways, or with no recorded field cost, belongs to neither card — the closing line counts those separately.',
  priceBlocked: 'The client prices this comparison needs did not load. The surveys are still there; the comparison is missing, not zero.',
  buy: 'How many completes to buy for each respondent sold: 1 ÷ the keep rate a quarter of past surveys fell below. Counted on the same surveys, so the "covers" figure is real, not assumed.',
  concentration: 'The fewest panels carrying at least 80% of panel spend in view, and what was paid above the cheapest panel buying in the same PureSpectrum wave. Direction only: panel capacity and per-panel QA are not recorded.',
}

export function RespondentCostTile({ model, tab }: { model: PerRespondentModel; tab: FinanceTabProps }) {
  const { scope, load, hrefFor } = tab
  const improve = hrefFor({ tab: 'improve' })
  const f = model.footnote
  return (
    <FinanceCard
      id="respondent-cost"
      title="What one respondent costs"
      help={TILE_HELP}
      scope={scope.chip}
      ignored={scope.ignored}
      // project_segments too: without them a survey whose N actual counts only
      // some segments (PR00231) cannot be told apart, and would enter the rate
      // reading an uncounted segment as QA scrub.
      needs={['survey_projects', 'project_blasts', 'project_suppliers', 'project_costs', 'project_segments']}
      blocked={load.blocked}
      verdict={model.tile4Verdict}
    >
      <div className="grid gap-px bg-border md:grid-cols-2">
        {model.cards.map(card => <RouteCardView key={card.route} card={card} model={model} tab={tab} />)}
      </div>
      {(f.bothWays || f.partial) && (
        <Note>
          {f.bothWays && <>{f.bothWays.text} </>}
          {f.partial && <>{f.partial.text} </>}
          <Link href={improve} className="font-medium text-primary underline-offset-2 hover:underline">
            See what to record on Improve →
          </Link>
        </Note>
      )}
    </FinanceCard>
  )
}

function Line({ children, help, tone }: { children: React.ReactNode; help: string; tone?: 'muted' | 'neg' }) {
  return (
    <li
      // `neg` is a failed read, not a small number: it is announced, and it is
      // the one line on the card that takes colour.
      role={tone === 'neg' ? 'alert' : undefined}
      className={
        'flex gap-1 text-[13px] leading-relaxed ' +
        (tone === 'muted' ? 'text-muted-foreground' : tone === 'neg' ? 'text-red-700 dark:text-red-400' : '')
      }
    >
      <span className="min-w-0">{children}</span>
      <span className="shrink-0 pt-0.5"><InfoTooltip text={help} /></span>
    </li>
  )
}

function RouteCardView({ card, model, tab }: { card: RouteCard; model: PerRespondentModel; tab: FinanceTabProps }) {
  const { openDrill, scope, load, hrefFor } = tab
  const c = card.cpqr
  const open = () => {
    const spec = routeDrill(card, load.raw, scope.chip)
    if (spec) openDrill(spec)
  }
  // Built on click, not on render: the drill is only needed when opened.
  const hasBelow = !card.thin && (card.quote?.belowIds.length ?? 0) > 0
  const openBelow = () => {
    const byId = new Map(tab.items.map(i => [i.p.id, i.p]))
    const spec = belowFloorDrill(card, model, byId, load.raw.rates, scope.chip)
    if (spec) openDrill(spec)
  }
  const panels = withParam(hrefFor({ tab: 'results' }), 'by', 'panel')

  return (
    <section className="min-w-0 bg-card px-4 py-3" aria-label={card.title}>
      <h3 className="flex items-center text-sm font-semibold">
        {card.title}
        <InfoTooltip text={
          card.route === 'panel'
            ? 'Surveys bought from PureSpectrum panels. Route is read from each survey’s own cost records, not from how it was filed.'
            : 'Surveys fielded through B2B email and text blasts. Route is read from each survey’s own cost records, not from how it was filed.'
        } />
      </h3>
      {c ? (
        <div className="mt-2">
          <DumbbellChart
            ariaLabel={`${card.title}: cost per complete bought and per qualified respondent`}
            data={[card]}
            label={() => `${fmtCount(c.ids.length)} ${c.ids.length === 1 ? 'survey' : 'surveys'}, pooled`}
            labelHeader="Surveys"
            sublabel={() => `Box: the typical survey across ${fmtCount(c.n)}, median ticked`}
            start={() => c.perComplete}
            end={() => c.blended}
            connectorLabel={() => (card.qaRemoved != null ? `QA removed ${pctText(card.qaRemoved)}` : null)}
            box={() => ({ low: c.p25, median: c.median, high: c.p75 })}
            onSelect={open}
          />
        </div>
      ) : null}
      <ul className="mt-2 space-y-1.5">
        <Line help={LINE_HELP.coverage} tone="muted">{card.lines.coverage}</Line>
        {card.lines.recovered && <Line help={LINE_HELP.recovered} tone="muted">{card.lines.recovered}</Line>}
        {card.lines.quote && c && <Line help={LINE_HELP.quote}>{card.lines.quote}</Line>}
        {card.lines.quotePriced && (
          <Line help={LINE_HELP.priced}>
            {hasBelow ? (
              <button
                type="button"
                onClick={openBelow}
                title="Show the surveys priced below the floor"
                className="rounded text-left underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--chart-price)]"
              >
                {card.lines.quotePriced}
              </button>
            ) : card.lines.quotePriced}
          </Line>
        )}
        {/* The price comparison could not be made. The reason takes the line
            the comparison would have taken, so a failed read can never show up
            as one sentence fewer than yesterday. */}
        {card.priceNote && <Line help={LINE_HELP.priceBlocked} tone="neg">{card.priceNote}</Line>}
        {card.lines.buy && c && <Line help={LINE_HELP.buy}>{card.lines.buy}</Line>}
        {card.lines.concentration && (
          <Line help={LINE_HELP.concentration}>
            {card.lines.concentration}{' '}
            <Link href={panels} className="font-medium text-primary underline-offset-2 hover:underline">
              See panels →
            </Link>
          </Line>
        )}
      </ul>
      {c && (
        <button
          type="button"
          onClick={open}
          className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
          title="Every survey behind this card, ranked by the dollars it cost above a typical survey"
        >
          Show the {fmtCount(c.ids.length)} {c.ids.length === 1 ? 'survey' : 'surveys'} →
        </button>
      )}
    </section>
  )
}
