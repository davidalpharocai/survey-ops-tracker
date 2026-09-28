import type { DrillQuery, InsightsModel } from '@/lib/insights/model'

/**
 * What a clicked tile, column or bar asks the drill panel to show. `expected`
 * is the figure the mark itself displayed, taken from the model's aggregate;
 * the panel picks its rows with `query` on its own and says, in the panel, if
 * the two ever disagree — so a drill can never quietly list a different set.
 */
export interface DrillRequest {
  key: string
  title: string
  /** Which surveys, in words: "Delivered · Aug 2026 · PS". */
  population: string
  query: DrillQuery
  expected: number
  /** "on the chart", "in the tile", … — for the agreement line. */
  expectedWhere: string
  /** Optional "open these in the List" link, when the List can show the same set. */
  listHref?: string
  listNote?: string
  /** Optional "filter this page to …" link. */
  filterHref?: string
  filterLabel?: string
}

export type OpenDrill = (req: DrillRequest) => void

/** The type / captain / account filters as a population suffix: " · PS · Captain: Alex". */
export const filterSuffix = (m: InsightsModel) => (m.filterWords.length ? ' · ' + m.filterWords.join(' · ') : '')

/**
 * The on-hold or still-scoping surveys behind a count. The In-flight tile and
 * the "Right now" header both show these counts, so both build the request
 * here and open the same list. (The List has no status filter, so there is no
 * "Open these in the List" for them.)
 */
export function sideBucketRequest(m: InsightsModel, cls: 'hold' | 'scoping', expectedWhere: string): DrillRequest {
  const hold = cls === 'hold'
  return {
    key: `now-${cls}`,
    title: hold ? 'On hold' : 'Still scoping',
    population: `${hold ? 'On hold' : 'Still being scoped'} · right now${filterSuffix(m)}`,
    query: { kind: 'open', cls },
    expected: hold ? m.now.hold : m.now.scoping,
    expectedWhere,
  }
}
