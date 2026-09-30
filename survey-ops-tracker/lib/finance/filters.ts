/**
 * The finance page's ONE filter object.
 *
 * Before this, the filters lived as loose URL params read in five places, and
 * four blocks on the page ignored every one of them without saying so (live
 * exposure, the backlog, the lifecycle chips and the whole Save tab) — which is
 * exactly the "not all tabs updated" problem. The chips said one thing, the
 * drill's population line another, the export header a third and the audit row
 * a fourth. Now there is one object, one parser, one serializer and one
 * `describe()`, and every one of those four surfaces reads the same words from
 * it.
 *
 * ── THREE FILTERS ───────────────────────────────────────────────────────────
 *   range    Since 1 June 2026 (the DEFAULT — David, 2026-09-24: "default every
 *            tab to since 1 June, all time one click away"), this month, last
 *            month, this quarter, custom, all time. "Today" is Eastern time.
 *   account  one client account, by clients.id — never the stale `client`
 *            label, which splits BAM nine ways.
 *   route    blast / panel / both / no field rows / all — MEASURED from the
 *            survey's own rows, never the type it was filed as.
 *
 * ── A SURVEY'S DATE ─────────────────────────────────────────────────────────
 * Deliver date, else launch date, else submitted date (`finDate`). Never
 * `delivered_at` (bulk-stamped: 42 surveys carry the same September day) and
 * never `created_at` (204 surveys were bulk-created in June). A survey with none
 * of the three drops out as soon as a date range is picked, and the help text
 * says how many do.
 *
 * ── PER-TAB POPULATION ──────────────────────────────────────────────────────
 * A tab's population is its classes (lib/finance/lifecycle.ts) × the filters it
 * honours. "This week" is live work and IGNORES the date — an overspending
 * survey matters whenever it launched — and it says so in its scope chip rather
 * than silently. Hold is shown beside live work as its own bucket, never inside
 * it (David, 2026-09-24).
 */

import {
  buildIndex, finDate, NO_CONTACT, routeOf,
  type FinAccount, type FinBlast, type FinCost, type FinIndex, type FinProject, type FinSupplier,
  type Route,
} from './hub'
import { classOf, CLASS_LABEL, type FinClass } from './lifecycle'
import { fmtNum } from '@/lib/utils/number'

/** The default range starts here: from June 2026 costs are recorded on most
 *  delivered surveys (the computed reliability line in coverage.ts agrees
 *  today). This is the DEFAULT, not a claim — the banner's dates are computed. */
export const RELIABLE_FROM = '2026-06-01'

export type RangePreset = 'since-jun-1' | 'this-month' | 'last-month' | 'this-quarter' | 'custom' | 'all'
export type RouteFilter = 'all' | Route
export type FinanceTab = 'results' | 'this-week' | 'per-respondent' | 'improve'

export interface FinanceFilter {
  range: {
    preset: RangePreset
    /** Only read when preset is 'custom'. Inclusive ISO dates. */
    from: string | null
    to: string | null
  }
  /** clients.id, or null for every account. */
  account: string | null
  route: RouteFilter
}

export const DEFAULT_FILTER: FinanceFilter = {
  range: { preset: 'since-jun-1', from: null, to: null },
  account: null,
  route: 'all',
}

export const RANGE_PRESETS: { id: RangePreset; label: string; help: string }[] = [
  // No reliability claim in this string. How far back the records can be
  // trusted is COMPUTED (coverage.ts reliabilityDates, David's decision 8), and
  // the filter bar adds that computed sentence to this preset's help — a typed
  // month here would contradict the banner the moment the backfill moved it.
  { id: 'since-jun-1', label: 'Since 1 Jun 2026', help: 'Live work due after today is included.' },
  { id: 'this-month', label: 'This month', help: 'From the 1st of this month on. Live work due after today is included, because it is being worked on now.' },
  { id: 'last-month', label: 'Last month', help: 'The whole of last calendar month.' },
  { id: 'this-quarter', label: 'This quarter', help: 'From the first day of this quarter on. Live work due after today is included, because it is being worked on now.' },
  { id: 'custom', label: 'Custom', help: 'Pick your own start and end dates.' },
  { id: 'all', label: 'All time', help: 'Every study, including those from before costs were recorded and those with no date.' },
]

