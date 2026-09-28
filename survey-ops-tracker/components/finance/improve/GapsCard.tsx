'use client'

/**
 * Tile 6 — what to record next.
 *
 * The header says how much of the book client price can see and what the
 * biggest few account decisions would do to that. Below it, every gap SOCC can
 * close with a field that already exists, ranked by the dollars it hides. Each
 * row is a rule run on the loaded rows (lib/finance/improve.ts): the count, the
 * dollars and the words are computed on every load, so a gap that has been
 * fixed leaves the list by itself with a one-line "resolved" note, and a gap
 * whose table did not load says "Blocked" — never "resolved".
 */

import Link from 'next/link'
import { BarChart, Legend, fmtMoney, fmtMoneyCompact, type LegendItem } from '@/components/charts'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import { money, pctText } from '@/lib/finance/format'
import { DOLLARS_KIND_LABEL, TOP_ACCOUNTS, type Gap, type ImproveModel, type PriceHeader } from '@/lib/finance/improve'
import type { FinanceTabProps } from '../tabs/types'
import { FinanceCard, Figure, Note } from '../tabs/Card'

const HELP =
  'Everything here can be fixed with a field SOCC already has. Each row says what is missing, on how many surveys, how many dollars it hides, who records it and when — and opens the exact surveys. ' +
  'Ranked by dollars hidden. "Recorded cost" is spend already logged that a figure cannot use; "Client price" is price the margin cannot count yet; an estimate is money not recorded at all, sized at a rate measured on the book and marked "about".'

const DOLLAR_TONE: Record<Gap['dollarsKind'], string> = {
  spend: 'text-[var(--chart-cost)]',
  price: 'text-[var(--chart-price)]',
  estimate: 'text-foreground',
  none: 'text-muted-foreground',
}

/** The bar colour for each kind of dollars. Navy is our recorded cost and teal
 *  the client price, the same two colours the rest of the hub uses for them;
 *  an estimate takes the grey the charts use for "not recorded". */
const KIND_COLOR: Record<Gap['dollarsKind'], string> = {
  spend: 'var(--chart-cost)',
  price: 'var(--chart-price)',
  estimate: 'var(--chart-muted)',
  none: 'var(--chart-muted)',
}

const KIND_HELP: Record<Gap['dollarsKind'], string> = {
  spend: 'Field cost already recorded on these surveys, which the figure named here cannot use.',
  price: 'Client price on these surveys that the margin cannot count yet.',
  estimate: 'Money that is not recorded at all, sized at a rate measured on the book. Never added to a recorded figure.',
  none: 'This gap hides no dollars; it ranks after the ones that do.',
}

type Props = Pick<FinanceTabProps, 'load' | 'scope' | 'openDrill' | 'hrefFor'>

export function GapsCard({ model, props }: { model: ImproveModel; props: Props }) {
  const open = model.gaps.filter(g => g.status === 'open')
  const blocked = model.gaps.filter(g => g.status === 'blocked')
  return (
    <FinanceCard
      id="gaps"
      title="What to record next"
      help={HELP}
      scope={props.scope.chip}
      ignored={props.scope.ignored}
      needs={['survey_projects']}
      blocked={props.load.blocked}
      verdict={model.verdict}
    >
      <HeaderFigures header={model.header} priceGap={model.gaps.find(g => g.key === 'price') ?? model.resolved.find(g => g.key === 'price')} props={props} />
      <GapChart gaps={open} props={props} />
      <ol className="divide-y divide-border border-t border-border">
        {open.map((g, i) => <GapItem key={g.key} gap={g} rank={i + 1} props={props} />)}
        {blocked.map(g => <GapItem key={g.key} gap={g} rank={null} props={props} />)}
      </ol>
      {model.resolved.length > 0 && <Resolved gaps={model.resolved} props={props} />}
    </FinanceCard>
  )
}

/**
 * The ranked list, drawn (David: the informative tables "would be interesting
 * to see plotted on a chart"). One bar per open gap that hides dollars, in the
 * list's own order, coloured by what the dollars ARE — recorded cost, client
 * price, or an estimate of money never recorded — because a bar that mixes the
 * three would invite someone to add them up. A gap with no dollar figure (an
 * empty contract term) is not drawn: it would be a bar of nothing. Clicking a
 * bar opens the same surveys as the row beneath it, and the full list stays
 * below the chart rather than hiding behind a toggle.
 */
