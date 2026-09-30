/**
 * The words at the top of every file the finance page writes, and the facts in
 * its audit row — built from ONE `describe()` call, so the header a recipient
 * reads and the row the audit log keeps cannot disagree.
 *
 * The finance spec asks the header to record the as-of time, every filter
 * (scoping included) and the row count. describe() gives the tab, the classes,
 * the date, account and route; this adds when the data was read, how many
 * surveys were in view, the Hold bucket when the tab keeps one, and whether
 * scoping work is in the file (it never is on these tabs — unsold work is not
 * a result — and the header says so rather than leaving it to be guessed).
 */

import { describe, TAB_RULES, type FinanceFilter, type FinanceTab } from '@/lib/finance/filters'
import type { ExportAudit } from '@/lib/finance/exportFinance'
import { fmtNum } from '@/lib/utils/number'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "27 Sep 2026, 6:40 PM Eastern" — when the page read the data, written the
 *  way the rest of the page writes dates (day, month, year). */
export function asOfText(loadedAt: string): string {
  const d = new Date(loadedAt)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const [y, m, day] = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).split('-').map(Number)
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
  return `${day} ${MONTHS[m - 1]} ${y}, ${time} Eastern`
}

export interface ExportContextInput {
  filter: FinanceFilter
  tab: FinanceTab
  today: string
  /** Rows in THIS file. */
  rows: number
  accountName: string | null
  /** load.integrity.loadedAt */
  loadedAt: string
  /** The tab's population — the surveys on screen. */
  surveysInView: number
  /** The side bucket (Hold on This week), listed apart from the totals. */
  onHold: number
  /** 'finance-results', 'finance-drill' … */
  route: string
}

export function exportContextFor(i: ExportContextInput): { header: string[]; audit: ExportAudit } {
  const rule = TAB_RULES[i.tab]
  const asOf = asOfText(i.loadedAt)
  const d = describe(i.filter, { tab: i.tab, today: i.today, count: i.rows, accountName: i.accountName, asOf })
  const scoping = rule.classes.includes('scoping')
  const header = [
    ...d.header,
    `Studies in view: ${fmtNum(i.surveysInView)}`,
    ...(rule.side.length ? [`On hold, listed separately and never in the totals: ${fmtNum(i.onHold)}`] : []),
    `Scoping work: ${scoping ? 'included' : 'not included'}`,
  ]
  return {
    header,
    audit: {
      route: i.route,
      filters: {
        ...d.audit,
        as_of: i.loadedAt,
        surveys_in_view: i.surveysInView,
        ...(rule.side.length ? { on_hold_listed: i.onHold } : {}),
        scoping_included: scoping,
      },
      // The finance page is gated to finance holders, and its files carry
      // client prices, revenue and budgets. Recorded as restricted whatever
      // the columns turn out to be: the server can only revise this upwards,
      // and the direction that matters is "restricted data left the building".
      includedRestricted: true,
    },
  }
}
