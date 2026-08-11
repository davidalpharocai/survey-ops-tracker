import { describe, it, expect } from 'vitest'
import { seriesMonthEvents, needsActionSeries } from './monthEvents'
import type { SeriesListRow } from '@/lib/hooks/useRerunSeriesRecord'

// A fully-populated SeriesListRow with sensible in-service/cadenced defaults;
// tests override only the fields they exercise. Mirrors the fixture style of
// lib/calendar/events.test.ts.
function series(overrides: Partial<SeriesListRow> = {}): SeriesListRow {
  return {
    id: 's1',
    client_id: 'c1',
    client: 'Acme',
    survey_name: 'Q3 Tracker',
    base_type: 'PS',
    rerun_service: false,
    origin_project_id: 'p1',
    cadence_months: 3,
    delivery_cadence: null,
    in_service: true,
    service_mode: 'auto',
    auto_armed: true,
    paused: false,
    template_id: null,
    owner_email: 'sree@alpharoc.ai',
    next_wave_no: 2,
    future_defaults: {},
    anchor_date: '2026-05-01',
    resume_anchor: null,
    notes: null,
    data_qa_note: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    updated_by: null,
    last_on: '2026-05-01',
    cadence_anchor: '2026-05-01',
    effective_next: '2026-08-01',
    days_to_next: 20,
    is_overdue: false,
    wave_count: 1,
    ...overrides,
  }
}

describe('seriesMonthEvents — bucketing by effective_next', () => {
  it('buckets in-service, non-paused, dated series by effective_next (YYYY-MM-DD)', () => {
    const byDate = seriesMonthEvents([
      series({ id: 'a', effective_next: '2026-08-01' }),
      series({ id: 'b', effective_next: '2026-08-15' }),
      series({ id: 'c', effective_next: '2026-08-01' }),
    ])
    expect(Object.keys(byDate).sort()).toEqual(['2026-08-01', '2026-08-15'])
    expect(byDate['2026-08-01'].map((e) => e.seriesId).sort()).toEqual(['a', 'c'])
    expect(byDate['2026-08-15']).toHaveLength(1)
  })

  it('normalizes an ISO timestamp effective_next to a YYYY-MM-DD key', () => {
    const byDate = seriesMonthEvents([series({ effective_next: '2026-08-01T00:00:00Z' })])
    expect(Object.keys(byDate)).toEqual(['2026-08-01'])
    expect(byDate['2026-08-01'][0].effective_next).toBe('2026-08-01')
  })

  it('omits paused, ended, and null-date (ad-hoc) series', () => {
    const byDate = seriesMonthEvents([
      series({ id: 'paused', paused: true, effective_next: '2026-08-01' }),
      series({ id: 'ended', in_service: false, effective_next: '2026-08-01' }),
      series({ id: 'adhoc', cadence_months: null, effective_next: null }),
      series({ id: 'live', effective_next: '2026-08-01' }),
    ])
    const ids = Object.values(byDate).flat().map((e) => e.seriesId)
    expect(ids).toEqual(['live'])
  })

  it('carries the overdue flag onto the event and sorts overdue first within a day', () => {
    const byDate = seriesMonthEvents([
      series({ id: 'ontrack', client: 'Beta', effective_next: '2026-08-01', is_overdue: false }),
      series({ id: 'late', client: 'Acme', effective_next: '2026-08-01', is_overdue: true }),
    ])
    const day = byDate['2026-08-01']
    expect(day.map((e) => e.seriesId)).toEqual(['late', 'ontrack'])
    expect(day[0].is_overdue).toBe(true)
  })
})

describe('needsActionSeries', () => {
  it('includes overdue series', () => {
    const out = needsActionSeries([
      series({ id: 'late', is_overdue: true, days_to_next: -5 }),
      series({ id: 'fine', is_overdue: false, days_to_next: 20 }),
    ])
    expect(out.map((s) => s.id)).toEqual(['late'])
  })

  it('flags an in-service, non-paused series with no cadence as needs-a-cadence', () => {
    const out = needsActionSeries([
      series({ id: 'adhoc', cadence_months: null, effective_next: null, days_to_next: null, is_overdue: false }),
    ])
    expect(out.map((s) => s.id)).toEqual(['adhoc'])
  })

  it('excludes on-track cadenced series, and paused/ended no-cadence series', () => {
    const out = needsActionSeries([
      series({ id: 'ontrack', is_overdue: false }),
      series({ id: 'paused-adhoc', cadence_months: null, paused: true, effective_next: null, is_overdue: false }),
      series({ id: 'ended-adhoc', cadence_months: null, in_service: false, effective_next: null, is_overdue: false }),
    ])
    expect(out).toHaveLength(0)
  })

  it('sorts overdue-first, then by days_to_next ascending (most overdue first)', () => {
    const out = needsActionSeries([
      series({ id: 'adhoc', cadence_months: null, effective_next: null, days_to_next: null, is_overdue: false }),
      series({ id: 'late-a-little', is_overdue: true, days_to_next: -2 }),
      series({ id: 'late-a-lot', is_overdue: true, days_to_next: -30 }),
    ])
    expect(out.map((s) => s.id)).toEqual(['late-a-lot', 'late-a-little', 'adhoc'])
  })
})
