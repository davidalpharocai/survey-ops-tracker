import { describe, expect, it } from 'vitest'
import { NO_FIELD_FACTS } from '@/lib/admin/cleanup'
import { loadCleanup, PAGE, type Reader } from './load'

/**
 * The loader's job is to be boring and honest: read everything, page it, drop
 * what is not a survey, and say plainly when a read failed.
 *
 * Every test here is a way this has gone wrong somewhere in this codebase
 * before — a truncated read at 1,000 rows, a demo account counted as work, a
 * failed read rendered as zero, and money arriving in a payload that was not
 * supposed to carry any.
 */

interface Call { table: string; cols: string; filters: string[]; ranges: [number, number][] }

/** A Supabase stand-in. `rows` is per table; `fail` names tables that reject. */
function reader(rows: Record<string, unknown[]>, fail: Record<string, string> = {}) {
  const calls: Call[] = []
  const client: Reader = {
    from(table: string) {
      return {
        select(cols: string) {
          const call: Call = { table, cols, filters: [], ranges: [] }
          calls.push(call)
          const q = {
            is(col: string) { call.filters.push(`is:${col}`); return q },
            neq(col: string, v: string) { call.filters.push(`neq:${col}=${v}`); return q },
            order(col: string) { call.filters.push(`order:${col}`); return q },
            range(from: number, to: number) {
              call.ranges.push([from, to])
              return q
            },
            then(resolve: (r: { data: unknown[] | null; error: { message: string } | null }) => unknown) {
              if (fail[table]) return Promise.resolve(resolve({ data: null, error: { message: fail[table] } }))
              const all = rows[table] ?? []
              const [from, to] = call.ranges[call.ranges.length - 1] ?? [0, PAGE - 1]
              return Promise.resolve(resolve({ data: all.slice(from, to + 1), error: null }))
            },
          }
          return q as unknown as ReturnType<ReturnType<Reader['from']>['select']>
        },
      }
    },
  }
  return { client, calls }
}

const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1', project_code: 'PR00001', project_name: 'Study', client: 'Holocene', client_id: 'cl1',
  captain_id: 'tm1', salesperson: 'Alex Pinsky', requested_by_contact_id: null, requested_by_name: null,
  project_type: 'PS', phase: 'Active', status: 'Open', board_column: 'Fielding', scoping_stage: null,
  submitted_date: '2026-08-01', launch_date: '2026-08-05', due_date: '2026-08-20', deliver_date: null,
  delivered_at: null, rerun_date: null, n_target: 500, n_target_max: null, n_internal_target: null,
  n_collected: 100, n_actual: null, survey_tool_id: 'SOCC_1', longitudinal: false, row_level_data: false,
  occam: false, series_id: null, rerun_number: 1, is_placeholder: false, created_at: '2026-08-01T09:00:00Z',
  captain: { id: 'tm1', name: 'Sree', initials: 'SR' },
  ...over,
})

describe('the reads themselves', () => {
  it('drops deleted and cancelled surveys in the query, not afterwards', async () => {
    const { client, calls } = reader({ survey_projects: [survey()], clients: [] })
    await loadCleanup(client)
    const surveyReads = calls.filter(c => c.table === 'survey_projects')
    expect(surveyReads).toHaveLength(2) // the row read and the spend read
    for (const c of surveyReads) {
      expect(c.filters).toContain('is:deleted_at')
      expect(c.filters).toContain('neq:status=Cancelled')
      expect(c.filters).toContain('order:id')
    }
    // Child tables carry no deleted_at and must not be filtered as if they did.
    expect(calls.find(c => c.table === 'project_blasts')!.filters).toEqual(['order:id'])
  })

  it('pages past 1,000 rows instead of stopping at the silent PostgREST cap', async () => {
    const many = Array.from({ length: PAGE + 7 }, (_, i) => survey({ id: `s${i}`, project_code: `PR${i}` }))
    const { client, calls } = reader({ survey_projects: many, clients: [] })
    const data = await loadCleanup(client)
    expect(data.projects).toHaveLength(PAGE + 7)
    // One select() per page, so the ranges are gathered across the calls.
    const ranges = calls.filter(c => c.cols.includes('project_code')).flatMap(c => c.ranges)
    expect(ranges).toEqual([[0, 999], [1000, 1999]])
  })

  it('drops the demo and test accounts, and keeps a survey with no account at all', async () => {
    const { client } = reader({
      survey_projects: [
        survey({ id: 'real', client_id: 'cl1' }),
        survey({ id: 'demo', client_id: 'cl-demo' }),
        survey({ id: 'orphan', client_id: null }),
      ],
      clients: [{ id: 'cl1', is_demo: false }, { id: 'cl-demo', is_demo: true }],
    })
    const data = await loadCleanup(client)
    expect(data.projects.map(p => p.id)).toEqual(['real', 'orphan'])
  })

  it('flattens the joined captain to a name and keeps nothing else from the join', async () => {
    const { client } = reader({ survey_projects: [survey()], clients: [] })
    const [row] = (await loadCleanup(client)).projects
    expect(row.captain_name).toBe('Sree')
    expect(row).not.toHaveProperty('captain')
  })
})

