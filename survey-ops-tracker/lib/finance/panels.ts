/**
 * The Panel supplier view and the PureSpectrum drilldown (finance spec, Tab 1,
 * "Panel supplier view" and "PureSpectrum panel drilldown").
 *
 * ── WHAT IT ANSWERS ─────────────────────────────────────────────────────────
 * "Which panels did our PureSpectrum money go to, what did each charge per
 * complete, and how much did we pay a dearer panel when a cheaper one was
 * already delivering in the same wave?" Rows are panels (project_suppliers
 * joined to suppliers(name)), drawn from the panel rows of the surveys in view.
 *
 * ── HOW THE SPEND COLUMN IS CHECKED, AND WHAT EACH CHECK IS WORTH ───────────
 * There are two, and they are not equally strong — so the strip says which is
 * which rather than putting one tick on both.
 *
 * 1. Against the "Panel (PureSpectrum)" line of the spend waterfall. Different
 *    code (the rows here walk the raw supplier rows panel by panel; the
 *    breakdown goes survey by survey through spendOf and the shell's index),
 *    but the SAME rows underneath, because the shell builds that index from
 *    this very array. It catches a row counted twice, a survey listed twice in
 *    the population, or an index built from something else — and nothing more.
 *    It is a shape check, and the words say so: "the same purchases, summed
 *    survey by survey". The panel ids are checked the same way.
 * 2. Against `actual_spend` — the spend the DATABASE keeps for each survey, put
 *    there by the recompute trigger, not by this file. On a survey that bought
 *    from panels and nothing else, its whole recorded spend is panel money plus
 *    its cost lines, so the panel figure these rows imply can be compared with
 *    a number nothing on this page produced. That one can really disagree: a
 *    stale trigger, a supplier row changed outside the app, or a purchase this
 *    view never loaded would all show up. It is the check that earns the tick,
 *    and the strip only ticks when it actually ran (102 of 102 such surveys
 *    carried a stored spend on 28 Sep, and all 102 agreed to the cent).
 *
 * ── WHY "PAID ABOVE THE CHEAPEST" COPIES THE LEVER'S RULE EXACTLY ───────────
 * The Per respondent tab quotes one figure for this (savings.ts
 * waveSpreadLever) and this view splits it by panel, so the rule below is the
 * lever's, line for line, and panels.test.ts proves the per-panel amounts sum
 * to the lever's figure on the same population.
 *
 * The POPULATIONS still differ, and that is the one place the two tabs show
 * different dollars: Results counts delivered work, the lever counts delivered
 * AND live (filters.ts LEVER_RULE). So the model also computes the lever's own
 * figure (`leverAbove`) and the card prints it beside its own, rather than
 * leaving a reader who followed "See panels →" to find a smaller number with no
 * explanation. The rule, in both places:
 *   · a wave is the launch (launch_id), or the whole survey when a row has none;
 *   · only rows that BOUGHT count — completes above 0 and a price above $0;
 *   · a wave needs two or more panels (by supplier_id) to compare;
 *   · each purchase pays (its CPI − the cheapest CPI in the wave) × completes.
 * It is direction only: panel capacity and per-panel QA are not recorded, so
 * the cheapest panel may not have had the volume or may have scrubbed worse.
 *
 * ── WHAT IS NOT HERE, ON PURPOSE ────────────────────────────────────────────
 * Client price is per survey, not per panel, so it is never split by panel.
 * QA-passed respondents are not recorded per panel, so there is no per-panel
 * cost per qualified respondent (finance spec, Improve blocked row B2).
 */

import { costBreakdown, spendOf, type FinBlast, type FinCost, type FinIndex, type FinProject, type FinSupplier } from './hub'
import { populationByRule, LEVER_RULE, type FinanceFilter, type FinItem } from './filters'
import { reconcile, CENT, type Reconciliation } from './drill'
import { monthLabel } from './coverage'
import { money, money2, pctText } from './format'
import { fmtNum } from '@/lib/utils/number'

/** A project_suppliers row as this view reads it. `id` is optional so the
 *  arithmetic tests can stay small; the loader always supplies it. */
export type PanelSupplierRow = FinSupplier & { id?: string }

/** A project_launches row — one PureSpectrum wave. */
export interface PanelLaunch {
  id: string
  project_id: string
  label?: string | null
  launch_date?: string | null
  note?: string | null
}

export interface PanelsInput {
  /** The tab's population (props.population). */
  population: FinItem[]
  /** raw.suppliers, with suppliers(name). */
  suppliers: PanelSupplierRow[]
  /** raw.launches. */
  launches: PanelLaunch[]
  /** raw.blasts and raw.costs, for the cost breakdown the panel line comes from. */
  blasts: FinBlast[]
  costs: FinCost[]
  /** Did `project_blasts` load? Which surveys bought from panels ALONE cannot be
   *  known without it — an unread blast table makes every survey look panel-only
   *  — so the outside check stands down rather than flagging surveys whose
   *  stored spend includes blast money it cannot see. Defaults to true, because
   *  the arithmetic tests hand over the rows they mean. */
  blastsLoaded?: boolean
  /** props.ix — the shell's index, used for the independent checks. */
  ix: FinIndex
  /** The panel picked in the URL (?supplier=<id>), or null. */
  selected?: string | null
  /** Every survey the shell classified (props.items), with the page's filter
   *  and today's date. Only used to compute the Per respondent tab's own
   *  population (LEVER_RULE: delivered AND live), so the card can say where its
   *  figure and that tab's differ instead of letting a reader find two answers.
   *  Optional so the arithmetic tests can stay small; the view always passes
   *  all three, and without them `leverAbove` is null and nothing is claimed. */
  items?: FinItem[]
  filter?: FinanceFilter
  today?: string
}