export const ROUTE_OPTIONS: { id: RouteFilter; label: string; help: string }[] = [
  { id: 'all', label: 'All routes', help: 'Every study, however it was fielded.' },
  { id: 'blast', label: 'Blast only', help: 'Fielded only through B2B email or text blasts.' },
  { id: 'panel', label: 'Panel only', help: 'Fielded only through PureSpectrum panels.' },
  { id: 'both', label: 'Both', help: 'Fielded through blasts and panels together.' },
  { id: 'none', label: 'No field rows', help: 'No blast or panel purchase recorded at all.' },
]

export const TAB_LABEL: Record<FinanceTab, string> = {
  'results': 'Results',
  'this-week': 'This week',
  'per-respondent': 'Per respondent',
  'improve': 'Improve',
}

export interface TabRule {
  /** The classes the tab's population is drawn from. */
  classes: FinClass[]
  /** Classes shown BESIDE the population as their own bucket, never summed
   *  into it (Hold, on This week). */
  side: FinClass[]
  date: boolean
  account: boolean
  route: boolean
  /** How the scope chip names the population. */
  word: string
  /** What the chip says about a filter the tab does not apply. */
  ignoredNote?: string
}

export const TAB_RULES: Record<FinanceTab, TabRule> = {
  'results': { classes: ['delivered'], side: [], date: true, account: true, route: true, word: 'Delivered' },
  'per-respondent': { classes: ['delivered'], side: [], date: true, account: true, route: true, word: 'Delivered' },
  'improve': { classes: ['delivered', 'active'], side: [], date: true, account: true, route: true, word: 'Delivered and live' },
  'this-week': {
    classes: ['active'], side: ['hold'], date: false, account: true, route: true, word: 'Live',
    ignoredNote: 'Live work — all dates',
  },
}

/**
 * The population the savings levers are computed on (Per respondent, Tile 5):
 * delivered AND live work in the date window × account × route. Not a whole
 * tab, so it is declared here once, and every lever, its drill and its scope
 * chip read the same surveys (the old page computed the levers on one set and
 * checked their drills against another).
 */
export const LEVER_RULE: TabRule = {
  classes: ['delivered', 'active'], side: [], date: true, account: true, route: true,
  word: 'Delivered and live',
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const isoOrNull = (v: string | null | undefined): string | null =>
  v && ISO.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) ? v : null

/** Today's date in Eastern time, 'YYYY-MM-DD' — the office's calendar, so a
 *  survey delivered at 9pm New York time is not placed in tomorrow. */
export function todayET(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

const pad = (n: number) => String(n).padStart(2, '0')
const endOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

/**
 * The inclusive bounds a range selects, given today. null = unbounded.
 *
 * ── A RANGE THAT RUNS "TO DATE" HAS NO END DATE ─────────────────────────────
 * Since 1 June, this month and this quarter all mean "from X up to now", and
 * live work IS now — but a live survey is placed by its deliver date, which is
 * usually still ahead. Capped at today, these ranges kept 11 of 46 live surveys
 * on 2026-09-27 (31 were due later, holding most of the live spend), so the
 * savings levers and the "Delivered and live" groups quietly lost the in-flight
 * work — exactly the work where acting still saves money — while the chip read
 * "1 Jun–27 Sep 2026" as if it covered all of it. So they are open-ended.
 * Whatever carries a date after today is current work — live, on hold, or
 * delivered ahead of its date (none was, when this was written) — so leaving
 * off the end admits the work of the period and nothing older. Last month and
 * a custom range name an end date and keep it.
 */
export function resolveRange(
  range: FinanceFilter['range'], today: string,
): { from: string | null; to: string | null } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
  switch (range.preset) {
    case 'since-jun-1': return { from: RELIABLE_FROM, to: null }
    case 'this-month': return { from: `${y}-${pad(m)}-01`, to: null }
    case 'last-month': {
      const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1
      return { from: `${ly}-${pad(lm)}-01`, to: endOfMonth(ly, lm) }
    }
    case 'this-quarter': {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1
      return { from: `${y}-${pad(q0)}-01`, to: null }
    }
    case 'custom': return { from: isoOrNull(range.from), to: isoOrNull(range.to) }
    case 'all': return { from: null, to: null }
  }
}

