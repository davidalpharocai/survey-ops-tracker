import {
  CHECKS, GROUP_ORDER, SEVERITY_ORDER,
  type CheckGroup, type CheckResult, type CleanupReport,
} from '@/lib/admin/cleanup'

/**
 * How the tiles rank themselves, and what the headline counts.
 *
 * Pure, and in its own file, because the ordering is the whole design: David
 * asked for "tiles with numbers … the idea is that every tile should be 0", so
 * the page has to put the work at the top and let the finished work sink and
 * stay visibly finished.
 */

/** What a tile is: a measurement that failed, work to do, or done. */
export type TileState = 'blocked' | 'work' | 'clear'

export function tileState(res: CheckResult): TileState {
  if (!res.available) return 'blocked'
  return res.count + res.waveCount > 0 ? 'work' : 'clear'
}

const STATE_RANK: Record<TileState, number> = { blocked: 0, work: 1, clear: 2 }

/**
 * Worst first.
 *
 *   1. What we could not measure. An unknown outranks any known number: a
 *      blocked tile is the only one that can be hiding anything.
 *   2. Work to do, most damaging first — severity, then size. Severity leads
 *      because 3 surveys with no salesperson are invisible to the person who
 *      owns them, and 100 missing submitted dates only skew an average.
 *   3. Everything already at zero, alphabetically, so a settled tile keeps its
 *      place from one visit to the next and the eye learns to skip that band.
 */
export function orderResults(results: CheckResult[]): CheckResult[] {
  return [...results].sort((a, b) =>
    STATE_RANK[tileState(a)] - STATE_RANK[tileState(b)] ||
    SEVERITY_ORDER.indexOf(a.check.severity) - SEVERITY_ORDER.indexOf(b.check.severity) ||
    (b.count + b.waveCount) - (a.count + a.waveCount) ||
    a.check.label.localeCompare(b.check.label))
}

export interface Headline {
  /** Tiles reading zero. */
  clear: number
  /** Tiles with work behind them. */
  work: number
  /** Tiles whose source did not load — counted apart, never as clear. */
  blocked: number
  total: number
  /** Surveys (not waves) failing at least one check. */
  surveys: number
  /** Repeat waves failing at least one check, counted the same way. */
  waves: number
}

/** The one number David is driving, plus the two that qualify it. */
export function headline(report: CleanupReport): Headline {
  const by = { clear: 0, work: 0, blocked: 0 }
  for (const res of report.results) by[tileState(res)]++
  const waves = new Set<string>()
  for (const res of report.results) for (const w of res.waves) waves.add(w.id)
  return {
    ...by,
    total: report.results.length,
    surveys: report.surveysNeedingWork,
    waves: waves.size,
  }
}

/** Every group that has at least one check, in the model's order. Used for the
 *  filter chips, so a group can never appear with nothing behind it. */
export function groupsPresent(): CheckGroup[] {
  return GROUP_ORDER.filter(g => CHECKS.some(c => c.group === g))
}