/** The URL parameter that opens the drilldown, and the anchors it scrolls to. */
export const SUPPLIER_PARAM = 'supplier'
export const CARD_ANCHOR = 'panel-suppliers'
export const DETAIL_ANCHOR = 'panel-supplier-detail'
/** Stands in for a row with no supplier_id, so it is still a row (and a link). */
export const NO_SUPPLIER = 'none'
export const UNNAMED = 'Unnamed panel'
/** How many panels the concentration sentence names ("the top 5 carry 88%"). */
export const TOP_PANELS = 5
/** Bars drawn in the spend chart; the rest become one "Other panels" bar. */
export const CHART_BARS = 10
/** Panels drawn in the price-drift heatmap (the picked one is always added). */
export const HEATMAP_ROWS = 8
export const UNDATED = 'undated'

/** The spec's tooltip for the price-drift heatmap. The spec writes "CPI"; the
 *  page has one name for this number — price per complete — so the caution uses
 *  it too. */
export const DRIFT_NOTE =
  'Country and audience move the price per complete; compare within one country once country is a structured field.'

export interface PanelRow {
  /** supplier_id, or NO_SUPPLIER. */
  id: string
  name: string
  /** False when the panel has no name on file (shown as "Unnamed panel"). */
  named: boolean
  /** Σ CPI × completes, a missing CPI counting $0 — the same arithmetic as the
   *  Panel line, so this is that line split by panel (and a floor where a
   *  price is missing). */
  spend: number
  /** spend ÷ all panel spend in view; null when there is none. */
  share: number | null
  /** Completes bought (rows with completes above 0). */
  completes: number
  /** Completes on rows that carry a CPI — the denominator of `cpc`. */
  pricedCompletes: number
  /** Completes on rows with no CPI recorded. Their cost is missing, not $0. */
  unpricedCompletes: number
  /** Price per complete: Σ CPI × completes ÷ Σ completes, on priced rows only.
   *  null when no row carries a price. */
  cpc: number | null
  /** cpc ÷ the all-panels price per complete − 1 (+0.23 = 23% dearer). */
  vsAll: number | null
  surveys: number
  waves: number
  /** Paid above the cheapest panel in the same wave (the lever's rule). */
  above: number
  /** Waves where this panel paid above the cheapest. */
  aboveWaves: number
  /** Waves this panel was set up on but delivered nothing. */
  idleWaves: number
}

/** One of the picked panel's purchases, one row per wave. */
export interface WaveRow {
  /** project_suppliers.id, or a stable stand-in when absent. */
  key: string
  projectId: string
  code: string | null
  launchId: string | null
  /** PS Survey# — the launch label, as recorded. */
  label: string | null
  launchDate: string | null
  /** The country as the launch note records it (free text, two conventions:
   *  "United States" and "en_US"); null when the note does not carry one. */
  country: string | null
  /** The launch note in full, for the hover. */
  note: string | null
  cpi: number | null
  /** The cheapest CPI in the wave under the lever's rule: the wave's cheapest
   *  when it was compared, this panel's own CPI when it was the only panel, and
   *  the wave's cheapest (if any) when this row could not be compared. */
  cheapest: number | null
  /** Panels in the wave that bought at a price above $0. */
  panels: number
  /** compared   — two or more panels bought; this row entered the comparison
   *  only-panel — this panel was the only one that bought; nothing to compare
   *  no-price   — this row carries no CPI (or $0), so it is not compared */
  basis: 'compared' | 'only-panel' | 'no-price'
  completes: number
  cost: number
  above: number
}

export interface SupplierDetail {
  row: PanelRow
  /** One row per PURCHASE (a project_suppliers row). Usually one per wave, but
   *  a panel can buy twice in one wave, so this can be longer than `row.waves`
   *  — which is why the table's footer counts both. */
  waves: WaveRow[]
  totals: { completes: number; cost: number; above: number }
  /** Waves it shared with at least one other panel that bought at a price. */
  sharedWaves: number
  /** The drilldown's closing sentence, with a verb (rule 7). */
  verdict: string
}

export interface ChartBar {
  /** The panel id, or null for the "Other panels" bar (which does not drill). */
  id: string | null
  name: string
  spend: number
  share: number | null
}

export interface HeatCellModel {
  row: string
  col: string
  value: number | null
  weight: number
  /** Countries as the launch notes record them, for the cell's note. */
  countries: string[]
}

