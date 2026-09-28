/**
 * A small finance book for the Results tab's tests — lib/finance/results.test.ts
 * and the connector's lib/mcp/financeResults.test.ts read the SAME book, so the
 * page's model and the tool are held to one set of hand-computed figures.
 *
 * It carries every shape the brief names (Scoping, Hold, a placeholder with and
 * without data, a $0 price, a partial segment N actual, no date, both routes)
 * plus the ones that have broken a figure before: over-delivery past a sold
 * range, a loss, over budget but still in profit, priced work with no cost,
 * priced work with no delivered N, unpriced spend, a recovered reward, an SMS
 * blast, cancelled and archived work, and months before costs were recorded.
 *
 * Hand-computed, default view (since 1 Jun 2026, all accounts, all routes):
 *   margin set  31 surveys
 *   client price $86,540   our cost $46,021   we keep $40,519
 *   paid work   30 surveys, $86,540 − $45,361 = $41,179
 *   delivered spend in view $50,371 (the margin set's $46,021, $2,100 with no
 *   price on 1 survey, $2,250 on 1 priced survey with no delivered N)
 */

import type { FinContact, FinProject, FinSegment } from './hub'
import type { FinanceLoad, FinanceTable, FinCostFull, FinSupplierFull } from './load'
import type { FinBlastDated } from './savings'

export const TODAY = '2026-09-24'

const P = (o: Partial<FinProject> & { id: string }): FinProject => ({
  project_code: o.id.toUpperCase(), project_name: 'Survey', client: 'label', client_id: 'bam',
  project_type: 'B2B', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: null, launch_date: null, submitted_date: null,
  n_target: null, n_target_max: null, n_collected: null, n_actual: null,
  is_placeholder: false, budget: null, requested_by_contact_id: null, ...o,
})
const SEG = (project_id: string, id: string, o: Partial<FinSegment>): FinSegment => ({
  id, project_id, n_target: null, n_target_max: null, n_actual: null, price_per_n: null, ...o,
})

let n = 0
const blast = (
  project_id: string, bid: number, completes: number, people = 0, channel: string | null = 'email', cost_per_send = 0,
): FinBlastDated & { id: string } =>
  ({ id: `b${++n}`, project_id, bid, completes, people, cost_per_send, channel })
const panel = (project_id: string, cpi: number, n_collected: number, supplier_id = 'prime'): FinSupplierFull =>
  ({ id: `s${++n}`, project_id, cpi, n_collected, supplier_id, launch_id: `w-${project_id}` })
const cost = (project_id: string, amount: number, kind = 'other'): FinCostFull =>
  ({ id: `k${++n}`, project_id, amount, kind })

/** `count` simple delivered blast surveys in one month: price $100 × 20 N, and
 *  a blast of `bid` × 20 completes. Enough of them to call a trend. */
function bulk(prefix: string, date: string, count: number, bid: number, client_id: string) {
  const ps: FinProject[] = []
  const bs: (FinBlastDated & { id: string })[] = []
  const rs: [string, number][] = []
  for (let i = 1; i <= count; i++) {
    const id = `${prefix}${i}`
    ps.push(P({ id, client_id, deliver_date: date, n_target: 20, n_actual: 20, n_collected: 20 }))
    bs.push(blast(id, bid, 20))
    rs.push([id, 100])
  }
  return { ps, bs, rs }
}

const june = bulk('j', '2026-06-15', 3, 40, 'bam')   // $2,000 price, $800 cost each
const aug = bulk('a', '2026-08-10', 10, 50, 'coa')   // $2,000 price, $1,000 cost each
const sep = bulk('s', '2026-09-15', 10, 60, 'coa')   // $2,000 price, $1,200 cost each

