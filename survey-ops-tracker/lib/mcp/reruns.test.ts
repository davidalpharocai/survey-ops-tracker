import { describe, it, expect, vi } from 'vitest'

// Light DB mock: every query-builder method chains to the same object, which
// is awaitable and resolves to a fixed row set (filters/ordering are SQL and
// aren't exercised here — we assert output SHAPE, not filter correctness).
const { rows } = vi.hoisted(() => ({
  rows: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      client: 'Acme', survey_name: 'Acme Tracker', base_type: 'PS',
      cadence_months: 1, service_mode: 'auto', in_service: true, paused: false,
      is_overdue: true, owner_email: 'sree@alpharoc.ai',
      effective_next: '2000-01-01', days_to_next: -100,
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      client: 'Beta', survey_name: 'Beta Wave', base_type: 'B2B',
      cadence_months: 3, service_mode: 'manual', in_service: true, paused: false,
      is_overdue: false, owner_email: 'sree@alpharoc.ai',
      effective_next: '2999-01-01', days_to_next: 9999,
    },
  ],
}))

vi.mock('@/lib/supabase/admin', () => {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'or', 'ilike', 'eq', 'gte', 'lte', 'order', 'limit', 'is', 'not', 'maybeSingle', 'single']) {
    builder[m] = () => builder
  }
  ;(builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null })
  return { createAdminClient: () => ({ from: () => builder }) }
})

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
    expect(res.count).toBe(rows.length)
    expect(res.series).toHaveLength(rows.length)
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
    expect(typeof res.summary).toBe('string')
  })
})
