'use client'

/**
 * Results › Where it was made and lost › Panel supplier.
 *
 * Which PureSpectrum panels our money went to, what each charged per complete,
 * and how much we paid a dearer panel while a cheaper one was delivering in the
 * same wave. Every figure comes from lib/finance/panels.ts buildPanelsModel;
 * this file only draws it.
 *
 * ── WHY THE DRILLDOWN IS IN PLACE, NOT IN THE DRILL PANEL ───────────────────
 * The drill panel is a list of surveys with a reconcile strip. A panel's story
 * is a price moving over months, which needs a chart, and a chart in a modal
 * sheet at 390px is unreadable. So picking a panel writes ?supplier=<id> into
 * the URL (a real link: it can be middle-clicked, shared and refreshed) and the
 * detail opens below the table.
 *
 * ── WHY IT DOES NOT REGISTER AN EXPORT ──────────────────────────────────────
 * The Results tab owns "Export what you see" (the margin-set surveys behind
 * Tile 1). Registering here would replace that, and clearing on unmount would
 * wipe it. The chart's "View as table" twin carries these rows instead.
 */

import Link from 'next/link'
import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BarChart } from '@/components/charts'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Empty, FinanceCard, Note } from '../tabs/Card'
import { isBlocked } from '@/lib/finance/load'
import type { FinanceTabProps, Needs } from '../tabs/types'
import {
  buildPanelsModel, cpiText, supplierHref, vsAllText,
  CARD_ANCHOR, CHART_BARS, SUPPLIER_PARAM,
  type PanelRow, type PanelsModel,
} from '@/lib/finance/panels'
import { money, pctText } from '@/lib/finance/format'
import { fmtNum } from '@/lib/utils/number'
import { SUPPLIER_COLUMNS as C, type ColumnWords } from './columns'
import { SupplierDetail } from './SupplierDetail'

/** The table and phone list share one anchor, so "Other panels" can jump to
 *  whichever of the two is showing. */
export const TABLE_ANCHOR = 'panel-suppliers-table'

/**
 * The tables this card's figures depend on — and why the route filter changes
 * the list.
 *
 * The panel money itself comes from `project_suppliers`. But WHICH surveys are
 * in view is decided by each survey's measured route, and a route is read from
 * its blast rows as well as its panel rows (hub.ts routeOf). With
 * `project_blasts` unread, a survey fielded both ways looks panel-only: "Panel"
 * would quietly take in surveys that do not belong and overstate, and "Both"
 * would show nothing at all and read as "no panel purchases" rather than as a
 * failed read. So when a route is picked, the blast table is a dependency and
 * its failure has to block the card (rule 6).
 */
export const needsFor = (route: FinanceTabProps['filter']['route']): Needs =>
  route === 'all'
    ? ['survey_projects', 'project_suppliers']
    : ['survey_projects', 'project_suppliers', 'project_blasts']