export const projects: FinProject[] = [
  // 130 delivered against a sold range of 100–120: bills 120 at $150, never 130.
  // $8,000 of reward and $20 of SMS sends. Over its $7,000 budget, still in profit.
  P({ id: 'over', deliver_date: '2026-07-10', n_target: 100, n_target_max: 120, n_actual: 130, n_collected: 160, budget: 7000, requested_by_contact_id: 'c1' }),
  // 900 of 1,000 at $3 on a panel. Over its $1,500 budget, still in profit.
  P({ id: 'short', client_id: 'coa', project_type: 'PS', deliver_date: '2026-08-15', n_target: 1000, n_actual: 900, n_collected: 1300, budget: 1500, requested_by_contact_id: 'c2' }),
  // Given away at $0: $0 of revenue, its $660 cost real, never in a ratio; over its $500 budget.
  P({ id: 'free', client_id: 'ubs', project_type: 'PS', deliver_date: '2026-09-03', n_target: 500, n_actual: 520, n_collected: 600, budget: 500 }),
  // Priced above $0 and still lost $1,400.
  P({ id: 'loss', client_id: 'sig', project_type: 'PS', deliver_date: '2026-08-20', n_target: 100, n_actual: 100, n_collected: 120, budget: 600 }),
  // Segmented, billed on the survey: 90 at $100. A $200 recovered reward comes off.
  P({
    id: 'seg', deliver_date: '2026-09-10', n_target: 90, n_actual: 90, n_collected: 110,
    segments: [
      SEG('seg', 'seg-a', { n_target: 50, n_target_max: 50, n_actual: 60, price_per_n: 150 }),
      SEG('seg', 'seg-b', { n_target: 40, n_actual: 30 }),
    ],
  }),
  // A placeholder that holds real data is real work; its only cost is a vendor line.
  P({ id: 'ph-data', is_placeholder: true, deliver_date: '2026-09-12', n_target: 50, n_actual: 50, n_collected: 50 }),
  // No date at all: in All time, out of any bounded range.
  P({ id: 'undated', client_id: 'coa', n_target: 10, n_actual: 10, n_collected: 12 }),
  // Priced, delivered, no cost recorded: left out, or it would read as 100% kept.
  P({ id: 'priced-nocost', client_id: 'coa', deliver_date: '2026-09-01', n_target: 20, n_actual: 20 }),
  // Priced and costed, no delivered N yet: no revenue, never billed on collected.
  P({ id: 'priced-no-n', deliver_date: '2026-09-05', n_target: 40, n_collected: 45 }),
  // A segment with no N actual (PR00231): billed at the survey's 280, a $60 loss;
  // no cost per billed N, because 280 counts one segment of two.
  P({
    id: 'partial', project_type: 'PS', deliver_date: '2026-09-06', n_target: 600, n_actual: 280, n_collected: 900,
    segments: [
      SEG('partial', 'part-c', { n_target: 300, n_actual: 280 }),
      SEG('partial', 'part-d', { n_target: 300, n_actual: null }),
    ],
  }),
  // Costed and delivered with no price at all.
  P({ id: 'unpriced', deliver_date: '2026-08-02', n_target: 30, n_actual: 30, n_collected: 35 }),
  // Fielded on BOTH routes: $3,000 of blast and $260 of panel, at $40 × 200.
  P({ id: 'both', client_id: 'coa', deliver_date: '2026-08-25', n_target: 200, n_actual: 200, n_collected: 230, requested_by_contact_id: 'c2' }),
  // An empty rerun shell on the Delivery column: excluded everywhere.
  P({ id: 'ph-empty', is_placeholder: true, deliver_date: '2026-09-20', n_target: 100 }),
  // Called off, $50 spent — in "Not in these figures".
  P({ id: 'cancelled', client_id: 'coa', board_column: 'Fielding', status: 'Cancelled' }),
  // Closed without delivery, dated April — outside the default range, but the
  // "Not in these figures" line counts it at any date.
  P({ id: 'archived', board_column: 'Fielding', status: 'Closed', deliver_date: '2026-04-01' }),
  P({ id: 'live', board_column: 'Fielding', status: 'Open', launch_date: '2026-09-01', n_target: 50, n_collected: 70, budget: 1000 }),
  P({ id: 'hold', board_column: 'Fielding', status: 'Hold', deliver_date: '2026-09-10' }),
  P({ id: 'scoping', board_column: 'Submitted', status: 'Open', phase: 'Scoping', submitted_date: '2026-09-20', n_target: 300 }),
  // May: before costs were recorded — one of three costed.
  P({ id: 'may1', deliver_date: '2026-05-10', n_target: 10, n_actual: 10, n_collected: 10 }),
  P({ id: 'may2', deliver_date: '2026-05-12', n_target: 10, n_actual: 10 }),
  P({ id: 'may3', deliver_date: '2026-05-20', n_target: 10, n_actual: 10 }),
  ...june.ps, ...aug.ps, ...sep.ps,
]
// Budgets on two of the bulk surveys, for the median.
for (const p of projects) {
  if (p.id === 'a1') p.budget = 1200
  if (p.id === 's1') p.budget = 1000
}

