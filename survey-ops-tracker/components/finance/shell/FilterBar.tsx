'use client'

import { useId } from 'react'
import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { monthLabel } from '@/lib/finance/coverage'
import {
  DEFAULT_FILTER, formatRange, isFiltered, RANGE_PRESETS, RELIABLE_FROM, resolveRange, ROUTE_OPTIONS,
  TAB_LABEL, TAB_RULES, withPreset,
  type AccountChoice, type FinanceFilter, type FinanceTab, type RangePreset, type RouteChoice, type RouteFilter,
} from '@/lib/finance/filters'
import { fmtNum } from '@/lib/utils/number'
import { DEFAULT_RANGE_WORDS as DEFAULT_WORDS, withoutDimension, type HrefPatch } from './url'

/**
 * The sticky filter bar: date, account, route, their chips, Clear, and the
 * page's one export button.
 *
 * Every control writes the URL and nothing else — the page reads its state
 * back from the address, so a view can be bookmarked, shared or refreshed and
 * come back exactly. The chips and Clear are real links for the same reason.
 *
 * Sticky under the top nav, whose height it reads from `--topnav-h` (set by
 * components/shared/TopNav.tsx), because the nav wraps to two lines on a
 * narrow screen and a fixed offset would slide the bar under it.
 */

const DATE_HELP = (undated: number) =>
  'Filters by delivery date (launch date, then submitted date, if there is none). ' +
  `Studies with no date drop out once you pick a range — ${fmtNum(undated)} today.`
const ACCOUNT_HELP = 'One client account, old name variants rolled together. The count beside each name is its studies under the other filters; an account with none is greyed.'
const ROUTE_HELP = 'How it was actually fielded, read from its cost records — not what it was filed as.'

const control =
  'h-8 rounded-md border border-border bg-card px-2 text-[13px] text-foreground ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--chart-price)] ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

function Field({ id, label, help, children }: { id: string; label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <label htmlFor={id}>{label}</label>
        <InfoTooltip text={help} />
      </span>
      {children}
    </div>
  )
}

function Chip({ text, href, remove }: { text: string; href: string; remove: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2.5 pr-1 text-[12px] text-foreground">
      {text}
      <Link
        href={href}
        replace
        scroll={false}
        aria-label={remove}
        title={remove}
        className="rounded-full px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        ✕
      </Link>
    </span>
  )
}

