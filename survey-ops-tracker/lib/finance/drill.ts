/**
 * The drill-down contract, and the check that makes it honest.
 *
 * A drill lists the surveys behind a figure and says, in a strip at the top,
 * whether they add back to it. The old strip compared the rows with THEMSELVES:
 * the lever drill took the lever's survey ids, kept only the ones that also sat
 * in the filtered rows, and then totalled those same rows — so with route=panel
 * "Freeze the bid, $0–$65,411" opened onto "Σ of the 0 rows below = $0 ✓" in
 * green, and in the default view it silently dropped the in-flight surveys,
 * which are exactly the ones where acting still saves money. A green tick that
 * cannot turn red is worse than no tick.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Every spec carries two expectations, and NEITHER may be derived from the rows
 * being checked:
 *
 *   expectedTotal  computed by a DIFFERENT function from the one that built the
 *                  rows — the aggregate behind the tile (marginOf behind the
 *                  margin drill), or `spendOfIds` below, which sums the raw
 *                  child rows by id instead of going survey by survey.
 *   expectedIds    the ids the figure itself counted (Lever.ids, Margin.ids,
 *                  Cpqr.ids) — so a row the drill dropped, or one it invented,
 *                  is named.
 *
 * `reconcile` compares both and says what disagrees. It is pure, so the page,
 * the tests and a future connector tool all run the same check.
 */

import type { FinBlast, FinCost, FinSupplier } from './hub'
import { fmtNum } from '@/lib/utils/number'

/** One row of a drill. `contribution` is what the row adds to the headline, in
 *  the headline's unit — the strip sums these. */
export interface DrillRow {
  id: string
  code: string | null
  contribution: number
  [k: string]: unknown
}

/** A column, as data: a header, the (i) text, and how to read the cell. The
 *  component decides how to draw it. */
export interface DrillColumn<R extends DrillRow = DrillRow> {
  key: string
  header: string
  /** One-sentence explainer for the (i) beside the header. */
  tip?: string
  /** Right-aligned and tabular. */
  num?: boolean
  value: (row: R) => string | number | null
}

export interface DrillSpec<R extends DrillRow = DrillRow> {
  key: string
  title: string
  /** The population sentence, from lib/finance/filters.ts `describe()`. */
  population: string
  columns: DrillColumn<R>[]
  rows: R[]
  /** The headline the rows must add back to, computed INDEPENDENTLY of `rows`.
   *  null when the figure is not a sum of the rows (a lever's saving range) —
   *  then only the ids are checked, and the strip says so. */
  expectedTotal: number | null
  /** The ids the figure counted. */
  expectedIds: string[]
  totalLabel: string
  format: 'money' | 'money2' | 'number'
}

export interface Reconciliation {
  rowSum: number
  expectedTotal: number | null
  /** |rowSum − expectedTotal|, or null when there is no total to compare. */
  gap: number | null
  sumAgrees: boolean
  rowCount: number
  expectedCount: number
  /** Ids the figure counted that the drill does not show. */
  missingIds: string[]
  /** Rows the drill shows that the figure never counted. */
  extraIds: string[]
  idsAgree: boolean
  /** Both checks pass. */
  ok: boolean
}

/** A drift of under a cent is float rounding; anything larger means the drill
 *  and the figure describe different surveys. */
export const CENT = 0.01

export function reconcile(spec: Pick<DrillSpec, 'rows' | 'expectedTotal' | 'expectedIds'>): Reconciliation {
  const rowSum = spec.rows.reduce((t, r) => t + (Number.isFinite(r.contribution) ? r.contribution : 0), 0)
  const gap = spec.expectedTotal == null ? null : Math.abs(rowSum - spec.expectedTotal)
  // The epsilon keeps an exact one-cent gap red: 10.01 − 10 is 0.00999…98 in
  // floating point, which a bare `< CENT` would wave through as green.
  const sumAgrees = gap == null || gap < CENT - 1e-9
  const want = new Set(spec.expectedIds)
  const have = new Set(spec.rows.map(r => r.id))
  const missingIds = [...want].filter(id => !have.has(id))
  const extraIds = [...have].filter(id => !want.has(id))
  // A duplicated row is its own kind of wrong: the ids match as sets but the
  // count does not, and the sum is inflated by the copy.
  const idsAgree = missingIds.length === 0 && extraIds.length === 0 && spec.rows.length === want.size
  return {
    rowSum, expectedTotal: spec.expectedTotal, gap, sumAgrees,
    rowCount: spec.rows.length, expectedCount: want.size,
    missingIds, extraIds, idsAgree,
    ok: sumAgrees && idsAgree,
  }
}