export interface PanelsModel {
  /** Panels that bought completes in view, most spend first. */
  rows: PanelRow[]
  /** Panels set up on waves in view that delivered nothing. Not listed; their
   *  spend is $0 by construction. */
  idle: { id: string; name: string }[]
  total: {
    spend: number
    completes: number
    pricedCompletes: number
    unpricedCompletes: number
    /** Panels with unpriced completes. */
    unpricedPanels: number
    cpc: number | null
    /** Surveys in view with at least one panel purchase. */
    surveys: number
    /** Surveys in view (the population). */
    surveysInView: number
    waves: number
    /** The lever's figure, summed wave by wave in the lever's own order. */
    above: number
    /** Waves that bought from two or more panels (the ones the rule can see). */
    comparedWaves: number
    /** Of those, waves where someone paid above the cheapest. */
    spreadWaves: number
    /** The SAME rule on the Per respondent tab's own population (delivered AND
     *  live), so the card can name the figure that tab quotes. null when the
     *  caller did not hand over `items`/`filter`/`today`. */
    leverAbove: number | null
  }
  /** The top-N concentration: how many panels and what share of spend. */
  top: { count: number; spend: number; share: number | null }
  /** The Panel line of the cost breakdown — the same rows, summed the other
   *  way round. A shape check, not an outside one (see the file header). */
  panelLine: number
  reconciliation: Reconciliation
  /** The outside check: the database's own stored spend on the surveys here
   *  that bought from panels and nothing else. */
  stored: StoredCheck
  /** The reconcile strip's words. `verified` is true only when the outside
   *  check actually ran, and it is the only thing that earns a tick. */
  check: { ok: boolean; verified: boolean; text: string }
  chart: ChartBar[]
  verdict: string
  /** The card note, with its numbers. */
  note: string
  /** A floor warning when completes carry no price; null when none. */
  floorNote: string | null
  /** "This card counts finished work only …" — printed when the Per respondent
   *  tab's wave-spread figure differs from this one. null when they agree, or
   *  when there is nothing to compare. */
  leverNote: string | null
  /** The drilldown, when a panel is picked and it bought in view. */
  selected: SupplierDetail | null
  /** A panel was picked in the URL but bought nothing in this view. */
  selectedMissing: boolean
  /** The picked panel's name, from any row on file, so "bought nothing here"
   *  can name it; null when the id is unknown. */
  selectedName: string | null
  heatmap: {
    rows: { key: string; label: string; description?: string }[]
    columns: { key: string; label: string; shortLabel?: string }[]
    cells: HeatCellModel[]
  }
}

/** The wave a supplier row belongs to — the lever's key, exactly. */
const waveKey = (s: PanelSupplierRow) => s.launch_id ?? `project:${s.project_id}`

/** Did this row buy something at a price? The lever's admission test. */
const bought = (s: PanelSupplierRow) => Number(s.n_collected ?? 0) > 0 && Number(s.cpi ?? 0) > 0

/** What the wave rule found: the total, the waves it could and did judge, and
 *  the per-wave and per-row workings the drilldown needs. */
interface WaveSpread {
  above: number
  comparedWaves: number
  spreadWaves: number
  /** The cheapest price in each wave the rule compared. */
  cheapestOf: Map<string, number>
  /** How many panels bought at a price in each wave. */
  panelsIn: Map<string, number>
  /** What each purchase paid above the cheapest, where that is above $0. */
  extraOf: Map<PanelSupplierRow, number>
}

/**
 * Paid above the cheapest panel in the same wave — savings.ts waveSpreadLever's
 * rule, line for line, on whichever rows it is given.
 *
 * One function, called twice: once on the surveys this card shows (delivered),
 * once on the Per respondent tab's own population (delivered and live), so the
 * two figures can only differ by their surveys and never by their arithmetic.
 * Rows must arrive in load order, which is what makes the total bitwise equal
 * to the lever's.
 */
function waveSpread(rows: PanelSupplierRow[]): WaveSpread {
  const waves = new Map<string, PanelSupplierRow[]>()
  for (const s of rows) {
    if (!bought(s)) continue
    const k = waveKey(s)
    const a = waves.get(k)
    if (a) a.push(s); else waves.set(k, [s])
  }
  const cheapestOf = new Map<string, number>()
  const panelsIn = new Map<string, number>()
  const extraOf = new Map<PanelSupplierRow, number>()
  let above = 0, comparedWaves = 0, spreadWaves = 0
  for (const [k, list] of waves) {
    const panels = new Set(list.map(r => r.supplier_id ?? '?'))
    panelsIn.set(k, panels.size)
    if (panels.size < 2) continue
    comparedWaves++
    const cheapest = Math.min(...list.map(r => Number(r.cpi)))
    cheapestOf.set(k, cheapest)
    let touched = false
    for (const r of list) {
      const extra = (Number(r.cpi) - cheapest) * Number(r.n_collected)
      if (extra > 0) { above += extra; extraOf.set(r, extra); touched = true }
    }
    if (touched) spreadWaves++
  }
  return { above, comparedWaves, spreadWaves, cheapestOf, panelsIn, extraOf }
}

/** The outside check on the panel total: what the DATABASE recorded as spend. */
export interface StoredCheck {
  /** Surveys here that bought from panels and nothing else, and carry a stored
   *  spend — the ones the check could actually run on. */
  checked: number
  /** Surveys that qualified but have no stored spend recorded, so they were
   *  skipped rather than counted as agreeing. */
  skipped: number
  /** Where the rows and the stored spend disagree by a cent or more. */
  mismatches: { id: string; code: string | null; rows: number; stored: number }[]
  /** The check could not be attempted at all: without the blast rows, "bought
   *  only from panels" is not a question this can answer. */
  unavailable: boolean
}

