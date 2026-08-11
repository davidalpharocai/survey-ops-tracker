import { describe, it, expect } from 'vitest'
import {
  EMPTY_RERUN_FILTER,
  isFilterActive,
  baseTypeLabel,
  cadenceLabel,
  seriesStatusKey,
  seriesMatchesFilters,
  seriesMatchesSearch,
  waveMatchesSearch,
  seriesPasses,
  wavePasses,
  type RerunFilterState,
  type SeriesFilterFields,
  type SeriesSearchFields,
  type WaveSearchFields,
} from './filterViews'

function series(overrides: Partial<SeriesFilterFields & SeriesSearchFields> = {}): SeriesFilterFields & SeriesSearchFields {
  return {
    client: 'Acme',
    survey_name: 'Brand Tracker',
    template_id: 'TMP-100',
    owner_email: 'sam@alpharoc.ai',
    base_type: 'PS',
    cadence_months: 1,
    in_service: true,
    paused: false,
    is_overdue: false,
    ...overrides,
  }
}

function wave(overrides: Partial<WaveSearchFields> = {}): WaveSearchFields {
  return {
    project_code: 'PR00123',
    project_name: 'Brand Tracker Wave 3',
    survey_tool_id: 'ps-abc-999',
    ...overrides,
  }
}

function filter(overrides: Partial<RerunFilterState> = {}): RerunFilterState {
  return { ...EMPTY_RERUN_FILTER, ...overrides }
}

describe('labels', () => {
  it('baseTypeLabel maps null to Rerun Service', () => {
    expect(baseTypeLabel('PS')).toBe('PS')
    expect(baseTypeLabel('B2B')).toBe('B2B')
    expect(baseTypeLabel(null)).toBe('Rerun Service')
  })

  it('cadenceLabel names the known cadences and falls back', () => {
    expect(cadenceLabel(1)).toBe('Monthly')
    expect(cadenceLabel(3)).toBe('Quarterly')
    expect(cadenceLabel(6)).toBe('Every 6 mo')
    expect(cadenceLabel(12)).toBe('Yearly')
    expect(cadenceLabel(4)).toBe('Every 4 mo')
    expect(cadenceLabel(null)).toBe('Ad-hoc')
  })
})

describe('seriesStatusKey', () => {
  it('prioritises overdue, then paused, then ended, then in service', () => {
    expect(seriesStatusKey({ in_service: true, paused: false, is_overdue: true })).toBe('overdue')
    expect(seriesStatusKey({ in_service: true, paused: true, is_overdue: false })).toBe('paused')
    expect(seriesStatusKey({ in_service: false, paused: false, is_overdue: false })).toBe('ended')
    expect(seriesStatusKey({ in_service: true, paused: false, is_overdue: false })).toBe('in_service')
    // overdue wins even when paused/ended flags are also set
    expect(seriesStatusKey({ in_service: false, paused: true, is_overdue: true })).toBe('overdue')
  })
})

describe('isFilterActive', () => {
  it('is false for the empty filter and true when anything is set', () => {
    expect(isFilterActive(EMPTY_RERUN_FILTER)).toBe(false)
    expect(isFilterActive(filter({ search: '  ' }))).toBe(false)
    expect(isFilterActive(filter({ search: 'acme' }))).toBe(true)
    expect(isFilterActive(filter({ type: 'PS' }))).toBe(true)
    expect(isFilterActive(filter({ status: 'overdue' }))).toBe(true)
    expect(isFilterActive(filter({ cadence: 'adhoc' }))).toBe(true)
    expect(isFilterActive(filter({ owner: 'sam@alpharoc.ai' }))).toBe(true)
  })
})

describe('seriesMatchesFilters — type', () => {
  it('matches PS / B2B / Rerun Service', () => {
    expect(seriesMatchesFilters(series({ base_type: 'PS' }), filter({ type: 'PS' }))).toBe(true)
    expect(seriesMatchesFilters(series({ base_type: 'B2B' }), filter({ type: 'PS' }))).toBe(false)
    expect(seriesMatchesFilters(series({ base_type: 'B2B' }), filter({ type: 'B2B' }))).toBe(true)
    expect(seriesMatchesFilters(series({ base_type: null }), filter({ type: 'service' }))).toBe(true)
    expect(seriesMatchesFilters(series({ base_type: 'PS' }), filter({ type: 'service' }))).toBe(false)
    expect(seriesMatchesFilters(series({ base_type: 'PS' }), filter({ type: 'all' }))).toBe(true)
  })
})

describe('seriesMatchesFilters — status', () => {
  it('overdue tests is_overdue', () => {
    expect(seriesMatchesFilters(series({ is_overdue: true }), filter({ status: 'overdue' }))).toBe(true)
    expect(seriesMatchesFilters(series({ is_overdue: false }), filter({ status: 'overdue' }))).toBe(false)
  })
  it('paused tests paused', () => {
    expect(seriesMatchesFilters(series({ paused: true }), filter({ status: 'paused' }))).toBe(true)
    expect(seriesMatchesFilters(series({ paused: false }), filter({ status: 'paused' }))).toBe(false)
  })
  it('ended tests not in_service', () => {
    expect(seriesMatchesFilters(series({ in_service: false }), filter({ status: 'ended' }))).toBe(true)
    expect(seriesMatchesFilters(series({ in_service: true }), filter({ status: 'ended' }))).toBe(false)
  })
  it('in_service requires in_service and not paused', () => {
    expect(seriesMatchesFilters(series({ in_service: true, paused: false }), filter({ status: 'in_service' }))).toBe(true)
    expect(seriesMatchesFilters(series({ in_service: true, paused: true }), filter({ status: 'in_service' }))).toBe(false)
    expect(seriesMatchesFilters(series({ in_service: false, paused: false }), filter({ status: 'in_service' }))).toBe(false)
  })
})