function GapChart({ gaps, props }: { gaps: Gap[]; props: Props }) {
  const sized = gaps.filter(g => g.dollars != null && g.dollars > 0)
  if (!sized.length) return null
  const noDollars = gaps.length - sized.length
  const legend: LegendItem[] = [...new Set(sized.map(g => g.dollarsKind))].map(k => ({
    key: k, label: DOLLARS_KIND_LABEL[k], color: KIND_COLOR[k], description: KIND_HELP[k],
  }))
  return (
    <div className="border-b border-border px-4 py-3">
      <Legend items={legend} className="mb-2" />
      <BarChart<Gap>
        ariaLabel="Dollars each open gap hides, largest first"
        data={sized}
        label={g => g.title}
        labelHeader="Gap"
        value={g => g.dollars}
        valueName="Dollars hidden"
        valueFormat={fmtMoney}
        valueLabel={{
          name: 'Dollars hidden · surveys',
          description: 'An estimate is marked "about". The survey count is how many surveys the gap touches. The exact figure is on the row below.',
          // Rounded at the bar tip so sixteen labels leave room for sixteen
          // bars; the tooltip and the row beneath both carry it to the dollar.
          text: g => `${g.dollarsKind === 'estimate' ? 'about ' : ''}${fmtMoneyCompact(g.dollars)} · ${fmtNum(g.surveys)}`,
        }}
        color={g => KIND_COLOR[g.dollarsKind]}
        // The same two facts the row beneath prints under its dollars.
        note={g => `${DOLLARS_KIND_LABEL[g.dollarsKind]} · ${fmtNum(g.count)} ${g.count === 1 ? g.unit : `${g.unit}s`}`}
        onSelect={g => { if (g.drill && g.drill.rows.length) props.openDrill(g.drill) }}
        // The ranked list below IS the table, with more on every row than a
        // table twin could carry, so a second one would only repeat it.
        table={false}
      />
      {noDollars > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {fmtNum(noDollars)} open {noDollars === 1 ? 'gap hides' : 'gaps hide'} no dollars and {noDollars === 1 ? 'is' : 'are'} listed below only.
        </p>
      )}
    </div>
  )
}

function HeaderFigures({ header, priceGap, props }: { header: PriceHeader; priceGap?: Gap; props: Props }) {
  if (header.blocked) return <Note tone="neg">{header.sentence}</Note>
  const drill = priceGap?.drill ?? null
  return (
    <div className="border-b border-border">
      <div className="grid grid-cols-1 sm:grid-cols-3">
        <Figure
          label="Client price covers"
          help="Delivered surveys in view carrying a client price per N. A $0 price counts: it is a real price."
          value={`${fmtNum(header.priced)} of ${fmtNum(header.delivered)}`}
          sub="delivered surveys"
          tone="price"
          onOpen={drill ? () => props.openDrill(drill) : undefined}
          openLabel="Show the costed surveys with no price"
        />
        <Figure
          label="Share of spend priced"
          help="Recorded cost on priced delivered surveys, as a share of all recorded cost on delivered surveys in view."
          value={pctText(header.spendPct)}
          sub={`${money(header.pricedSpend)} of ${money(header.spend)}`}
        />
        <Figure
          label={`If the top ${fmtNum(Math.min(TOP_ACCOUNTS, header.top.length) || TOP_ACCOUNTS)} were priced`}
          help={`The share of spend priced if the ${fmtNum(TOP_ACCOUNTS)} accounts with the most unpriced cost were priced. They are listed in the first row below when price is still a gap.`}
          value={header.top.length ? pctText(header.ifTopPriced) : '—'}
          sub={header.top.length ? header.top.map(a => a.name).join(', ') : 'nothing left to price'}
        />
      </div>
      <p className="px-4 pb-3 text-[13px] leading-relaxed">{header.sentence}</p>
    </div>
  )
}