/** Is a range bounded at all? An unbounded range keeps undated surveys. */
export const isBounded = (r: { from: string | null; to: string | null }) => r.from != null || r.to != null

/** The date a survey is placed by. */
export const placementDate = (p: FinProject): string | null => finDate(p)

/** Legacy `?preset=` values from the page before this one, so bookmarks keep
 *  working instead of silently resetting. */
const LEGACY_PRESET: Record<string, RangePreset> = {
  mtd: 'this-month', qtd: 'this-quarter', lastmonth: 'last-month',
}

const PRESET_IDS = new Set<string>(RANGE_PRESETS.map(p => p.id))
const ROUTE_IDS = new Set<string>(ROUTE_OPTIONS.map(r => r.id))

type ParamSource = URLSearchParams | { get(k: string): string | null } | Record<string, string | null | undefined>
const read = (src: ParamSource, k: string): string | null => {
  if (typeof (src as { get?: unknown }).get === 'function') return (src as { get(k: string): string | null }).get(k)
  const v = (src as Record<string, string | null | undefined>)[k]
  return v == null ? null : String(v)
}

/**
 * Read the filter from the URL. Unknown values fall back to the default rather
 * than emptying the page (an unknown `?lifecycle=` used to return 0 rows).
 * Keys: `range` (preset), `from`, `to`, `account`, `route`. The old `preset`
 * key is still read.
 */
export function parseFilter(src: ParamSource): FinanceFilter {
  const raw = read(src, 'range') ?? read(src, 'preset')
  let preset: RangePreset = DEFAULT_FILTER.range.preset
  if (raw && PRESET_IDS.has(raw)) preset = raw as RangePreset
  else if (raw && LEGACY_PRESET[raw]) preset = LEGACY_PRESET[raw]
  const from = isoOrNull(read(src, 'from'))
  const to = isoOrNull(read(src, 'to'))
  // A custom range with neither bound is not a range; treat it as the default.
  if (preset === 'custom' && !from && !to) preset = DEFAULT_FILTER.range.preset
  const route = read(src, 'route')
  return {
    range: { preset, from: preset === 'custom' ? from : null, to: preset === 'custom' ? to : null },
    account: read(src, 'account') || null,
    route: route && ROUTE_IDS.has(route) ? (route as RouteFilter) : 'all',
  }
}

const FILTER_KEYS = ['range', 'preset', 'from', 'to', 'account', 'route'] as const

/**
 * Write the filter into URL params. Defaults are omitted so a default view has
 * a clean URL. `base` carries anything else on the URL (the tab, an open drill)
 * through unchanged; the filter's own keys are always rewritten.
 */
export function serializeFilter(f: FinanceFilter, base?: URLSearchParams | string): URLSearchParams {
  const out = new URLSearchParams(typeof base === 'string' ? base : base?.toString() ?? '')
  for (const k of FILTER_KEYS) out.delete(k)
  if (f.range.preset !== DEFAULT_FILTER.range.preset) out.set('range', f.range.preset)
  if (f.range.preset === 'custom') {
    if (f.range.from) out.set('from', f.range.from)
    if (f.range.to) out.set('to', f.range.to)
  }
  if (f.account) out.set('account', f.account)
  if (f.route !== 'all') out.set('route', f.route)
  return out
}

/** True when any filter differs from the default — what shows "Clear". */
export function isFiltered(f: FinanceFilter): boolean {
  return f.range.preset !== DEFAULT_FILTER.range.preset || f.account != null || f.route !== 'all'
}

/**
 * The filter after the reader picks a range preset from the dropdown.
 *
 * Picking "Custom" SEEDS its two dates from the range in view, ending today at
 * the latest. A custom range with neither date is not a range, and parseFilter
 * reads one back as the default — so a select that wrote only `range=custom`
 * snapped straight back to "Since 1 Jun 2026" and its date inputs never
 * appeared. Seeded, the URL survives the round trip and the inputs open on the
 * dates the reader was already looking at.
 */