describe('a read that fails', () => {
  it('names the blocked source and still returns everything else', async () => {
    const { client } = reader(
      { survey_projects: [survey()], clients: [] },
      { client_contacts: 'permission denied for table client_contacts' },
    )
    const data = await loadCleanup(client)
    expect(data.error).toBeNull()
    expect(data.projects).toHaveLength(1)
    expect(data.blocked).toEqual(['contacts'])
    expect(data.blockedWhy).toEqual([
      { source: 'contacts', message: 'permission denied for table client_contacts' },
    ])
  })

  it('fails the whole page when the surveys themselves did not load', async () => {
    const { client } = reader({}, { survey_projects: 'relation does not exist' })
    const data = await loadCleanup(client)
    expect(data.error).toBe('relation does not exist')
    expect(data.projects).toEqual([])
  })

  it('fails the whole page when the accounts list did not load', async () => {
    // Without it there is no way to tell a real survey from a test one, and a
    // permanently-unfixable row on a dashboard whose target is zero is worse
    // than no dashboard.
    const { client } = reader({ survey_projects: [survey()] }, { clients: 'permission denied' })
    expect((await loadCleanup(client)).error).toBe('permission denied')
  })
})

describe('what the child rows say, and what they must not say', () => {
  it('turns the money into two booleans and lets no amount through', async () => {
    const { client } = reader({
      survey_projects: [survey({ id: 's1' }), survey({ id: 's2' })],
      clients: [],
      // s1: $4,000 of blast recorded, stored total still 0 — the one spend
      // check this dashboard runs.
      project_blasts: [{ project_id: 's1', bid: 40, completes: 100, people: 0, cost_per_send: 0, channel: 'email' }],
      project_suppliers: [{ project_id: 's2', cpi: 5, n_collected: 20 }],
      project_costs: [],
      project_launches: [{ project_id: 's2' }],
    })
    const data = await loadCleanup(client, )
    expect(data.fielding.s1).toEqual({
      blasts: 1, suppliers: 0, launches: 0, costs: 0, recordsSpend: true, spendIsZero: true,
    })
    expect(data.fielding.s2.suppliers).toBe(1)
    expect(data.fielding.s2.launches).toBe(1)
    // Not one number that could be read as money, anywhere in the payload —
    // nor the one restricted non-money column, which is read server-side and
    // crosses as a list of ids.
    const wire = JSON.stringify(data)
    expect(wire).not.toContain('actual_spend')
    expect(wire).not.toContain('budget')
    expect(wire).not.toContain('cpi')
    expect(wire).not.toContain('"bid"')
    expect(wire).not.toContain('n_internal_target')
  })

  it('charges for a send the way the app charges for it — email sends are free', async () => {
    // migration 112, lib/finance/hub.ts `spendOf`. The connector re-implemented
    // this sum without the channel term and reported a survey as a gap that the
    // tile beside it read as clear; both call `spendOf` now, and this is the
    // case that told them apart.
    const emailOnly = {
      project_id: 's1', bid: 0, completes: 0, people: 9366, cost_per_send: 0.02, channel: 'email',
    }
    const { client } = reader({
      survey_projects: [survey({ id: 's1' })],
      clients: [],
      project_blasts: [emailOnly],
    })
    const data = await loadCleanup(client)
    expect(data.fielding.s1.blasts).toBe(1)
    expect(data.fielding.s1.recordsSpend).toBe(false)

    // The same rows on any other channel DO cost something.
    const { client: sms } = reader({
      survey_projects: [survey({ id: 's1' })],
      clients: [],
      project_blasts: [{ ...emailOnly, channel: 'sms' }],
    })
    expect((await loadCleanup(sms)).fielding.s1.recordsSpend).toBe(true)
  })

  it('hands over the ids that carry an internal target, never the number', async () => {
    const { client } = reader({
      survey_projects: [
        survey({ id: 'internal', n_internal_target: 600 }),
        survey({ id: 'plain' }),
        // On a demo account, so it is not a survey this page counts at all.
        survey({ id: 'demo', client_id: 'cl-demo', n_internal_target: 400 }),
      ],
      clients: [{ id: 'cl1', is_demo: false }, { id: 'cl-demo', is_demo: true }],
    })
    const data = await loadCleanup(client)
    expect(data.internalTargets).toEqual(['internal'])
    expect(JSON.stringify(data)).not.toContain('600')
  })

  it('says nothing at all about a survey with no child rows', async () => {
    const { client } = reader({ survey_projects: [survey()], clients: [] })
    const data = await loadCleanup(client)
    // Absent rather than a row of zeroes; the model answers NO_FIELD_FACTS.
    expect(data.fielding.s1).toBeUndefined()
    expect(NO_FIELD_FACTS.recordsSpend).toBe(false)
  })

  it('reports a contact as invited only when the row says so', async () => {
    const { client } = reader({
      survey_projects: [survey()],
      clients: [],
      client_contacts: [{ id: 'ct1', occam_invited: true }, { id: 'ct2', occam_invited: null }],
    })
    const data = await loadCleanup(client)
    expect(data.contacts).toEqual({ ct1: true, ct2: false })
  })
})
