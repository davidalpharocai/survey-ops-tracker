import { describe, it, expect, vi } from 'vitest'

// Light, TABLE-AWARE DB mock: `.from(table)` returns a chainable builder that is
// awaitable and resolves to a fixed row set per table (filters/ordering are SQL
// and aren't exercised — we assert output SHAPE + bucketing, not filtering).
// rerun_series_status → seriesRows; rerun_status → legacyRows.
const h = vi.hoisted(() => {
  const seriesRows = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      client: 'Acme', survey_name: 'Acme Tracker', base_type: 'PS',
      cadence_months: 1, service_mode: 'auto', in_service: true, paused: false,
      is_overdue: true, owner_email: 'sree@alpharoc.ai', last_on: '1999-12-01',
      effective_next: '2000-01-01', days_to_next: -100,
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      client: 'Beta', survey_name: 'Beta Wave', base_type: 'B2B',
      cadence_months: 3, service_mode: 'manual', in_service: true, paused: false,
      is_overdue: false, owner_email: 'sree@alpharoc.ai', last_on: null,
      effective_next: '2999-01-01', days_to_next: 9999,
    },
    {
      // adhoc (null cadence) with no anchor → no effective_next. Must NOT be
      // bucketed as needs_definition, and must NOT be surfaced at all.
      id: '33333333-3333-3333-3333-333333333333',
      client: 'Gamma', survey_name: 'Gamma Study', base_type: 'PS',
      cadence_months: null, service_mode: 'auto', in_service: true, paused: false,
      is_overdue: false, owner_email: 'sree@alpharoc.ai', last_on: null,
      effective_next: null, days_to_next: null,
    },
  ]
  const legacyRows = [
    {
      // legacy twin of the OMITTED first-class Gamma — has a real due date, so
      // it must still surface (the omitted first-class row must not hide it).
      id: 'g-legacy', client: 'Gamma', display_name: 'Gamma Study', work: 'Gamma Study',
      platform: 'sheet', cadence: 'monthly', cadence_months: 1, last_wave_on: null,
      expected_next_on: '2000-06-01', effective_due: '2000-06-01', days_to_due: -5,
      is_overdue: true, in_prep_window: false, needs_definition: false,
      owner_email: 'sree@alpharoc.ai', backup_owner_email: null, survey_ids: 'GS1',
    },
    {
      // legacy twin of the SURFACED first-class Beta — must be de-duped away.
      id: 'b-legacy', client: 'Beta', display_name: 'Beta Wave', work: 'Beta Wave',
      platform: 'sheet', cadence: 'quarterly', cadence_months: 3, last_wave_on: null,
      expected_next_on: '2010-01-01', effective_due: '2010-01-01', days_to_due: -3,
      is_overdue: true, in_prep_window: false, needs_definition: false,
      owner_email: 'sree@alpharoc.ai', backup_owner_email: null, survey_ids: 'BW1',
    },
  ]
  const builderFor = (table: string) => {
    const rows = table === 'rerun_status' ? legacyRows : seriesRows
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'or', 'ilike', 'eq', 'gte', 'lte', 'order', 'limit', 'is', 'not', 'maybeSingle', 'single']) {
      b[m] = () => b
    }
    ;(b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null })
    return b
  }
  return { seriesRows, legacyRows, builderFor }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (t: string) => h.builderFor(t) }),
}))

import * as data from './data'
import { TOOLS } from './registry'

const NEW_READS = ['search_reruns', 'get_rerun_series', 'rerun_calendar']
const CONFIRMABLE_WRITES = [
  'put_in_rerun_service', 'set_rerun_defaults', 'pause_rerun', 'resume_rerun', 'end_rerun', 'create_next_wave',
]