export function withPreset(f: FinanceFilter, preset: RangePreset, today: string): FinanceFilter {
  if (preset !== 'custom') return { ...f, range: { preset, from: null, to: null } }
  if (f.range.preset === 'custom' && (f.range.from || f.range.to)) return f
  const r = resolveRange(f.range, today)
  return { ...f, range: { preset: 'custom', from: r.from ?? RELIABLE_FROM, to: r.to ?? today } }
}

/* ── THE POPULATION ─────────────────────────────────────────────────────── */

/** One survey, classified and routed once per load, so filtering is cheap and
 *  every tab reads the same class and route for it. */
export interface FinItem {
  p: FinProject
  cls: FinClass
  route: Route
  date: string | null
}

/** Classify and route every survey. Empty placeholders are dropped here: they
 *  are excluded everywhere, so nothing downstream should ever see one. */
export function itemsOf(
  projects: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  ix: FinIndex = buildIndex(blasts, suppliers, costs),
): FinItem[] {
  const out: FinItem[] = []
  for (const p of projects) {
    const cls = classOf(p, ix)
    if (cls === 'placeholder') continue
    out.push({ p, cls, route: routeOf(p, blasts, suppliers, ix), date: finDate(p) })
  }
  return out
}

export const inRange = (date: string | null, r: { from: string | null; to: string | null }) => {
  if (r.from && (!date || date < r.from)) return false
  if (r.to && (!date || date > r.to)) return false
  return true
}

type Dim = 'date' | 'account' | 'route'

/** Does one item pass the filter on the dimensions the rule honours, leaving
 *  out any dimension named in `skip` (used for option counts)? */
function passes(
  it: FinItem, f: FinanceFilter, rule: TabRule, range: { from: string | null; to: string | null },
  skip: Dim[] = [],
): boolean {
  if (rule.date && !skip.includes('date') && !inRange(it.date, range)) return false
  if (rule.account && !skip.includes('account') && f.account && it.p.client_id !== f.account) return false
  if (rule.route && !skip.includes('route') && f.route !== 'all' && it.route !== f.route) return false
  return true
}

/** The surveys a rule selects under a filter. `populationFor` is this with a
 *  tab's rule; a population that is not a whole tab (LEVER_RULE) calls it
 *  directly, so it follows exactly the same filter logic. */
export function populationByRule(items: FinItem[], rule: TabRule, f: FinanceFilter, today: string): FinItem[] {
  const range = resolveRange(f.range, today)
  return items.filter(it => rule.classes.includes(it.cls) && passes(it, f, rule, range))
}

/** The surveys a tab shows, under a filter. */
export function populationFor(items: FinItem[], tab: FinanceTab, f: FinanceFilter, today: string): FinItem[] {
  return populationByRule(items, TAB_RULES[tab], f, today)
}

/** The side bucket a tab shows beside its population (Hold on This week), under
 *  the same filters and never summed into it. */
export function sideBucketFor(items: FinItem[], tab: FinanceTab, f: FinanceFilter, today: string): FinItem[] {
  const rule = TAB_RULES[tab]
  if (!rule.side.length) return []
  const range = resolveRange(f.range, today)
  return items.filter(it => rule.side.includes(it.cls) && passes(it, f, rule, range))
}

/** What the CURRENT finance page filters on beyond FinanceFilter: its
 *  lifecycle chips (any one class, or all of them), the type as filed, and one
 *  contact at the selected account. */
export interface ViewExtras {
  /** The classes the lifecycle chips select. */
  classes: FinClass[]
  type?: string | null
  /** A client_contacts id, or NO_CONTACT for "no contact recorded". Read only
   *  when an account is selected. */
  contactId?: string | null
}

export interface ViewPopulations {
  /** The view: the lifecycle chips × every filter. */
  rows: FinItem[]
  /** Every class × every filter, so the lifecycle chips count what the other
   *  filters leave rather than the whole book. */
  rowsAnyLife: FinItem[]
  /** Every class × every filter but the date. Live work, holds and the backlog
   *  are drawn from here: an overspend matters whenever the survey launched. */
  liveRows: FinItem[]
  /** Delivered and live work in the window — LEVER_RULE, the population every
   *  savings lever, its drill and its chip use. */
  savePop: FinItem[]
  /** The view without the account (and so without the contact), and without
   *  the contact alone: what the two pickers count, so their counts reflect
   *  the other filters. */
  rowsNoAccount: FinItem[]
  rowsNoContact: FinItem[]
}