/**
 * Does the panel money these rows imply agree with the spend the database keeps
 * for each survey?
 *
 * Only surveys with NO blast rows can answer: on those, the whole recorded
 * spend is panel purchases plus cost lines, so `actual_spend` less the cost
 * lines IS the panel figure, and `actual_spend` is written by the recompute
 * trigger rather than by anything on this page. A survey fielded both ways
 * cannot be split this way and is left out — which is honest, and is why the
 * strip prints how many surveys the check covered.
 */
function storedCheck(
  projects: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[], ix: FinIndex,
  blastsLoaded: boolean,
): StoredCheck {
  const mismatches: StoredCheck['mismatches'] = []
  let checked = 0, skipped = 0
  if (!blastsLoaded) return { checked, skipped, mismatches, unavailable: true }
  for (const p of projects) {
    if ((ix.blasts.get(p.id)?.length ?? 0) > 0) continue
    if ((ix.suppliers.get(p.id)?.length ?? 0) === 0) continue
    const stored = finite(p.actual_spend)
    if (stored == null) { skipped++; continue }
    checked++
    const s = spendOf(p, blasts, suppliers, costs, ix)
    // Their number, less the cost lines we can see, is the panel money.
    const implied = stored - s.other - s.recovered
    if (Math.abs(s.panel - implied) >= CENT - 1e-9) {
      mismatches.push({ id: p.id, code: p.project_code, rows: s.panel, stored: implied })
    }
  }
  return { checked, skipped, mismatches, unavailable: false }
}

const finite = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * The country as the launch note records it.
 *
 * Country is not a structured field on a wave yet (Improve, B4). The PureSpectrum
 * import writes "<survey> · <country> · PureSpectrum Survey# …", and hand-made
 * roll-ups write "<name> · <country> · $3.00/complete · …", in two conventions
 * ("United States" and "en_US"). The country is the part just before the first
 * "PureSpectrum Survey#" or "$…/complete" part — and only when something comes
 * before it, since the first part is always the survey's own name. Anything
 * else ("PureSpectrum dashboard snapshot …") carries no country: null, which the
 * view shows as "not recorded". Returned exactly as written, never normalised.
 */