export const blasts: (FinBlastDated & { id: string })[] = [
  blast('over', 50, 160, 1000, 'sms', 0.02),
  blast('seg', 40, 110),
  blast('undated', 30, 12),
  blast('priced-no-n', 50, 45),
  blast('unpriced', 60, 35),
  blast('both', 30, 100),
  blast('cancelled', 10, 5),
  blast('archived', 20, 10),
  blast('live', 30, 70),
  blast('hold', 10, 3),
  blast('may1', 20, 10),
  ...june.bs, ...aug.bs, ...sep.bs,
]

export const suppliers: FinSupplierFull[] = [
  panel('short', 1.37, 1300),
  panel('free', 1.1, 600),
  panel('loss', 20, 120),
  panel('partial', 1, 900),
  panel('both', 2, 130, 'fusion'),
]

export const costs: FinCostFull[] = [
  cost('seg', -200, 'sms_email_blast'),
  cost('ph-data', 400, 'contacts_export'),
]

export const rateEntries: [string, number][] = [
  ['over', 150], ['short', 3], ['free', 0], ['seg', 100], ['loss', 10], ['ph-data', 20],
  ['undated', 120], ['priced-nocost', 50], ['priced-no-n', 150], ['partial', 3], ['both', 40],
  ['ph-empty', 100], ['cancelled', 100], ['live', 150], ['scoping', 22], ['may1', 100],
  ...june.rs, ...aug.rs, ...sep.rs,
]

export const contacts: FinContact[] = [
  { id: 'c1', client_id: 'bam', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
  { id: 'c2', client_id: 'coa', first_name: 'Sam', last_name: 'Roe', email: 'sam@example.com' },
]

const TABLES: FinanceTable[] = [
  'survey_projects', 'project_blasts', 'project_suppliers', 'project_launches', 'project_costs',
  'project_financials', 'project_segments', 'clients', 'client_contacts', 'client_terms',
]

/** The book as loadFinanceRaw would hand it over. `prices: false` is a finance
 *  reader who got no prices back — a read problem, never an empty book. */
export function fixtureLoad(opts: { prices?: boolean; blocked?: FinanceTable[] } = {}): FinanceLoad {
  const prices = opts.prices ?? true
  const rates = new Map<string, number>(prices ? rateEntries : [])
  const segments = projects.flatMap(p => p.segments ?? [])
  const loadedCounts = Object.fromEntries(TABLES.map(t => [t, 0])) as Record<FinanceTable, number>
  const expectedCounts = Object.fromEntries(TABLES.map(t => [t, null])) as Record<FinanceTable, number | null>
  loadedCounts.survey_projects = projects.length
  return {
    raw: {
      // Fresh copies, so a test that edits its book cannot edit the next one's.
      projects: projects.map(p => ({ ...p })),
      blasts: blasts.map(b => ({ ...b })),
      suppliers: suppliers.map(x => ({ ...x })),
      launches: [],
      costs: costs.map(c => ({ ...c })),
      financials: [...rates].map(([project_id, price_per_n]) => ({ project_id, price_per_n })),
      rates, segments,
      accounts: [
        { id: 'bam', name: 'BAM' }, { id: 'coa', name: 'Coatue' },
        { id: 'ubs', name: 'UBS' }, { id: 'sig', name: 'SIG' },
      ],
      contacts, terms: [],
    },
    blocked: (opts.blocked ?? []).map(table => ({ table, message: 'permission denied' })),
    integrity: {
      loadedCounts, expectedCounts, countMismatches: [],
      spendRecomputedMatches: { matches: projects.length, of: projects.length, mismatchIds: [] },
      pricesReturned: rates.size, demoDropped: 0, loadedAt: '2026-09-24T12:00:00.000Z',
    },
  }
}