const EVERY_CLASS: FinClass[] = ['delivered', 'active', 'hold', 'cancelled', 'archived', 'scoping']

/**
 * Every population the CURRENT finance page draws its cards from, built only
 * from `populationByRule` — so the page runs the same filter logic the tab
 * rules are tested on, and a test can build exactly what the page ships.
 *
 * Before this, the page assembled its populations by hand with applyFilters,
 * one line per card, while the tests exercised populationFor: fourteen green
 * filter states said nothing about the populations the page actually built.
 * The extras are applied on top of the rule and never change which classes or
 * dates a rule admits.
 */
export function viewPopulations(
  items: FinItem[], f: FinanceFilter, today: string, x: ViewExtras,
): ViewPopulations {
  const rule = (classes: FinClass[], date = true): TabRule => ({
    classes, side: [], date, account: true, route: true, word: '',
  })
  const extras = (contact: boolean) => (it: FinItem) => {
    if (x.type && it.p.project_type !== x.type) return false
    if (contact && f.account && x.contactId) {
      const c = it.p.requested_by_contact_id ?? null
      if (x.contactId === NO_CONTACT ? c !== null : c !== x.contactId) return false
    }
    return true
  }
  const pick = (r: TabRule, ff: FinanceFilter, contact = true) =>
    populationByRule(items, r, ff, today).filter(extras(contact))
  return {
    rows: pick(rule(x.classes), f),
    rowsAnyLife: pick(rule(EVERY_CLASS), f),
    liveRows: pick(rule(EVERY_CLASS, false), f),
    savePop: pick(LEVER_RULE, f),
    rowsNoAccount: pick(rule(x.classes), { ...f, account: null }, false),
    rowsNoContact: pick(rule(x.classes), f, false),
  }
}

/** Surveys the tab would show but for the date — how many drop out because
 *  they have no date at all, for the date help text. */
export function undatedDropped(items: FinItem[], tab: FinanceTab, f: FinanceFilter, today: string): number {
  const rule = TAB_RULES[tab]
  const range = resolveRange(f.range, today)
  if (!rule.date || !isBounded(range)) return 0
  return items.filter(it => rule.classes.includes(it.cls) && it.date == null && passes(it, f, rule, range, ['date'])).length
}

export interface AccountChoice { id: string; name: string; surveys: number; disabled: boolean }
export interface RouteChoice { id: RouteFilter; label: string; surveys: number; disabled: boolean }

/**
 * The dropdown options with counts that reflect the OTHER active filters.
 * "BAM (86)" for 69 surveys in view was the old behaviour: an account's count
 * is now the surveys it would show under the current date and route, and a
 * route's count the surveys under the current date and account. An option
 * that would show nothing is kept (so the list does not jump) and greyed.
 * Alphabetical — a picker is for finding a name you already have in mind.
 */
