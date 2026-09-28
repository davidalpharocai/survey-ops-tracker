'use client'

/**
 * The PureSpectrum drilldown for one panel: how its price moved month by
 * month next to the other big panels, then every wave it delivered on — with
 * the cheapest price in that same wave, so "we paid it more than we had to"
 * is a row you can open, not an average.
 *
 * Each wave links on to its survey's project page, where the Suppliers panel
 * shows the same wave with the same arithmetic (SuppliersWidget). The project
 * page has no anchor on that panel, so the link opens the page.
 */

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Heatmap } from '@/components/charts'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Empty, FinanceCard, ProjectLink } from '../tabs/Card'
import type { FinanceTabProps, Needs } from '../tabs/types'
import {
  cpiText, launchDateText, vsAllText,
  DETAIL_ANCHOR, DRIFT_NOTE,
  type PanelsModel, type WaveRow,
} from '@/lib/finance/panels'
import { money, money2 } from '@/lib/finance/format'
import { fmtNum } from '@/lib/utils/number'
import { WAVE_COLUMNS as W, type ColumnWords } from './columns'

/** The same route-dependent rule as the table above (see needsFor there): with
 *  a route picked, which surveys are in view depends on the blast rows too. */
const needsFor = (route: FinanceTabProps['filter']['route']): Needs =>
  route === 'all'
    ? ['survey_projects', 'project_suppliers', 'project_launches']
    : ['survey_projects', 'project_suppliers', 'project_launches', 'project_blasts']
/** Purchases shown before "Show all" — a big panel has hundreds. */
const FIRST_WAVES = 25

export function SupplierDetail(props: FinanceTabProps & {
  model: PanelsModel
  closeHref: string
  hrefOf: (id: string | null) => string
}) {
  const { model, closeHref, hrefOf } = props
  const router = useRouter()
  const d = model.selected
  const close = (
    <Link href={closeHref} className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground">
      Close
    </Link>
  )

  if (!d) {
    const name = model.selectedName ?? 'That panel'
    return (
      <FinanceCard
        id={DETAIL_ANCHOR}
        title={`${name}: its waves`}
        help="One panel's waves in this view, with the cheapest price in each wave."
        scope={props.scope.chip}
        ignored={props.scope.ignored}
        needs={needsFor(props.filter.route)}
        blocked={props.load.blocked}
        actions={close}
      >
        <Empty>
          {name} delivered no completes on the surveys in this view. Change the filters, or pick another panel from the table above.
        </Empty>
      </FinanceCard>
    )
  }

  const r = d.row
  return (
    <FinanceCard
      id={DETAIL_ANCHOR}
      title={`${r.name}: its waves`}
      help="Every wave this panel delivered completes on in this view, with what it charged and the cheapest price any panel charged in the same wave. The chart shows how its price moved month by month next to the panels with the most spend."
      scope={props.scope.chip}
      ignored={props.scope.ignored}
      needs={needsFor(props.filter.route)}
      blocked={props.load.blocked}
      verdict={d.verdict}
      actions={close}
    >
      <div className="px-4 pt-3">
        <Heatmap
          ariaLabel="Price per complete by panel and launch month"
          title="Price by launch month"
          info={`${DRIFT_NOTE} Colour is the price per complete (the stronger the colour, the dearer); the line under each cell is how many completes stand behind that price. The panel you picked is on the top row, then the panels with the most spend. Click a row's cell to switch to that panel.`}
          rows={model.heatmap.rows}
          columns={model.heatmap.columns}
          cells={model.heatmap.cells}
          rowHeader="Panel"
          valueName="Price per complete"
          valueFormat={money2}
          weightName="Completes"
          weightFormat={fmtNum}
          color="var(--chart-cost)"
          note={c => (c.countries.length
            ? `Country as recorded: ${c.countries.slice(0, 3).join(', ')}${c.countries.length > 3 ? ` and ${fmtNum(c.countries.length - 3)} more` : ''}`
            : null)}
          href={c => hrefOf(c.row)}
          onSelect={c => router.push(hrefOf(c.row))}
        />
      </div>
      {/* The spec's caution, printed as well as in the (i): a touch screen has
          no hover, and this is the sentence that stops a misread. */}
      <p className="px-4 pt-1 text-xs text-muted-foreground">{DRIFT_NOTE}</p>
      <p className="px-4 pt-3 text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{money(r.spend)}</span> for {fmtNum(r.completes)} completes at{' '}
        <span className="font-medium text-foreground">{cpiText(r.cpc)}</span> each{vsPhrase(r.vsAll)} ·{' '}
        {fmtNum(r.surveys)} survey{r.surveys === 1 ? '' : 's'} · {fmtNum(r.waves)} wave{r.waves === 1 ? '' : 's'} ·{' '}
        <span className="font-medium text-foreground">{money(r.above)}</span> above the cheapest panel in the same wave
        {r.idleWaves > 0 && <> · set up on {fmtNum(r.idleWaves)} more wave{r.idleWaves === 1 ? '' : 's'} where it delivered nothing</>}
      </p>

      <WaveTable waves={d.waves} waveCount={r.waves} totals={d.totals} />
      <WaveList waves={d.waves} waveCount={r.waves} totals={d.totals} />
    </FinanceCard>
  )
}