describe('rerun tool registration + contracts', () => {
  const byName = new Map(TOOLS.map((t) => [t.name, t]))

  it('registers the 3 rerun read tools with kind:read', () => {
    for (const n of NEW_READS) {
      const t = byName.get(n)
      expect(t, `${n} is registered`).toBeDefined()
      expect(t!.kind, n).toBe('read')
    }
  })

  it('registers the rerun writes as confirmable: kind:write, has `confirm`, no previewSummary', () => {
    for (const n of CONFIRMABLE_WRITES) {
      const t = byName.get(n)
      expect(t, `${n} is registered`).toBeDefined()
      expect(t!.kind, n).toBe('write')
      // confirmable tools MUST expose a `confirm` flag (the engine strips it)…
      expect('confirm' in t!.schema, `${n} exposes confirm`).toBe(true)
      // …and MUST NOT set previewSummary (that's the append/direct-commit marker).
      expect(typeof t!.previewSummary, `${n} has no previewSummary`).toBe('undefined')
    }
  })
})

describe('searchReruns output shape', () => {
  it('returns ok/count/series/summary with the documented per-item fields', async () => {
    const res = (await data.searchReruns({ userEmail: 'sree@alpharoc.ai' })) as {
      ok: boolean; count: number; series: Record<string, unknown>[]; summary: string
    }
    expect(res.ok).toBe(true)
    expect(res.count).toBe(h.seriesRows.length)
    expect(res.series).toHaveLength(h.seriesRows.length)
    const item = res.series[0]
    for (const k of [
      'id', 'client', 'survey_name', 'base_type', 'cadence', 'cadence_months',
      'service_mode', 'in_service', 'paused', 'is_overdue', 'owner_email', 'effective_next', 'days_to_next',
    ]) {
      expect(k in item, `item has ${k}`).toBe(true)
    }
    expect(item.cadence).toBe('monthly') // cadence_months 1 → keyword
    expect(typeof res.summary).toBe('string')
  })
})

describe('rerunCalendar output shape', () => {
  it('buckets an overdue series and a far-future one, with counts + summary', async () => {
    const res = (await data.rerunCalendar({ window: 'week' })) as {
      ok: boolean; window: string
      counts: { overdue: number; due_in_window: number; upcoming: number }
      summary: string
    }
    expect(res.ok).toBe(true)
    expect(res.window).toBe('week')
    expect(res.counts.overdue).toBe(1) // the is_overdue row
    expect(res.counts.upcoming).toBe(1) // the 2999 row is beyond the window
    // the adhoc/no-anchor row (null effective_next) is not bucketed anywhere.
    expect(res.counts.due_in_window).toBe(0)
    expect(typeof res.summary).toBe('string')
  })
})

describe('rerunRadar (first-class only)', () => {
  it('buckets first-class series by due state; adhoc/no-cadence is omitted (never needs_definition), and the retired legacy sheet mirror does not contribute', async () => {
    const res = (await data.rerunRadar()) as {
      ok: boolean
      counts: { overdue: number; needs_definition: number; prep_window: number; upcoming: number }
      overdue: { name: string | null }[]
      needs_definition: { name: string | null }[]
      prep_window: { name: string | null }[]
      upcoming: { name: string | null }[]
    }
    // adhoc (null cadence) is a deliberate choice → the first-class model has no
    // needs_definition state, so it is always 0/empty.
    expect(res.counts.needs_definition).toBe(0)

    const all = [...res.overdue, ...res.needs_definition, ...res.prep_window, ...res.upcoming].map((x) => x.name)

    // Acme (overdue) and Beta (upcoming) surface from the first-class model.
    expect(res.overdue.map((x) => x.name)).toContain('Acme Tracker')
    expect(res.upcoming.map((x) => x.name)).toContain('Beta Wave')

    // Gamma is adhoc / no computable due date → omitted from every bucket.
    expect(all).not.toContain('Gamma Study')

    // The legacy sheet mirror is retired as a rerun source: its rows never appear
    // (no double-counting), and each first-class study shows exactly once.
    expect(res.overdue).toHaveLength(1)
    expect(res.upcoming).toHaveLength(1)
    expect(all.filter((n) => n === 'Beta Wave')).toHaveLength(1)
  })
})