export function optionCounts(
  items: FinItem[], tab: FinanceTab, f: FinanceFilter, accounts: FinAccount[], today: string,
): { accounts: AccountChoice[]; routes: RouteChoice[] } {
  const rule = TAB_RULES[tab]
  const range = resolveRange(f.range, today)
  const inTab = items.filter(it => rule.classes.includes(it.cls))
  const name = new Map(accounts.map(a => [a.id, a.name ?? '(unnamed)']))
  const acc = new Map<string, number>()
  for (const it of inTab) {
    const id = it.p.client_id
    if (!id) continue
    if (!acc.has(id)) acc.set(id, 0)
    if (passes(it, f, rule, range, ['account'])) acc.set(id, (acc.get(id) ?? 0) + 1)
  }
  if (f.account && !acc.has(f.account)) acc.set(f.account, 0)
  const accountsOut = [...acc.entries()]
    .map(([id, surveys]) => ({ id, name: name.get(id) ?? '(unknown account)', surveys, disabled: surveys === 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const routesOut = ROUTE_OPTIONS.map(o => {
    const surveys = inTab.filter(it =>
      (o.id === 'all' || it.route === o.id) && passes(it, f, rule, range, ['route'])).length
    return { id: o.id, label: o.label, surveys, disabled: surveys === 0 && o.id !== 'all' }
  })
  return { accounts: accountsOut, routes: routesOut }
}

/* ── THE WORDS ──────────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string, withYear: boolean) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`
}

/** "1 Jun–24 Sep 2026", "1 Dec 2025–24 Sep 2026", "From 1 Jun 2026", "All time". */
export function formatRange(r: { from: string | null; to: string | null }): string {
  if (!r.from && !r.to) return 'All time'
  if (r.from && r.to) {
    const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4)
    return `${day(r.from, !sameYear)}–${day(r.to, true)}`
  }
  if (r.from) return `From ${day(r.from, true)}`
  return `Up to ${day(r.to as string, true)}`
}

export interface FilterDescription {
  /** The scope chip on every card: "Delivered · 1 Jun–24 Sep 2026 · BAM · 41 surveys". */
  chip: string
  /** Filters this tab does not apply, in words, so a card never ignores one
   *  silently: ["Live work — all dates"]. */
  ignored: string[]
  /** The header block at the top of an export, one line per fact. */
  header: string[]
  /** The same facts as flat data, for the export audit row. */
  audit: Record<string, string | number | boolean | null>
}

/**
 * One description of a filter, three renderings. The chip, the drill's
 * population line, the export header and the audit row are all built here,
 * so they cannot disagree.
 */
export function describe(
  f: FinanceFilter,
  ctx: {
    tab: FinanceTab
    today: string
    /** Surveys in the population, printed on the chip. */
    count: number
    accountName?: string | null
    /** When the data was loaded, for the export header. */
    asOf?: string | null
    /** A population narrower than the tab (LEVER_RULE), when the words are for
     *  a card that declares its own. Defaults to the tab's rule. */
    rule?: TabRule
  },
): FilterDescription {
  const rule = ctx.rule ?? TAB_RULES[ctx.tab]
  const range = resolveRange(f.range, ctx.today)
  const route = ROUTE_OPTIONS.find(o => o.id === f.route)
  const account = f.account ? (ctx.accountName ?? 'One account') : null
  const dateText = rule.date ? formatRange(range) : (rule.ignoredNote ?? 'All dates')
  const surveys = `${fmtNum(ctx.count)} ${ctx.count === 1 ? 'study' : 'studies'}`
  const chip = [
    rule.word,
    dateText,
    ...(rule.account && account ? [account] : []),
    ...(rule.route && f.route !== 'all' && route ? [route.label] : []),
    surveys,
  ].join(' · ')
  const ignored: string[] = []
  if (!rule.date && f.range.preset !== 'all') ignored.push(rule.ignoredNote ?? 'Date filter not applied')
  const header = [
    'SOCC finance export',
    ...(ctx.asOf ? [`As of: ${ctx.asOf}`] : []),
    `Tab: ${TAB_LABEL[ctx.tab]}`,
    `Studies: ${rule.classes.map(c => CLASS_LABEL[c]).join(' and ')}` +
      (rule.side.length ? ` (${rule.side.map(c => CLASS_LABEL[c]).join(', ')} listed separately)` : ''),
    rule.date
      ? `Date: ${formatRange(range)} (placed by deliver date, then launch date, then submitted date)`
      : `Date: not applied — ${rule.ignoredNote ?? 'all dates'}`,
    `Account: ${account ?? 'All accounts'}`,
    `Route: ${route?.label ?? 'All routes'} (measured from each study's own rows)`,
    `Rows: ${fmtNum(ctx.count)}`,
  ]
  const audit: FilterDescription['audit'] = {
    tab: ctx.tab,
    population: rule.classes.join('+'),
    range: f.range.preset,
    from: rule.date ? range.from : null,
    to: rule.date ? range.to : null,
    date_applied: rule.date,
    account: f.account,
    account_name: account,
    route: f.route,
    rows: ctx.count,
  }
  return { chip, ignored, header, audit }
}