export function FilterBar({
  tab, filter, today, accounts, routes, undated, costReliableFrom, hrefFor, navigate, exportSlot,
}: {
  tab: FinanceTab
  filter: FinanceFilter
  today: string
  /** optionCounts(...).accounts — counts under the other filters, empty ones greyed. */
  accounts: AccountChoice[]
  routes: RouteChoice[]
  /** Delivered surveys with no date that a range would drop, for the date help. */
  undated: number
  /** The computed month costs are reliable from ('YYYY-MM-01'), so the default
   *  preset is only called "most reliable" while that is true. */
  costReliableFrom: string | null
  hrefFor: (patch: HrefPatch) => string
  /** router.replace — a filter change replaces the view rather than stacking history. */
  navigate: (href: string) => void
  exportSlot: React.ReactNode
}) {
  const rule = TAB_RULES[tab]
  const ids = { date: useId(), account: useId(), route: useId(), from: useId(), to: useId() }
  const preset = filter.range.preset
  const presetHelp = RANGE_PRESETS.find(p => p.id === preset)?.help ?? ''
  const resolved = resolveRange(filter.range, today)
  const badRange = preset === 'custom' && !!filter.range.from && !!filter.range.to && filter.range.from > filter.range.to
  const accountName = accounts.find(a => a.id === filter.account)?.name ?? 'One account'
  const routeLabel = ROUTE_OPTIONS.find(o => o.id === filter.route)?.label ?? filter.route
  const defaultIsBest = costReliableFrom === RELIABLE_FROM
  // The default preset is the one that used to carry a TYPED reliability claim
  // ("from June, costs are recorded on most delivered surveys"). David's
  // decision 8: that line is computed, so his price and cost backfill moves it
  // by itself. It comes from the same `reliabilityDates` month the banner
  // prints three lines below, so the (i) and the banner can never contradict
  // each other on the same screen. The other five presets keep their own help.
  const reliabilityHelp = costReliableFrom
    ? `Costs are recorded on most delivered studies from ${monthLabel(costReliableFrom.slice(0, 7))}.`
    : 'No month yet has a recorded cost on most of its delivered studies.'
  const dateHelp = preset === DEFAULT_FILTER.range.preset
    ? `${DATE_HELP(undated)} ${reliabilityHelp} ${presetHelp}`
    : `${DATE_HELP(undated)} ${presetHelp}`

  const setRange = (p: RangePreset) => navigate(hrefFor({ range: withPreset(filter, p, today).range }))
  const setCustom = (which: 'from' | 'to', v: string) =>
    navigate(hrefFor({ range: { preset: 'custom', from: filter.range.from, to: filter.range.to, [which]: v || null } }))

  return (
    <div
      className="sticky z-30 rounded-lg border border-border bg-background/95 px-3 py-2 backdrop-blur-sm sm:px-4"
      style={{ top: 'var(--topnav-h, 0px)' }}
    >
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <Field id={ids.date} label="Date" help={rule.date ? dateHelp : `${TAB_LABEL[tab]} shows live work whatever its dates, because an overspending study matters whenever it launched. The date filter still applies on the other tabs.`}>
          {rule.date ? (
            <select id={ids.date} className={control} value={preset} onChange={e => setRange(e.target.value as RangePreset)}>
              {RANGE_PRESETS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label}{p.id === DEFAULT_FILTER.range.preset ? (defaultIsBest ? ' (most reliable)' : ' (default)') : ''}
                </option>
              ))}
            </select>
          ) : (
            <select id={ids.date} className={control} value="live" disabled aria-describedby={`${ids.date}-why`}>
              <option value="live">{rule.ignoredNote ?? 'All dates'}</option>
            </select>
          )}
        </Field>
        {rule.date && preset === 'custom' && (
          <>
            <Field id={ids.from} label="From" help="The first delivery date to include.">
              <input id={ids.from} type="date" className={control} value={filter.range.from ?? ''} max={filter.range.to ?? undefined}
                onChange={e => setCustom('from', e.target.value)} />
            </Field>
            <Field id={ids.to} label="To" help="The last delivery date to include.">
              <input id={ids.to} type="date" className={control} value={filter.range.to ?? ''} min={filter.range.from ?? undefined}
                onChange={e => setCustom('to', e.target.value)} />
            </Field>
          </>
        )}
        <Field id={ids.account} label="Account" help={ACCOUNT_HELP}>
          <select id={ids.account} className={`${control} max-w-[16rem]`} value={filter.account ?? ''}
            onChange={e => navigate(hrefFor({ account: e.target.value || null }))}>
            <option value="">All accounts</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id} disabled={a.disabled && a.id !== filter.account}>
                {a.name} ({fmtNum(a.surveys)})
              </option>
            ))}
          </select>
        </Field>
        <Field id={ids.route} label="Route" help={ROUTE_HELP}>
          <select id={ids.route} className={control} value={filter.route}
            onChange={e => navigate(hrefFor({ route: e.target.value as RouteFilter }))}>
            {routes.map(r => (
              <option key={r.id} value={r.id} disabled={r.disabled && r.id !== filter.route}
                title={ROUTE_OPTIONS.find(o => o.id === r.id)?.help}>
                {r.label} ({fmtNum(r.surveys)})
              </option>
            ))}
          </select>
        </Field>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{exportSlot}</div>
      </div>

      {!rule.date && (
        <p id={`${ids.date}-why`} className="mt-1 text-[11px] text-muted-foreground">
          The date filter is not applied on {TAB_LABEL[tab]}: live work counts whenever it launched.
        </p>
      )}
      {badRange && (
        <p role="alert" className="mt-1 text-[12px] text-red-700 dark:text-red-400">
          The start date is after the end date, so no study can match. Change one of them.
        </p>
      )}

      {isFiltered(filter) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Filters in effect">
          {filter.range.preset !== DEFAULT_FILTER.range.preset && (rule.date ? (
            <Chip text={`Date: ${formatRange(resolved)}`} href={hrefFor(withoutDimension(filter, 'range'))}
              remove={`Remove the date filter (${formatRange(resolved)})`} />
          ) : (
            <span className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-[12px] text-muted-foreground"
              title="Kept for the other tabs; this tab does not apply it.">
              Date {formatRange(resolved)}: kept for the other tabs
            </span>
          ))}
          {filter.account && (
            <Chip text={`Account: ${accountName}`} href={hrefFor(withoutDimension(filter, 'account'))}
              remove={`Remove the account filter (${accountName})`} />
          )}
          {filter.route !== DEFAULT_FILTER.route && (
            <Chip text={`Route: ${routeLabel}`} href={hrefFor(withoutDimension(filter, 'route'))}
              remove={`Remove the route filter (${routeLabel})`} />
          )}
          <Link href={hrefFor({ ...DEFAULT_FILTER, range: { ...DEFAULT_FILTER.range } })} replace scroll={false}
            className="ml-1 text-[12px] text-primary underline-offset-2 hover:underline"
            title={`Back to every account and route, ${DEFAULT_WORDS}`}>
            Clear
          </Link>
        </div>
      )}
    </div>
  )
}