function Head({ words, right = true }: { words: ColumnWords; right?: boolean }) {
  return (
    <th scope="col" className={'px-2 py-2 align-bottom font-medium ' + (right ? 'text-right' : 'text-left')}>
      <span className={'inline-flex items-center ' + (right ? 'justify-end' : '')}>
        {words.label}
        <InfoTooltip text={words.help} />
      </span>
    </th>
  )
}

/** "Cost above the cheapest", in words where a number would mislead: a $0 for
 *  a wave nobody else bought in would read as "priced the same". */
function aboveText(w: WaveRow): string {
  if (w.basis === 'only-panel') return 'only panel'
  // A CPI recorded as $0 is a price, just not one the lever compares.
  if (w.basis === 'no-price') return w.cpi === 0 ? 'priced at $0' : 'no price'
  return money(w.above)
}
/** " (+27% against all panels)", " (about the same as all panels)", or nothing. */
function vsPhrase(x: number | null): string {
  const t = vsAllText(x)
  if (t === '—') return ''
  return t === 'same' ? ' (about the same as all panels)' : ` (${t} against all panels)`
}
const countryText = (w: WaveRow) => w.country ?? 'not recorded'

/**
 * Show the first rows, with a real count of what is hidden.
 *
 * One row is one PURCHASE, not one wave: a panel can buy twice in the same wave
 * (0 of 3,027 rows do today, but the data allows it), and a footer that says
 * "All 2 waves" beside a summary that says "1 wave" is the kind of small
 * contradiction that costs a reader their trust in the whole card. So the rows
 * are counted as purchases, and `wavesLabel` below prints both when they differ.
 */
function useFirst(waves: WaveRow[]) {
  const [all, setAll] = useState(false)
  const shown = all ? waves : waves.slice(0, FIRST_WAVES)
  const more = waves.length > FIRST_WAVES && (
    <p className="px-4 py-2 text-xs text-muted-foreground">
      Showing {fmtNum(shown.length)} of {fmtNum(waves.length)} purchases, largest cost above the cheapest first ·{' '}
      <button type="button" onClick={() => setAll(v => !v)} className="font-medium text-primary underline-offset-2 hover:underline">
        {all ? 'Show fewer' : 'Show all'}
      </button>
    </p>
  )
  return { shown, more }
}

/** "All 105 waves", or "All 104 waves (105 purchases)" when a panel bought
 *  twice in one of them. */
function wavesLabel(waveCount: number, purchases: number): string {
  const waves = `All ${fmtNum(waveCount)} wave${waveCount === 1 ? '' : 's'}`
  return purchases === waveCount ? waves : `${waves} (${fmtNum(purchases)} purchases)`
}