export function countryAsRecorded(note: string | null | undefined): string | null {
  if (!note) return null
  const parts = note.split(' · ').map(p => p.trim())
  const marker = parts.findIndex((p, i) =>
    i > 0 && (/^PureSpectrum Survey#/i.test(p) || /^\$\d[\d.,]*(\s*[-–]\s*\$\d[\d.,]*)?\/complete/i.test(p)))
  if (marker < 2) return null
  return parts[marker - 1] || null
}

/** A link to this page with the panel picked (or cleared), every other
 *  parameter kept — tab, group-by and filters. A real href, so the panel
 *  name can be middle-clicked into a new tab. */
export function supplierHref(pathname: string, search: string | URLSearchParams, supplierId: string | null): string {
  const sp = new URLSearchParams(typeof search === 'string' ? search : search.toString())
  if (supplierId == null) sp.delete(SUPPLIER_PARAM)
  else sp.set(SUPPLIER_PARAM, supplierId)
  const q = sp.toString()
  return `${pathname}${q ? `?${q}` : ''}#${supplierId == null ? CARD_ANCHOR : DETAIL_ANCHOR}`
}

/** "+23%" / "−10%" / "same" — a panel's price against all panels. */
export function vsAllText(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return '—'
  if (Math.round(Math.abs(x) * 100) === 0) return 'same'
  return (x > 0 ? '+' : '') + pctText(x)
}

interface Acc {
  id: string
  name: string | null
  spend: number
  completes: number
  priced: number
  pricedSpend: number
  unpriced: number
  above: number
  surveys: Set<string>
  waves: Set<string>
  aboveWaves: Set<string>
  seenWaves: Set<string>
}

/** The supplier rows belonging to a set of surveys, IN LOAD ORDER: the lever
 *  walks the same array in the same order, which is what makes the wave-by-wave
 *  total bitwise equal to its figure rather than merely close. */
function rowsOf(population: FinItem[], suppliers: PanelSupplierRow[]): PanelSupplierRow[] {
  const ids = new Set(population.map(i => i.p.id))
  return suppliers.filter(s => ids.has(s.project_id))
}

export function buildPanelsModel(input: PanelsInput): PanelsModel {
  const projects = input.population.map(i => i.p)
  const byId = new Map(projects.map(p => [p.id, p]))
  const launchById = new Map(input.launches.map(l => [l.id, l]))
  const inView = rowsOf(input.population, input.suppliers)

  /* ── the wave rule (waveSpreadLever, line for line) ── */
  const { above, comparedWaves, spreadWaves, cheapestOf, panelsIn, extraOf } = waveSpread(inView)
  // The same rule on the Per respondent tab's own surveys (delivered AND live),
  // so the card can name the figure that tab shows instead of contradicting it.
  const leverAbove = input.items && input.filter && input.today
    ? waveSpread(rowsOf(populationByRule(input.items, LEVER_RULE, input.filter, input.today), input.suppliers)).above
    : null

  /* ── per panel ── */
  const acc = new Map<string, Acc>()
  for (const s of inView) {
    const id = s.supplier_id ?? NO_SUPPLIER
    let a = acc.get(id)
    if (!a) {
      a = {
        id, name: null, spend: 0, completes: 0, priced: 0, pricedSpend: 0, unpriced: 0, above: 0,
        surveys: new Set(), waves: new Set(), aboveWaves: new Set(), seenWaves: new Set(),
      }
      acc.set(id, a)
    }
    const name = s.suppliers?.name?.trim()
    if (!a.name && name) a.name = name
    const got = Number(s.n_collected ?? 0)
    const cpi = finite(s.cpi)
    // Same arithmetic as spendOf's panel line: a missing CPI adds $0.
    a.spend += Number(s.cpi ?? 0) * got
    const k = waveKey(s)
    a.seenWaves.add(k)
    if (got > 0) {
      a.completes += got
      a.surveys.add(s.project_id)
      a.waves.add(k)
      if (cpi != null) { a.priced += got; a.pricedSpend += cpi * got } else a.unpriced += got
    }
    const extra = extraOf.get(s)
    if (extra != null) { a.above += extra; a.aboveWaves.add(k) }
  }

  const listed = [...acc.values()].filter(a => a.completes > 0)
  const idleAcc = [...acc.values()].filter(a => a.completes <= 0)
  const spendAll = listed.reduce((t, a) => t + a.spend, 0) + idleAcc.reduce((t, a) => t + a.spend, 0)
  const pricedAll = listed.reduce((t, a) => t + a.priced, 0)
  const pricedSpendAll = listed.reduce((t, a) => t + a.pricedSpend, 0)
  const cpcAll = pricedAll > 0 ? pricedSpendAll / pricedAll : null

  const rows: PanelRow[] = listed.map(a => {
    const cpc = a.priced > 0 ? a.pricedSpend / a.priced : null
    return {
      id: a.id,
      name: a.name ?? UNNAMED,
      named: a.name != null,
      spend: a.spend,
      share: spendAll !== 0 ? a.spend / spendAll : null,
      completes: a.completes,
      pricedCompletes: a.priced,
      unpricedCompletes: a.unpriced,
      cpc,
      vsAll: cpc != null && cpcAll != null && cpcAll > 0 ? cpc / cpcAll - 1 : null,
      surveys: a.surveys.size,
      waves: a.waves.size,
      above: a.above,
      aboveWaves: a.aboveWaves.size,
      idleWaves: [...a.seenWaves].filter(k => !a.waves.has(k)).length,
    }
  }).sort((x, y) => y.spend - x.spend || y.completes - x.completes || x.name.localeCompare(y.name))

  const idle = idleAcc
    .map(a => ({ id: a.id, name: a.name ?? UNNAMED }))
    .sort((x, y) => x.name.localeCompare(y.name))

  /* ── the two checks (rule 5, and the file header on what each is worth) ── */
  // Shape: the Panel line of the cost breakdown, survey by survey through
  // spendOf and the shell's index — the same purchases, summed the other way.
  const panelLine = costBreakdown(projects, input.blasts, input.suppliers, input.costs, input.ix).panel
  // The ids: which panels the INDEX says bought completes on these surveys.
  const expectedIds = new Set<string>()
  for (const p of projects) {
    for (const s of input.ix.suppliers.get(p.id) ?? []) {
      if (Number(s.n_collected ?? 0) > 0) expectedIds.add(s.supplier_id ?? NO_SUPPLIER)
    }
  }
  const reconciliation = reconcile({
    rows: rows.map(r => ({ id: r.id, code: r.name, contribution: r.spend })),
    expectedTotal: panelLine,
    expectedIds: [...expectedIds],
  })
  // Outside: the spend the database itself keeps, on the surveys here that
  // bought from panels and nothing else. The only check that can really fail.
  const stored = storedCheck(projects, input.blasts, input.suppliers, input.costs, input.ix, input.blastsLoaded ?? true)
  const check = {
    ok: reconciliation.ok && stored.mismatches.length === 0,
    verified: stored.checked > 0 && stored.mismatches.length === 0,
    text: checkText(reconciliation, rows.length, stored),
  }

  /* ── totals and words ── */
  const surveysWithPanel = new Set<string>()
  const allWaves = new Set<string>()
  for (const s of inView) {
    if (Number(s.n_collected ?? 0) > 0) { surveysWithPanel.add(s.project_id); allWaves.add(waveKey(s)) }
  }
  const completes = listed.reduce((t, a) => t + a.completes, 0)
  const unpricedCompletes = listed.reduce((t, a) => t + a.unpriced, 0)
  const unpricedPanels = listed.filter(a => a.unpriced > 0).length
  const topN = Math.min(TOP_PANELS, rows.length)
  const topSpend = rows.slice(0, topN).reduce((t, r) => t + r.spend, 0)
  const top = { count: topN, spend: topSpend, share: spendAll !== 0 ? topSpend / spendAll : null }

  const total: PanelsModel['total'] = {
    spend: spendAll,
    completes,
    pricedCompletes: pricedAll,
    unpricedCompletes,
    unpricedPanels,
    cpc: cpcAll,
    surveys: surveysWithPanel.size,
    surveysInView: projects.length,
    waves: allWaves.size,
    above,
    comparedWaves,
    spreadWaves,
    leverAbove,
  }

  const verdict = verdictOf(rows, total, top)
  const leverNote = leverNoteOf(total)
  const note =
    'Clients pay per study, not per panel, so client price is not split by panel. ' +
    (completes > 0
      ? `How many of these ${fmtNum(completes)} completes from ${fmtNum(rows.length)} panel${rows.length === 1 ? '' : 's'} passed QA is recorded per study, not per panel, `
      : 'QA-passed respondents are recorded per study, not per panel, ') +
    'so there is no per-panel cost per qualified respondent yet.'
  const floorNote = unpricedCompletes > 0
    ? `Spend is a floor: ${fmtNum(unpricedCompletes)} completes from ${fmtNum(unpricedPanels)} panel${unpricedPanels === 1 ? '' : 's'} have no price recorded, so their cost is missing, not zero.`
    : null

  /* ── the chart ── */
  // One leftover panel is drawn as itself: an "Other 1 panels" bar hides a
  // name to save no space.
  const fold = rows.length > CHART_BARS + 1
  const chart: ChartBar[] = (fold ? rows.slice(0, CHART_BARS) : rows).map(r => ({ id: r.id, name: r.name, spend: r.spend, share: r.share }))
  if (fold) {
    const rest = rows.slice(CHART_BARS)
    const spend = rest.reduce((t, r) => t + r.spend, 0)
    chart.push({
      id: null,
      name: `Other ${fmtNum(rest.length)} panels`,
      spend,
      share: spendAll !== 0 ? spend / spendAll : null,
    })
  }

  /* ── the drilldown ── */
  const pick = input.selected ? rows.find(r => r.id === input.selected) ?? null : null
  const selectedMissing = !!input.selected && !pick
  const selectedName = pick?.name ?? (input.selected
    ? input.suppliers.find(s => (s.supplier_id ?? NO_SUPPLIER) === input.selected && s.suppliers?.name)?.suppliers?.name ?? null
    : null)
  let selected: SupplierDetail | null = null
  if (pick) {
    const mine = inView.filter(s => (s.supplier_id ?? NO_SUPPLIER) === pick.id && Number(s.n_collected ?? 0) > 0)
    const waveRows: WaveRow[] = mine.map((s, i) => {
      const k = waveKey(s)
      const launch = s.launch_id ? launchById.get(s.launch_id) : undefined
      const p = byId.get(s.project_id)!
      const got = Number(s.n_collected ?? 0)
      const cpi = finite(s.cpi)
      const basis: WaveRow['basis'] = !bought(s) ? 'no-price' : cheapestOf.has(k) ? 'compared' : 'only-panel'
      const cheapest = basis === 'only-panel' ? Number(s.cpi) : cheapestOf.get(k) ?? null
      return {
        key: s.id ?? `${k}|${i}`,
        projectId: s.project_id,
        code: p.project_code,
        launchId: s.launch_id ?? null,
        label: launch?.label ?? null,
        // A row with no launch is its own survey's wave, so the survey's own
        // launch date stands in; a launch with no date stays undated.
        launchDate: s.launch_id ? (launch?.launch_date ?? null) : (p.launch_date ?? null),
        country: countryAsRecorded(launch?.note),
        note: launch?.note ?? null,
        cpi,
        cheapest,
        panels: panelsIn.get(k) ?? 0,
        basis,
        completes: got,
        cost: Number(s.cpi ?? 0) * got,
        above: extraOf.get(s) ?? 0,
      }
    }).sort((a, b) => b.above - a.above || String(b.launchDate ?? '').localeCompare(String(a.launchDate ?? '')))
    const totals = {
      completes: waveRows.reduce((t, w) => t + w.completes, 0),
      cost: waveRows.reduce((t, w) => t + w.cost, 0),
      above: waveRows.reduce((t, w) => t + w.above, 0),
    }
    const sharedWaves = new Set(waveRows.filter(w => w.basis === 'compared').map(w => w.launchId ?? `project:${w.projectId}`)).size
    selected = { row: pick, waves: waveRows, totals, sharedWaves, verdict: detailVerdict(pick, waveRows, sharedWaves) }
  }

  /* ── the price-drift heatmap: launch month × panel ── */
  const heatIds = rows.slice(0, HEATMAP_ROWS).map(r => r.id)
  if (pick && !heatIds.includes(pick.id)) heatIds.push(pick.id)
  // The picked panel on the top row, so the eye finds it first.
  const heatOrder = pick ? [pick.id, ...heatIds.filter(id => id !== pick.id)] : heatIds
  const heatSet = new Set(heatOrder)
  const cellAcc = new Map<string, { row: string; col: string; n: number; priced: number; pricedSpend: number; countries: Set<string> }>()
  const monthsSeen = new Set<string>()
  for (const s of inView) {
    const id = s.supplier_id ?? NO_SUPPLIER
    const got = Number(s.n_collected ?? 0)
    if (!heatSet.has(id) || !(got > 0)) continue
    const launch = s.launch_id ? launchById.get(s.launch_id) : undefined
    const date = s.launch_id ? (launch?.launch_date ?? null) : (byId.get(s.project_id)?.launch_date ?? null)
    const col = date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : UNDATED
    monthsSeen.add(col)
    const key = `${id}\u0000${col}`
    let c = cellAcc.get(key)
    if (!c) { c = { row: id, col, n: 0, priced: 0, pricedSpend: 0, countries: new Set() }; cellAcc.set(key, c) }
    c.n += got
    const cpi = finite(s.cpi)
    if (cpi != null) { c.priced += got; c.pricedSpend += cpi * got }
    const country = countryAsRecorded(launch?.note)
    if (country) c.countries.add(country)
  }
  const nameOf = new Map(rows.map(r => [r.id, r.name]))
  const months = [...monthsSeen].filter(m => m !== UNDATED).sort()
  if (monthsSeen.has(UNDATED)) months.push(UNDATED)
  const heatmap: PanelsModel['heatmap'] = {
    rows: heatOrder.map(id => ({
      key: id,
      label: nameOf.get(id) ?? UNNAMED,
      description: pick && id === pick.id ? 'The panel you picked' : undefined,
    })),
    columns: months.map(m => ({
      key: m,
      label: monthLabel(m),
      shortLabel: m === UNDATED ? 'Und.' : monthLabel(m).slice(0, 3),
    })),
    cells: [...cellAcc.values()].map(c => ({
      row: c.row,
      col: c.col,
      value: c.priced > 0 ? c.pricedSpend / c.priced : null,
      weight: c.n,
      countries: [...c.countries].sort(),
    })),
  }

  return {
    rows, idle, total, top, panelLine, reconciliation, stored, check, chart, verdict, note, floorNote, leverNote,
    selected, selectedMissing, selectedName, heatmap,
  }
}

/**
 * The reconcile strip's words: what was checked, against what, and how much
 * that is worth.
 *
 * The first sentence is the shape check against the spend breakdown. It does
 * NOT say "matches", because the two count the same purchases — it says they
 * are the same purchases summed the other way round, which is all it proves.
 * The second sentence is the outside check against the database's own stored
 * spend, and it names how many surveys it could cover, so a reader can see when
 * it covered none. drill.ts reconcileText speaks of surveys; these rows are
 * panels, so the same checks are worded for panels here.
 */
function checkText(r: Reconciliation, count: number, stored: StoredCheck): string {
  const parts: string[] = []
  if (r.ok) {
    parts.push(count === 0
      ? `No panel purchases in this view, and the Panel (PureSpectrum) line of the spend breakdown is ${money(r.expectedTotal ?? 0)} too.`
      : `The ${fmtNum(count)} panel${count === 1 ? '' : 's'} below ${count === 1 ? 'adds' : 'add'} up to ${money(r.rowSum)} — the same purchases the Panel (PureSpectrum) line of the spend breakdown counts, summed study by study instead of panel by panel.`)
  } else {
    if (!r.sumAgrees && r.expectedTotal != null) {
      parts.push(`These panels add up to ${money(r.rowSum)} but the Panel (PureSpectrum) line of the spend breakdown says ${money(r.expectedTotal)} — a gap of ${money(r.gap ?? 0)}.`)
    }
    if (r.missingIds.length) {
      parts.push(`${fmtNum(r.missingIds.length)} panel${r.missingIds.length === 1 ? '' : 's'} that bought on these studies ${r.missingIds.length === 1 ? 'is' : 'are'} missing from the list.`)
    }
    if (r.extraIds.length) {
      parts.push(`${fmtNum(r.extraIds.length)} panel${r.extraIds.length === 1 ? '' : 's'} listed here ${r.extraIds.length === 1 ? 'is' : 'are'} not in the spend breakdown.`)
    }
    if (!r.missingIds.length && !r.extraIds.length && r.rowCount !== r.expectedCount) parts.push('A panel appears more than once.')
  }
  const outside = storedText(stored, count)
  if (outside) parts.push(outside)
  if (!r.ok || stored.mismatches.length > 0) parts.push('Do not rely on either number until this is explained.')
  return parts.join(' ')
}

/** The outside check's sentence — including the two ways it can fail to run,
 *  which are different and must not both read as "nothing to check". */
function storedText(s: StoredCheck, count: number): string {
  if (s.unavailable) {
    return 'The blast rows did not load, so which studies bought from panels alone is not known and the total could not be checked against the spend the database recorded.'
  }
  if (s.mismatches.length > 0) {
    const named = s.mismatches.slice(0, 4).map(m => m.code ?? '(no code)').join(', ')
    const rest = s.mismatches.length > 4 ? `, and ${fmtNum(s.mismatches.length - 4)} more` : ''
    return `${fmtNum(s.mismatches.length)} of the ${fmtNum(s.checked)} ${s.checked === 1 ? 'study' : 'studies'} here that bought only from panels ` +
      `${s.mismatches.length === 1 ? 'does' : 'do'} not agree with the spend the database recorded for ${s.mismatches.length === 1 ? 'it' : 'them'} (${named}${rest}).`
  }
  if (s.checked > 0) {
    const skipped = s.skipped > 0
      ? ` ${fmtNum(s.skipped)} more ${s.skipped === 1 ? 'records' : 'record'} no spend of ${s.skipped === 1 ? 'its' : 'their'} own and ${s.skipped === 1 ? 'was' : 'were'} left out.`
      : ''
    return `On the ${fmtNum(s.checked)} ${s.checked === 1 ? 'study' : 'studies'} here that bought only from panels, it also agrees with the spend the database recorded for ${s.checked === 1 ? 'it' : 'them'}, which nothing on this page computes.${skipped}`
  }
  if (count === 0) return ''
  // Nothing was checked. Say WHICH kind of nothing: no survey qualified, or
  // the ones that did carry no spend of their own to check against.
  return s.skipped > 0
    ? `None of the ${fmtNum(s.skipped)} ${s.skipped === 1 ? 'study' : 'studies'} here that bought only from panels records a spend of its own, so nothing outside this page confirmed the total.`
    : 'No study here bought from panels alone, so nothing outside this page could confirm the total.'
}

/**
 * Where this card and the Per respondent tab differ, in one sentence.
 *
 * Per respondent's "paid above the cheapest" lever counts delivered AND live
 * work; Results counts delivered work only. Same rule, different surveys, so
 * the reader who clicked "See panels →" meets a smaller number. Say so rather
 * than let them find it.
 */
function leverNoteOf(t: PanelsModel['total']): string | null {
  if (t.leverAbove == null) return null
  // Under a dollar apart is rounding, and two identical figures on screen with
  // a sentence between them explaining the difference reads as a mistake.
  if (Math.abs(t.leverAbove - t.above) < 1) return null
  return `This card counts finished work only, so ${money(t.above)} was paid above the cheapest panel here. ` +
    `Per respondent counts live work as well and shows ${money(t.leverAbove)} for the same rule.`
}

/** The card's closing sentence: what the spread was, and what to do (rule 7). */
function verdictOf(rows: PanelRow[], t: PanelsModel['total'], top: PanelsModel['top']): string {
  if (rows.length === 0) {
    return 'No panel purchases in this view. Widen the date range or clear the route filter to see panel spend.'
  }
  const lead = rows.length > TOP_PANELS
    ? `The top ${fmtNum(top.count)} of ${fmtNum(rows.length)} panels carry ${pctText(top.share)} of the ${money(t.spend)} spent on panels.`
    : rows.length === 1
      ? `One panel, ${rows[0].name}, carries all ${money(t.spend)} of panel spend.`
      : `${fmtNum(rows.length)} panels share ${money(t.spend)} of panel spend; the largest, ${rows[0].name}, carries ${pctText(rows[0].share)}.`
  if (t.above > 0) {
    return `${lead} ${money(t.above)} (${pctText(t.spend !== 0 ? t.above / t.spend : null)} of panel spend) was paid above the cheapest panel in the same wave, ` +
      `on ${fmtNum(t.spreadWaves)} of the ${fmtNum(t.comparedWaves)} waves that bought from two or more panels. ` +
      'Fill each wave from the cheapest panel that is delivering before topping up from dearer ones.'
  }
  if (t.comparedWaves > 0) {
    return `${lead} Every wave that bought from two or more panels paid them the same price, so nothing was paid above the cheapest. ` +
      'Keep filling each wave from the cheapest panel first.'
  }
  return `${lead} No wave here bought from more than one panel, so there is no within-wave price to compare. ` +
    'Pick a panel to see its waves and how its price moved.'
}

/** The drilldown's closing sentence: where this panel cost extra, and what to
 *  check before buying from it again. */
function detailVerdict(row: PanelRow, waves: WaveRow[], shared: number): string {
  const name = row.name
  const wavesText = `${fmtNum(row.waves)} wave${row.waves === 1 ? '' : 's'}`
  if (row.above > 0) {
    const worst = waves[0] // sorted by cost above the cheapest, largest first
    // Labels are recorded as "52470052" or "PS 52470052"; say "PS Survey#" once.
    const survey = worst.label?.replace(/^PS\s*/i, '').trim()
    const where = survey ? `${worst.code ?? 'a study'} (PS Survey# ${survey})` : (worst.code ?? 'one study')
    return `${name} was paid ${money(row.above)} above the cheapest panel on ${fmtNum(row.aboveWaves)} of its ${wavesText}; ` +
      `the largest gap was ${money(worst.above)} on ${where}. ` +
      `Before topping up from ${name} again, check whether the cheaper panel in those waves still had room.`
  }
  if (shared > 0) {
    return `${name} was never paid above the cheapest panel in the ${fmtNum(shared)} wave${shared === 1 ? '' : 's'} it shared with other panels. ` +
      'Keep it in the first fill of those waves.'
  }
  return `${name} never shared a wave with another priced panel across its ${wavesText}, so there is nothing to compare within a wave. ` +
    'Compare its price with other panels month by month in the chart above.'
}

/** A CPI for a table cell: cents always, "—" when missing. */
export const cpiText = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : money2(v))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-07-14" → "14 Jul 2026"; "no date" when there is none. Read straight
 *  off the string, so no time zone can move it a day. */
export function launchDateText(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!m) return 'no date'
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}