describe('seriesMatchesFilters — cadence & owner', () => {
  it('matches cadence buckets including ad-hoc', () => {
    expect(seriesMatchesFilters(series({ cadence_months: 1 }), filter({ cadence: '1' }))).toBe(true)
    expect(seriesMatchesFilters(series({ cadence_months: 3 }), filter({ cadence: '1' }))).toBe(false)
    expect(seriesMatchesFilters(series({ cadence_months: 12 }), filter({ cadence: '12' }))).toBe(true)
    expect(seriesMatchesFilters(series({ cadence_months: null }), filter({ cadence: 'adhoc' }))).toBe(true)
    expect(seriesMatchesFilters(series({ cadence_months: 6 }), filter({ cadence: 'adhoc' }))).toBe(false)
  })
  it('matches a specific owner', () => {
    expect(seriesMatchesFilters(series({ owner_email: 'sam@alpharoc.ai' }), filter({ owner: 'sam@alpharoc.ai' }))).toBe(true)
    expect(seriesMatchesFilters(series({ owner_email: 'jo@alpharoc.ai' }), filter({ owner: 'sam@alpharoc.ai' }))).toBe(false)
    expect(seriesMatchesFilters(series({ owner_email: null }), filter({ owner: 'sam@alpharoc.ai' }))).toBe(false)
  })
})

describe('seriesMatchesSearch', () => {
  it('empty search matches', () => {
    expect(seriesMatchesSearch(series(), [], '')).toBe(true)
    expect(seriesMatchesSearch(series(), [], '   ')).toBe(true)
  })
  it('matches across series fields, case-insensitively', () => {
    expect(seriesMatchesSearch(series({ client: 'Acme' }), [], 'acme')).toBe(true)
    expect(seriesMatchesSearch(series({ survey_name: 'Brand Tracker' }), [], 'brand')).toBe(true)
    expect(seriesMatchesSearch(series({ template_id: 'TMP-100' }), [], 'tmp-100')).toBe(true)
    expect(seriesMatchesSearch(series({ owner_email: 'sam@alpharoc.ai' }), [], 'sam@')).toBe(true)
  })
  it('matches on the base-type label (Rerun Service for null)', () => {
    expect(seriesMatchesSearch(series({ base_type: null }), [], 'rerun service')).toBe(true)
    expect(seriesMatchesSearch(series({ base_type: 'PS' }), [], 'ps')).toBe(true)
  })
  it('matches on a wave field', () => {
    expect(seriesMatchesSearch(series(), [wave({ project_code: 'PR00777' })], 'pr00777')).toBe(true)
    expect(seriesMatchesSearch(series(), [wave({ survey_tool_id: 'ps-xyz-1' })], 'ps-xyz')).toBe(true)
  })
  it('requires every whitespace token to match somewhere', () => {
    expect(seriesMatchesSearch(series({ client: 'Acme', survey_name: 'Brand Tracker' }), [], 'acme tracker')).toBe(true)
    expect(seriesMatchesSearch(series({ client: 'Acme', survey_name: 'Brand Tracker' }), [], 'acme nope')).toBe(false)
  })
  it('does not match unrelated text', () => {
    expect(seriesMatchesSearch(series(), [wave()], 'zzz-nomatch')).toBe(false)
  })
})

describe('waveMatchesSearch', () => {
  it('matches on the wave fields and its series context', () => {
    expect(waveMatchesSearch(wave({ project_name: 'Brand Tracker Wave 3' }), series(), 'wave 3')).toBe(true)
    expect(waveMatchesSearch(wave(), series({ client: 'Acme' }), 'acme')).toBe(true)
    expect(waveMatchesSearch(wave({ survey_tool_id: 'ps-abc-999' }), series(), 'ps-abc-999')).toBe(true)
    expect(waveMatchesSearch(wave(), series(), 'nonsense-token')).toBe(false)
  })
})

describe('seriesPasses / wavePasses combine filters + search', () => {
  it('seriesPasses needs both to hold', () => {
    const s = series({ base_type: 'PS', client: 'Acme' })
    expect(seriesPasses(s, [], filter({ type: 'PS', search: 'acme' }))).toBe(true)
    expect(seriesPasses(s, [], filter({ type: 'B2B', search: 'acme' }))).toBe(false)
    expect(seriesPasses(s, [], filter({ type: 'PS', search: 'nope' }))).toBe(false)
  })
  it('wavePasses gates on the parent series filters and the wave search', () => {
    const s = series({ base_type: 'PS', client: 'Acme' })
    const w = wave({ project_code: 'PR00123' })
    expect(wavePasses(w, s, filter({ type: 'PS', search: 'pr00123' }))).toBe(true)
    expect(wavePasses(w, s, filter({ status: 'paused' }))).toBe(false) // series not paused
    expect(wavePasses(w, s, filter({ search: 'pr00999' }))).toBe(false) // wave code mismatch
  })
})