function WaveTable({ waves, waveCount, totals }: { waves: WaveRow[]; waveCount: number; totals: { completes: number; cost: number; above: number } }) {
  const { shown, more } = useFirst(waves)
  return (
    <div className="hidden md:block">
      <div className="overflow-x-auto">
        <table className="mt-3 w-full border-t border-border text-sm tabular-nums">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <Head words={W.survey} right={false} />
              <Head words={W.label} right={false} />
              <Head words={W.date} right={false} />
              <Head words={W.country} right={false} />
              <Head words={W.cpi} />
              <Head words={W.cheapest} />
              <Head words={W.completes} />
              <Head words={W.cost} />
              <Head words={W.above} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {shown.map(w => (
              <tr key={w.key}>
                <th scope="row" className="px-2 py-1.5 text-left font-normal"><ProjectLink id={w.projectId} code={w.code} /></th>
                <td className="px-2 py-1.5">{w.label ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{launchDateText(w.launchDate)}</td>
                <td className={'px-2 py-1.5 ' + (w.country ? '' : 'text-muted-foreground')} title={w.note ?? 'This launch has no note.'}>
                  {countryText(w)}
                </td>
                <td className="px-2 py-1.5 text-right">{cpiText(w.cpi)}</td>
                <td className="px-2 py-1.5 text-right">{cpiText(w.cheapest)}</td>
                <td className="px-2 py-1.5 text-right">{fmtNum(w.completes)}</td>
                <td className="px-2 py-1.5 text-right">{money(w.cost)}</td>
                <td className={'px-2 py-1.5 text-right ' + (w.above > 0 ? 'font-medium' : 'text-muted-foreground')}>{aboveText(w)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/30 font-medium">
              <th scope="row" colSpan={6} className="px-2 py-1.5 text-left">{wavesLabel(waveCount, waves.length)}</th>
              <td className="px-2 py-1.5 text-right">{fmtNum(totals.completes)}</td>
              <td className="px-2 py-1.5 text-right">{money(totals.cost)}</td>
              <td className="px-2 py-1.5 text-right">{money(totals.above)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {more}
    </div>
  )
}

/** The same purchases as stacked cards below 768px. */
function WaveList({ waves, waveCount, totals }: { waves: WaveRow[]; waveCount: number; totals: { completes: number; cost: number; above: number } }) {
  const { shown, more } = useFirst(waves)
  const dt = 'text-muted-foreground'
  return (
    <div className="mt-3 border-t border-border md:hidden">
      <details className="px-4 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">What these figures mean</summary>
        <dl className="mt-2 space-y-1.5">
          {Object.values(W).map(w => (
            <div key={w.label}><dt className="inline font-medium text-foreground">{w.label}: </dt><dd className="inline">{w.help}</dd></div>
          ))}
        </dl>
      </details>
      <ul className="divide-y divide-border/60 border-t border-border/60">
        {shown.map(w => (
          <li key={w.key} className="px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <ProjectLink id={w.projectId} code={w.code} />
              <span className="shrink-0 text-xs text-muted-foreground">{w.label ? `${W.label.label} ${w.label}` : 'no PS Survey#'}</span>
            </div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs tabular-nums">
              <dt className={dt} title={W.date.help}>{W.date.label}</dt><dd>{launchDateText(w.launchDate)}</dd>
              <dt className={dt} title={W.country.help}>Country</dt>
              <dd className={w.country ? '' : 'text-muted-foreground'}>{countryText(w)}</dd>
              <dt className={dt} title={W.cpi.help}>Price per complete · cheapest</dt><dd>{cpiText(w.cpi)} · {cpiText(w.cheapest)}</dd>
              <dt className={dt} title={W.completes.help}>Completes · cost</dt><dd>{fmtNum(w.completes)} · {money(w.cost)}</dd>
              <dt className={dt} title={W.above.help}>{W.above.label}</dt>
              <dd className={w.above > 0 ? 'font-medium' : 'text-muted-foreground'}>{aboveText(w)}</dd>
            </dl>
          </li>
        ))}
        <li className="bg-muted/30 px-4 py-2.5 text-xs">
          <span className="font-medium">{wavesLabel(waveCount, waves.length)}:</span> {fmtNum(totals.completes)} completes · {money(totals.cost)} ·{' '}
          {money(totals.above)} above the cheapest
        </li>
      </ul>
      {more}
    </div>
  )
}