export function PanelSupplierView(props: FinanceTabProps) {
  const pathname = usePathname() ?? '/finance'
  const params = useSearchParams()
  const router = useRouter()
  const search = params?.toString() ?? ''
  const picked = params?.get(SUPPLIER_PARAM) ?? null
  const { raw } = props.load

  const model = useMemo(
    () => buildPanelsModel({
      population: props.population,
      suppliers: raw.suppliers,
      launches: raw.launches,
      blasts: raw.blasts,
      costs: raw.costs,
      ix: props.ix,
      selected: picked,
      // Without the blast rows the model cannot tell which surveys bought from
      // panels alone, so its outside check stands down instead of flagging
      // surveys whose recorded spend includes blast money it cannot see.
      blastsLoaded: !isBlocked(props.load.blocked, 'project_blasts'),
      // For the one cross-tab figure: Per respondent runs the same wave rule on
      // delivered AND live work, so the model computes that population too and
      // the card names both numbers.
      items: props.items,
      filter: props.filter,
      today: props.today,
    }),
    [props.population, raw, props.ix, picked, props.load.blocked, props.items, props.filter, props.today],
  )
  const hrefOf = (id: string | null) => supplierHref(pathname, search, id)

  return (
    <div className="grid min-w-0 gap-4">
      <FinanceCard
        id={CARD_ANCHOR}
        title="Where it was made and lost · by panel supplier"
        help="Who our PureSpectrum money went to, and what each panel charged per complete, on the panel purchases of the surveys in view. The Spend column adds back to the Panel (PureSpectrum) line of the spend breakdown. Pick a panel to see its waves."
        scope={props.scope.chip}
        ignored={props.scope.ignored}
        needs={needsFor(props.filter.route)}
        blocked={props.load.blocked}
        verdict={model.verdict}
      >
        <CheckStrip ok={model.check.ok} verified={model.check.verified} text={model.check.text} />
        {model.rows.length === 0 ? (
          <Empty>No panel purchases on the surveys in this view.</Empty>
        ) : (
          <>
            <Summary model={model} />
            <div className="px-4 pt-3">
              <BarChart
                ariaLabel="Panel spend by supplier"
                title="Spend by panel"
                info={
                  model.rows.length > CHART_BARS + 1
                    ? `What we paid each panel in this view: the ${fmtNum(CHART_BARS)} with the most spend, then the other ${fmtNum(model.rows.length - CHART_BARS)} as one bar (listed in the table below). Click a bar to see that panel's waves.`
                    : "What we paid each panel in this view, most first. Click a bar to see that panel's waves."
                }
                data={model.chart}
                label={d => d.name}
                labelHeader="Panel"
                value={d => d.spend}
                valueName="Spend"
                valueFormat={money}
                valueLabel={{
                  name: 'Spend · share',
                  text: d => `${money(d.spend)} · ${pctText(d.share)}`,
                  description: 'What we paid the panel, and its share of all panel spend in view',
                }}
                color="var(--chart-cost)"
                href={d => (d.id ? hrefOf(d.id) : `${pathname}${search ? `?${search}` : ''}#${TABLE_ANCHOR}`)}
                onSelect={d => {
                  if (d.id) router.push(hrefOf(d.id))
                  else document.getElementById(TABLE_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              />
            </div>
            <div id={TABLE_ANCHOR} className="scroll-mt-4">
              <SupplierTable model={model} picked={picked} hrefOf={hrefOf} />
              <SupplierList model={model} picked={picked} hrefOf={hrefOf} />
            </div>
          </>
        )}
        {/* The one figure this card and Per respondent can disagree on: same
            rule, different surveys. Named here so nobody has to guess. */}
        {model.leverNote && <Note>{model.leverNote}</Note>}
        <Note>
          {model.note}{' '}
          <Link href={`${props.hrefFor({ tab: 'improve' })}#blocked-data`} className="font-medium text-primary underline-offset-2 hover:underline">
            See what would unlock per-panel cost per qualified respondent
          </Link>{' '}
          on the Improve tab.
        </Note>
        {model.floorNote && <Note tone="neg">{model.floorNote}</Note>}
        {model.idle.length > 0 && (
          <Note>
            {fmtNum(model.idle.length)} more panel{model.idle.length === 1 ? ' was' : 's were'} set up on waves here but delivered no completes, so {model.idle.length === 1 ? 'it is' : 'they are'} not listed
            {' '}({model.idle.slice(0, 5).map(p => p.name).join(', ')}{model.idle.length > 5 ? `, and ${fmtNum(model.idle.length - 5)} more` : ''}).
          </Note>
        )}
      </FinanceCard>

      {picked && <SupplierDetail {...props} model={model} closeHref={hrefOf(null)} hrefOf={hrefOf} />}
    </div>
  )
}

/**
 * The reconcile strip.
 *
 * Green when everything that could be checked agreed, red — with the gap and
 * the surveys — when it did not. The tick is reserved for `verified`: the
 * outside check against the database's own recorded spend actually ran. Green
 * without a tick means the figures hang together but nothing outside this page
 * confirmed them, which is a different thing and should not look the same.
 */
export function CheckStrip({ ok, verified, text }: { ok: boolean; verified: boolean; text: string }) {
  return (
    <div
      role={ok ? undefined : 'alert'}
      className={
        'border-b px-4 py-2 text-[13px] tabular-nums ' +
        (ok
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          : 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400')
      }
    >
      {text}
      {ok && verified && <span title="Checked against the spend the database recorded, which nothing on this page computes"> ✓</span>}
    </div>
  )
}

function Summary({ model }: { model: PanelsModel }) {
  const t = model.total
  return (
    <p className="px-4 pt-3 text-[13px] leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">{money(t.spend)}</span> on panels ·{' '}
      {fmtNum(t.completes)} completes bought at <span className="font-medium text-foreground">{cpiText(t.cpc)}</span> each ·{' '}
      {fmtNum(model.rows.length)} panel{model.rows.length === 1 ? '' : 's'} · {fmtNum(t.waves)} wave{t.waves === 1 ? '' : 's'} ·
      panel purchases on {fmtNum(t.surveys)} of the {fmtNum(t.surveysInView)} surveys in view
    </p>
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

/** A panel name that is a real link to its drilldown. */
function PanelLink({ row, picked, hrefOf }: { row: PanelRow; picked: string | null; hrefOf: (id: string | null) => string }) {
  const on = picked === row.id
  return (
    <Link
      href={hrefOf(row.id)}
      aria-current={on ? 'true' : undefined}
      title={row.named ? `See ${row.name}'s waves` : `No name on file for this panel (id ${row.id}). See its waves.`}
      className={'font-medium underline-offset-2 hover:underline ' + (on ? 'text-foreground' : 'text-primary') + (row.named ? '' : ' italic')}
    >
      {row.name}
    </Link>
  )
}

function SupplierTable({ model, picked, hrefOf }: { model: PanelsModel; picked: string | null; hrefOf: (id: string | null) => string }) {
  const t = model.total
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="mt-3 w-full border-t border-border text-sm tabular-nums">
        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-border">
            <Head words={C.panel} right={false} />
            <Head words={C.spend} />
            <Head words={C.share} />
            <Head words={C.completes} />
            <Head words={C.cpc} />
            <Head words={C.vsAll} />
            <Head words={C.surveys} />
            <Head words={C.waves} />
            <Head words={C.above} />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {model.rows.map(r => (
            <tr key={r.id} className={picked === r.id ? 'bg-primary/5' : undefined}>
              <th scope="row" className="px-2 py-1.5 text-left font-normal"><PanelLink row={r} picked={picked} hrefOf={hrefOf} /></th>
              <td className="px-2 py-1.5 text-right">
                {money(r.spend)}
                {r.unpricedCompletes > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground" title={`${fmtNum(r.unpricedCompletes)} of its completes have no price recorded, so this is a floor.`}>+?</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right">{pctText(r.share)}</td>
              <td className="px-2 py-1.5 text-right">{fmtNum(r.completes)}</td>
              <td className="px-2 py-1.5 text-right">{cpiText(r.cpc)}</td>
              <td className="px-2 py-1.5 text-right">{vsAllText(r.vsAll)}</td>
              <td className="px-2 py-1.5 text-right">{fmtNum(r.surveys)}</td>
              <td className="px-2 py-1.5 text-right">{fmtNum(r.waves)}</td>
              <td className="px-2 py-1.5 text-right" title={r.above > 0 ? `On ${fmtNum(r.aboveWaves)} of its ${fmtNum(r.waves)} waves` : undefined}>
                {money(r.above)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/30 font-medium">
            <th scope="row" className="px-2 py-1.5 text-left">All panels</th>
            <td className="px-2 py-1.5 text-right">{money(t.spend)}</td>
            <td className="px-2 py-1.5 text-right">{t.spend !== 0 ? '100%' : '—'}</td>
            <td className="px-2 py-1.5 text-right">{fmtNum(t.completes)}</td>
            <td className="px-2 py-1.5 text-right">{cpiText(t.cpc)}</td>
            <td className="px-2 py-1.5 text-right">—</td>
            <td className="px-2 py-1.5 text-right">{fmtNum(t.surveys)}</td>
            <td className="px-2 py-1.5 text-right">{fmtNum(t.waves)}</td>
            <td className="px-2 py-1.5 text-right">{money(t.above)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** The same rows as stacked cards below 768px: nine columns do not fit a
 *  phone, and a sideways-scrolling table hides the figure you came for. */
function SupplierList({ model, picked, hrefOf }: { model: PanelsModel; picked: string | null; hrefOf: (id: string | null) => string }) {
  const t = model.total
  const dt = 'text-muted-foreground'
  return (
    <div className="mt-3 border-t border-border md:hidden">
      <details className="px-4 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">What these figures mean</summary>
        <dl className="mt-2 space-y-1.5">
          {Object.values(C).map(w => (
            <div key={w.label}><dt className="inline font-medium text-foreground">{w.label}: </dt><dd className="inline">{w.help}</dd></div>
          ))}
        </dl>
      </details>
      <ul className="divide-y divide-border/60 border-t border-border/60">
        {model.rows.map(r => (
          <li key={r.id} className={'px-4 py-2.5 ' + (picked === r.id ? 'bg-primary/5' : '')}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words"><PanelLink row={r} picked={picked} hrefOf={hrefOf} /></span>
              <span className="shrink-0 font-medium tabular-nums">
                {money(r.spend)}{r.unpricedCompletes > 0 && <span className="text-xs text-muted-foreground" title="Some completes have no price recorded, so this is a floor"> +?</span>}
              </span>
            </div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs tabular-nums">
              <dt className={dt} title={C.share.help}>{C.share.label}</dt><dd>{pctText(r.share)}</dd>
              <dt className={dt} title={C.completes.help}>{C.completes.label}</dt><dd>{fmtNum(r.completes)}</dd>
              <dt className={dt} title={C.cpc.help}>{C.cpc.label}</dt>
              <dd>
                {cpiText(r.cpc)}
                {r.vsAll != null && <> ({vsAllText(r.vsAll)} {C.vsAll.label})</>}
              </dd>
              <dt className={dt} title={C.surveys.help}>Surveys · waves</dt><dd>{fmtNum(r.surveys)} · {fmtNum(r.waves)}</dd>
              <dt className={dt} title={C.above.help}>Above cheapest in wave</dt><dd>{money(r.above)}</dd>
            </dl>
          </li>
        ))}
        <li className="bg-muted/30 px-4 py-2.5 text-xs">
          <span className="font-medium">All panels:</span> {money(t.spend)} · {fmtNum(t.completes)} completes at {cpiText(t.cpc)} ·{' '}
          {money(t.above)} above the cheapest in the same wave
        </li>
      </ul>
    </div>
  )
}