function GapItem({ gap: g, rank, props }: { gap: Gap; rank: number | null; props: Props }) {
  if (g.status === 'blocked') {
    return (
      <li className="flex gap-3 px-4 py-3">
        <span className="w-6 shrink-0 text-right text-xs text-muted-foreground" title="Could not be checked">—</span>
        <div className="min-w-0">
          <div className="flex items-center text-sm font-medium">{g.title}<InfoTooltip text={g.help} /></div>
          <p role="alert" className="text-[13px] text-red-700 dark:text-red-400">{g.note}</p>
        </div>
      </li>
    )
  }
  const hasDollars = g.dollars != null && g.dollars > 0
  const more = g.drill && g.drill.rows.length > 0
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="w-6 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-muted-foreground" title="Rank by dollars hidden">
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <h3 className="flex items-center text-sm font-semibold">
            {g.title}
            <InfoTooltip text={g.help} />
          </h3>
          <div className="text-right">
            <div className={`text-base font-semibold tabular-nums ${DOLLAR_TONE[g.dollarsKind]}`}>
              {hasDollars ? `${g.dollarsKind === 'estimate' ? 'about ' : ''}${money(g.dollars as number)}` : '—'}
            </div>
            <div className="text-[11px] text-muted-foreground" title={KIND_HELP[g.dollarsKind]}>
              {DOLLARS_KIND_LABEL[g.dollarsKind]} · {fmtNum(g.count)} {g.count === 1 ? g.unit : `${g.unit}s`}
            </div>
          </div>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed">{g.what}</p>
        {g.details.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {g.details.map(d => <li key={d}>{d}</li>)}
          </ul>
        )}
        {g.accounts.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="By account">
            {g.accounts.map(a => (
              <li key={`${a.id}-${a.note}`} className="rounded-md border border-border px-2 py-1 text-xs">
                {a.href ? (
                  <Link href={a.href} className="font-medium text-primary underline-offset-2 hover:underline">{a.name}</Link>
                ) : a.id ? (
                  <Link href={props.hrefFor({ account: a.id })} className="font-medium text-primary underline-offset-2 hover:underline" title={`Filter the page to ${a.name}`}>
                    {a.name}
                  </Link>
                ) : <span className="font-medium">{a.name}</span>}
                {a.dollars != null && <span className="tabular-nums"> · {money(a.dollars)}</span>}
                {g.unit === 'survey' && <span className="text-muted-foreground"> · {fmtNum(a.count)} survey{a.count === 1 ? '' : 's'}</span>}
                {a.note && <span className="block text-muted-foreground">{a.note}</span>}
              </li>
            ))}
          </ul>
        )}
        <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground" title="The person who records the missing field.">Who</dt>
          <dd>{g.who}</dd>
          <dt className="text-muted-foreground" title="The moment in the survey’s life when it is recorded.">When</dt>
          <dd>{g.when}</dd>
          <dt className="text-muted-foreground" title="Where the field is entered.">Where</dt>
          <dd>{g.where}</dd>
        </dl>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {more && (
            <button
              type="button"
              onClick={() => props.openDrill(g.drill!)}
              className="rounded-md border border-border px-2 py-1 font-medium text-primary hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--chart-price)]"
            >
              Show the {fmtNum(g.drill!.rows.length)} survey{g.drill!.rows.length === 1 ? '' : 's'}
            </button>
          )}
          {g.link && (
            <Link href={g.link.href} className="font-medium text-primary underline-offset-2 hover:underline">{g.link.label}</Link>
          )}
        </div>
      </div>
    </li>
  )
}

function Resolved({ gaps, props }: { gaps: Gap[]; props: Props }) {
  return (
    <div className="border-t border-border bg-muted/20 px-4 py-3">
      <h3 className="flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Resolved in this view
        <InfoTooltip text="Gaps the data shows as closed under the current filters. Each comes back on its own the day a survey falls into it again." />
      </h3>
      <ul className="mt-1.5 space-y-1 text-xs">
        {gaps.map(g => (
          <li key={g.key} className="flex flex-wrap items-baseline gap-x-2">
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">Resolved</span>
            {/* The same (i) the open rows carry: a resolved row still has to
                say what the check was, or "resolved" means nothing. */}
            <span className="inline-flex items-center font-medium">{g.title}<InfoTooltip text={g.help} /></span>
            <span className="text-muted-foreground">{g.note}</span>
            {g.drill && g.drill.rows.length > 0 && (
              <button type="button" onClick={() => props.openDrill(g.drill!)} className="font-medium text-primary underline-offset-2 hover:underline">
                Show the {fmtNum(g.drill.rows.length)}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
