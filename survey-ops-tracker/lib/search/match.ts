/**
 * Ranking and query handling shared by every search surface.
 *
 * David, 2026-09-23: "if i type a word/characters in the search and just press
 * enter … it brings to a search page that shows where that result came up in
 * grouped by object … ive seen salesforce do this."
 *
 * ── WHY RANKING LIVES HERE AND NOT IN EACH CALLER ───────────────────────────
 * There were four independent implementations of "does this row match" before
 * this file: NavSearch, SalesSearch, HomeSearch and SalesPipeline. Three of them
 * ranked nothing at all — first row in table order won — and the fourth had its
 * own private ladder. Typing a project code into one box put the exact match
 * first and into another put it fourth. One ladder, used everywhere.
 */

/** The ladder. Lower is better, and the numbers are spaced so a caller can
 *  offset a whole object type without colliding with the next rung. */
export const RANK = {
  exact: 0,
  prefix: 10,
  wordStart: 20,
  substring: 30,
  miss: Number.MAX_SAFE_INTEGER,
} as const

export function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim()
}

/**
 * How well one field matches, on the ladder above.
 *
 * `wordStart` is the rung that matters in practice here: survey names are long
 * and the useful word is rarely the first one. "wealth" should rank
 * "Wealth Manager Data" above "Q3 private wealth follow-up", but both above a
 * row that merely contains the letters mid-word.
 */
export function scoreField(field: string | null | undefined, needle: string): number {
  const f = normalize(field)
  const n = normalize(needle)
  if (!f || !n) return RANK.miss
  if (f === n) return RANK.exact
  if (f.startsWith(n)) return RANK.prefix
  // A word boundary anywhere in the field.
  if (new RegExp(`\\b${escapeRegExp(n)}`).test(f)) return RANK.wordStart
  if (f.includes(n)) return RANK.substring
  return RANK.miss
}

/** The best rung any of the fields reaches. */
export function scoreRow(fields: (string | null | undefined)[], needle: string): number {
  let best = RANK.miss
  for (const f of fields) {
    const s = scoreField(f, needle)
    if (s < best) best = s
    if (best === RANK.exact) break
  }
  return best
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A PostgREST `or=` filter over several columns.
 *
 * THE VALUE IS DOUBLE-QUOTED, which is the whole point of this helper. The
 * or-filter is a COMMA-SEPARATED list, so a needle containing a comma — "Smith,
 * John" — silently splits into two half-filters and returns the wrong rows.
 * Parentheses do the same. Quoting the value makes PostgREST treat it as one
 * literal; the backslash escaping below is what keeps a quote in the needle from
 * closing it early.
 */
export function ilikeOr(columns: string[], needle: string): string {
  const pattern = `%${needle}%`
  const esc = pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return columns.map(c => `${c}.ilike."${esc}"`).join(',')
}

/**
 * Is this query worth running?
 *
 * Two characters, same as both dropdowns already used. One character matches
 * most of the book and answers nothing, and an empty box must not return "all
 * 466 surveys" dressed up as a search result.
 */
export const MIN_QUERY = 2

export function isSearchable(q: string | null | undefined): boolean {
  return normalize(q).length >= MIN_QUERY
}

/**
 * A window of `text` around the first occurrence of `needle`.
 *
 * Notes and email activity are the objects where "where did that come up"
 * actually gets answered, and a 4,000-character email body rendered as a
 * subtitle answers nothing. This returns the matching phrase in context with
 * ellipses on whichever side was cut, so the row shows the sentence the hit is
 * in rather than the opening line of the message.
 */
export function excerpt(text: string | null | undefined, needle: string, width = 120): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const i = t.toLowerCase().indexOf(normalize(needle))
  if (i < 0) return t.length > width ? t.slice(0, width).trimEnd() + '…' : t
  // Centre the window on the hit, then clamp to the ends of the string so a
  // match near the start does not render a leading ellipsis over nothing.
  const half = Math.max(0, Math.floor((width - needle.length) / 2))
  const start = Math.max(0, i - half)
  const end = Math.min(t.length, start + width)
  return (start > 0 ? '…' : '') + t.slice(start, end).trim() + (end < t.length ? '…' : '')
}