/**
 * Recorded spend on a set of surveys, summed straight off the raw child rows.
 *
 * INDEPENDENT of spendOf on purpose: it never groups by survey and never builds
 * an index, it filters every blast, panel row and cost line by membership and
 * adds. The formula is the same (it has to be — it is the same money), but the
 * code path is not, so a drill whose rows were built survey-by-survey through
 * spendOf can be checked against it without grading its own homework.
 */
export function spendOfIds(
  ids: Iterable<string>, blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): number {
  const set = new Set(ids)
  let t = 0
  for (const b of blasts) {
    if (!set.has(b.project_id)) continue
    t += Number(b.bid ?? 0) * Number(b.completes ?? 0)
    if (b.channel !== 'email') t += Number(b.people ?? 0) * Number(b.cost_per_send ?? 0)
  }
  for (const s of suppliers) {
    if (set.has(s.project_id)) t += Number(s.cpi ?? 0) * Number(s.n_collected ?? 0)
  }
  for (const c of costs) {
    if (set.has(c.project_id)) t += Number(c.amount ?? 0)
  }
  return t
}

/**
 * One route's recorded spend on a set of surveys, summed straight off the raw
 * rows — the independent total a CPQR card's drill is checked against.
 *
 * The card and its drill rows both come from cpqr.ts `contributingLegs`, so
 * checking one against the other could never turn red: an admission bug there
 * would move both sides together. This never calls legsOf, spendOf or
 * contributingLegs. It decides a survey's routes from which raw rows it holds:
 *
 *   one route   everything the survey spent belongs to it, flat cost lines
 *               included (there is nowhere else for them to go);
 *   both        only that route's own field rows, plus the flat cost lines
 *               tagged with that route (117).
 *
 * A mixed survey with an untagged cost line never reaches a CPQR card (legsOf
 * refuses to split it), so that case needs no rule here — and if a bug ever let
 * one through, the untagged line would be missing from this total and the strip
 * would say so.
 */
export function routeSpendOfIds(
  ids: Iterable<string>, route: 'blast' | 'panel',
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): number {
  const set = new Set(ids)
  const hasBlast = new Set(blasts.filter(b => set.has(b.project_id)).map(b => b.project_id))
  const hasPanel = new Set(suppliers.filter(s => set.has(s.project_id)).map(s => s.project_id))
  const mixed = (id: string) => hasBlast.has(id) && hasPanel.has(id)
  let t = 0
  if (route === 'blast') {
    for (const b of blasts) {
      if (!set.has(b.project_id)) continue
      t += Number(b.bid ?? 0) * Number(b.completes ?? 0)
      if (b.channel !== 'email') t += Number(b.people ?? 0) * Number(b.cost_per_send ?? 0)
    }
  } else {
    for (const s of suppliers) {
      if (set.has(s.project_id)) t += Number(s.cpi ?? 0) * Number(s.n_collected ?? 0)
    }
  }
  for (const c of costs) {
    if (!set.has(c.project_id)) continue
    // Single-route: the line belongs to the only route there is — the one
    // asked about, provided the survey is on it at all.
    const onRoute = route === 'blast' ? hasBlast.has(c.project_id) : hasPanel.has(c.project_id)
    if (!mixed(c.project_id)) { if (onRoute) t += Number(c.amount ?? 0); continue }
    if (c.route === route) t += Number(c.amount ?? 0)
  }
  return t
}

/** The strip's words, from the reconciliation. Plain English, and red only for
 *  a real disagreement. */
export function reconcileText(
  r: Reconciliation, fmt: (n: number) => string,
): { ok: boolean; text: string } {
  const n = fmtNum(r.rowCount)
  const one = r.rowCount === 1
  if (r.ok) {
    return {
      ok: true,
      text: r.expectedTotal == null
        ? (one ? 'The one study this figure counted is listed below.' : `All ${n} studies this figure counted are listed below.`)
        : (one
          ? `The row below adds up to ${fmt(r.rowSum)}, which matches the figure.`
          : `The ${n} rows below add up to ${fmt(r.rowSum)}, which matches the figure.`),
    }
  }
  const parts: string[] = []
  if (!r.sumAgrees && r.expectedTotal != null) {
    parts.push(`These rows add up to ${fmt(r.rowSum)} but the figure says ${fmt(r.expectedTotal)} — a gap of ${fmt(r.gap ?? 0)}.`)
  }
  if (r.missingIds.length) parts.push(`${fmtNum(r.missingIds.length)} of the studies the figure counted are missing from this list.`)
  if (r.extraIds.length) parts.push(`${fmtNum(r.extraIds.length)} rows here were not in the figure.`)
  if (!r.missingIds.length && !r.extraIds.length && r.rowCount !== r.expectedCount) {
    parts.push('A study appears more than once.')
  }
  parts.push('Do not rely on either number until this is explained.')
  return { ok: false, text: parts.join(' ') }
}
