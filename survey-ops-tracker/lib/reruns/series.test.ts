import { describe, it, expect } from 'vitest'
import { effectiveNext, renumberWaves, nextWaveInherit, type Wave } from './series'
import type { Tables } from '@/lib/supabase/types'

// ---------------------------------------------------------------------------
// effectiveNext
// ---------------------------------------------------------------------------
describe('effectiveNext', () => {
  const base = {
    lastOn: '2026-01-10' as string | null,
    anchorDate: null as string | null,
    resumeAnchor: null as string | null,
    cadenceMonths: 1 as number | null,
    paused: false,
    inService: true,
  }

  it('returns null when the series is paused, even with everything else known', () => {
    expect(effectiveNext({ ...base, paused: true })).toBeNull()
  })

  it('returns null when the series has ended (not in service)', () => {
    expect(effectiveNext({ ...base, inService: false })).toBeNull()
  })

  it('returns null when there is no cadence defined (ad-hoc series)', () => {
    expect(effectiveNext({ ...base, cadenceMonths: null })).toBeNull()
  })

  it('returns null when there is no anchor at all (no lastOn/anchorDate/resumeAnchor)', () => {
    expect(effectiveNext({ ...base, lastOn: null, anchorDate: null, resumeAnchor: null })).toBeNull()
  })

  it('falls back to anchorDate when lastOn is null (seed-only series, no wave linked yet)', () => {
    expect(effectiveNext({ ...base, lastOn: null, anchorDate: '2026-03-01', cadenceMonths: 1 })).toBe(
      '2026-04-01'
    )
  })

  it('computes lastOn + cadenceMonths for the normal case', () => {
    expect(effectiveNext({ ...base, lastOn: '2026-01-10', cadenceMonths: 1 })).toBe('2026-02-10')
    expect(effectiveNext({ ...base, lastOn: '2026-01-10', cadenceMonths: 3 })).toBe('2026-04-10')
  })

  it('clamps calendar month-end overflow like Postgres date + interval (Jan 31 + 1mo -> Feb 28)', () => {
    expect(effectiveNext({ ...base, lastOn: '2026-01-31', cadenceMonths: 1 })).toBe('2026-02-28')
  })

  it('resume_anchor overrides a stale lastOn so a resumed series is NOT instantly in the past/overdue', () => {
    // Series paused for months; lastOn is old. On Resume, resume_anchor is set to
    // "now" so the cadence rebases from the resume date, not the stale last wave.
    const stale = effectiveNext({
      ...base,
      lastOn: '2026-01-01',
      resumeAnchor: null,
      cadenceMonths: 1,
    })
    const resumed = effectiveNext({
      ...base,
      lastOn: '2026-01-01',
      resumeAnchor: '2026-06-15',
      cadenceMonths: 1,
    })
    expect(stale).toBe('2026-02-01')
    expect(resumed).toBe('2026-07-15')
    // Resume anchor wins because it is the later of the two — the result must be
    // strictly after the stale (pre-resume) computation.
    expect(resumed! > stale!).toBe(true)
  })

  it('uses lastOn over resume_anchor when lastOn is the later date', () => {
    expect(
      effectiveNext({ ...base, lastOn: '2026-08-01', resumeAnchor: '2026-01-01', cadenceMonths: 1 })
    ).toBe('2026-09-01')
  })
})

// ---------------------------------------------------------------------------
// renumberWaves
// ---------------------------------------------------------------------------
describe('renumberWaves', () => {
  const wave = (o: Partial<Wave> & { id: string }): Wave => ({
    rerun_number: 1,
    wave_order: null,
    submitted_date: null,
    launch_date: null,
    deliver_date: null,
    created_at: '2026-01-01T00:00:00Z',
    ...o,
  })

  it('sorts by date order (submitted -> launch -> deliver -> created_at) and forces the origin first', () => {
    // Origin's own date is LATER than a sibling's — origin must still win Wave 1.
    const waves = [
      wave({ id: 'origin', submitted_date: '2026-03-01' }),
      wave({ id: 'w2', submitted_date: '2026-01-01' }),
      wave({ id: 'w3', submitted_date: '2026-02-01' }),
    ]
    const result = renumberWaves(waves, 'origin')
    expect(result.find((r) => r.id === 'origin')?.rerun_number).toBe(1)
    expect(result.find((r) => r.id === 'w2')?.rerun_number).toBe(2)
    expect(result.find((r) => r.id === 'w3')?.rerun_number).toBe(3)
  })

  it('falls back through the dateKey chain when submitted_date is missing', () => {
    const waves = [
      wave({ id: 'origin', deliver_date: '2026-01-01' }),
      wave({ id: 'w2', launch_date: '2026-02-01' }),
      wave({ id: 'w3', created_at: '2026-03-01T00:00:00Z' }),
    ]
    const result = renumberWaves(waves, 'origin')
    expect(result.find((r) => r.id === 'origin')?.rerun_number).toBe(1)
    expect(result.find((r) => r.id === 'w2')?.rerun_number).toBe(2)
    expect(result.find((r) => r.id === 'w3')?.rerun_number).toBe(3)
  })

  it('breaks date ties by created_at when no manual order exists', () => {
    const waves = [
      wave({ id: 'origin', submitted_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z' }),
      wave({ id: 'w2', submitted_date: '2026-05-01', created_at: '2026-01-01T02:00:00Z' }),
      wave({ id: 'w3', submitted_date: '2026-05-01', created_at: '2026-01-01T01:00:00Z' }),
    ]
    const result = renumberWaves(waves, 'origin')
    expect(result.find((r) => r.id === 'origin')?.rerun_number).toBe(1)
    // w3 was created before w2, so on a same-day date tie it comes first.
    expect(result.find((r) => r.id === 'w3')?.rerun_number).toBe(2)
    expect(result.find((r) => r.id === 'w2')?.rerun_number).toBe(3)
  })

  it('a manual wave_order overrides date order entirely', () => {
    // origin has the earliest date but a manual drag put it last.
    const waves = [
      wave({ id: 'origin', submitted_date: '2026-01-01', wave_order: 3 }),
      wave({ id: 'w2', submitted_date: '2026-02-01', wave_order: 1 }),
      wave({ id: 'w3', submitted_date: '2026-03-01', wave_order: 2 }),
    ]
    const result = renumberWaves(waves, 'origin')
    expect(result.find((r) => r.id === 'w2')?.rerun_number).toBe(1)
    expect(result.find((r) => r.id === 'w3')?.rerun_number).toBe(2)
    expect(result.find((r) => r.id === 'origin')?.rerun_number).toBe(3)
  })

  it('self-heals gaps in wave_order (e.g. 1, 5, 9 -> 1, 2, 3)', () => {
    const waves = [
      wave({ id: 'origin', wave_order: 1 }),
      wave({ id: 'w2', wave_order: 5 }),
      wave({ id: 'w3', wave_order: 9 }),
    ]
    const result = renumberWaves(waves, 'origin')
    expect(result.find((r) => r.id === 'origin')?.rerun_number).toBe(1)
    expect(result.find((r) => r.id === 'w2')?.rerun_number).toBe(2)
    expect(result.find((r) => r.id === 'w3')?.rerun_number).toBe(3)
  })

  it('breaks wave_order ties by dateKey then created_at', () => {
    const waves = [
      wave({ id: 'origin', wave_order: 1, submitted_date: '2026-01-01' }),
      // both w2 and w3 tie on wave_order — dateKey decides.
      wave({ id: 'w2', wave_order: 2, submitted_date: '2026-05-01' }),
      wave({ id: 'w3', wave_order: 2, submitted_date: '2026-02-01' }),
    ]
    const result = renumberWaves(waves, 'origin')
    expect(result.find((r) => r.id === 'w3')?.rerun_number).toBe(2)
    expect(result.find((r) => r.id === 'w2')?.rerun_number).toBe(3)
  })

  it('returns exactly one entry per input wave', () => {
    const waves = [wave({ id: 'a' }), wave({ id: 'b' }), wave({ id: 'c' }), wave({ id: 'd' })]
    const result = renumberWaves(waves, 'a')
    expect(result).toHaveLength(4)
    expect(new Set(result.map((r) => r.rerun_number))).toEqual(new Set([1, 2, 3, 4]))
  })
  it('falls through to pure date order when originId matches no wave', () => {
    // The contract attachProjectToSeries depends on. 10 of 26 live series have
    // origin_project_id = NULL, so attach passes the SERIES id as originId — a
    // value that can never equal a project id — precisely so that no wave is
    // forced to position 1 and date order decides.
    //
    // The bug this guards against: passing the project being ATTACHED as the
    // fallback originId. That promoted the newcomer to Wave 1 and demoted the
    // series' real first wave. Attaching PR00010 to "National Hingevoter" would
    // have renamed it Wave 1 and pushed PR00341 to Wave 2.
    const waves = [
      wave({ id: 'first', submitted_date: '2026-01-01' }),
      wave({ id: 'newcomer', submitted_date: '2026-06-01' }),
      wave({ id: 'middle', submitted_date: '2026-03-01' }),
    ]
    const result = renumberWaves(waves, 'a-series-id-not-a-project-id')
    const num = (id: string) => result.find((r) => r.id === id)!.rerun_number
    expect(num('first')).toBe(1)
    expect(num('middle')).toBe(2)
    expect(num('newcomer')).toBe(3)
  })

  it('would promote the newcomer if it were passed as originId (the bug, pinned)', () => {
    // Documents WHY the fallback must not be the attached project: the origin is
    // forced first regardless of its date. Keeping this as an explicit
    // expectation means a future refactor of renumberWaves cannot quietly make
    // the old, wrong call site look correct again.
    const waves = [
      wave({ id: 'first', submitted_date: '2026-01-01' }),
      wave({ id: 'newcomer', submitted_date: '2026-06-01' }),
    ]
    const result = renumberWaves(waves, 'newcomer')
    expect(result.find((r) => r.id === 'newcomer')!.rerun_number).toBe(1)
    expect(result.find((r) => r.id === 'first')!.rerun_number).toBe(2)
  })

})

// ---------------------------------------------------------------------------
// nextWaveInherit
// ---------------------------------------------------------------------------
describe('nextWaveInherit', () => {
  const series = (o: Partial<Tables<'rerun_series'>> = {}): Tables<'rerun_series'> => ({
    id: 'series-1',
    client_id: 'client-1',
    client: 'BAM',
    survey_name: 'Consumer Study',
    base_type: 'B2B',
    rerun_service: false,
    origin_project_id: 'wave-1',
    cadence_months: 1,
    delivery_cadence: null,
    in_service: true,
    service_mode: 'auto',
    auto_armed: true,
    paused: false,
    template_id: null,
    owner_email: 'sreerag@alpharoc.ai',
    next_wave_no: 2,
    future_defaults: {},
    anchor_date: null,
    resume_anchor: null,
    notes: null,
    data_qa_note: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    updated_by: null,
    ...o,
  })

  const prevWave = (o: Partial<Record<string, unknown>> = {}) => ({
    project_name: 'BAM Consumer Study',
    rerun_date: '2026-01-10',
    launch_date: '2026-01-10',
    due_date: '2026-01-20',
    deliver_date: '2026-01-25',
    captain_id: 'captain-original',
    ...o,
  })

  it('carries base_type from the series, never the legacy Rerun type', () => {
    const out = nextWaveInherit(series({ base_type: 'PS' }), prevWave(), '2026-02-01')
    expect(out.project_type).toBe('PS')
    expect(out.project_type).not.toBe('Rerun')
  })

  it('takes co_captain_ids from future_defaults, not from prevWave.captain_id', () => {
    const s = series({ future_defaults: { co_captain_ids: ['original-captain-id'] } })
    const out = nextWaveInherit(s, prevWave({ captain_id: 'someone-else-entirely' }), '2026-02-01')
    expect(out.co_captain_ids).toEqual(['original-captain-id'])
  })

  it('wave 2 and wave 3 both carry the same original co-captain without duplicating it', () => {
    const fd = { co_captain_ids: ['original-captain-id'] }
    const wave2 = nextWaveInherit(series({ next_wave_no: 2, future_defaults: fd }), prevWave(), '2026-02-01')
    const wave3 = nextWaveInherit(
      series({ next_wave_no: 3, future_defaults: fd }),
      prevWave({ project_name: 'BAM Consumer Study - 2nd Rerun' }),
      '2026-03-01'
    )
    expect(wave2.co_captain_ids).toEqual(['original-captain-id'])
    expect(wave3.co_captain_ids).toEqual(['original-captain-id'])
  })

  it('defaults co_captain_ids to an empty array when future_defaults has none', () => {
    const out = nextWaveInherit(series({ future_defaults: {} }), prevWave(), '2026-02-01')
    expect(out.co_captain_ids).toEqual([])
  })

  it('names the wave via baseRerunName + nextRerunName using series.next_wave_no', () => {
    const out = nextWaveInherit(series({ next_wave_no: 3 }), prevWave({ project_name: 'BAM Consumer Study - 2nd Rerun' }), '2026-02-01')
    expect(out.project_name).toBe('BAM Consumer Study - 3rd Rerun')
  })

  it('sets series linkage and wave number from the series', () => {
    const out = nextWaveInherit(series({ id: 'series-xyz', next_wave_no: 5 }), prevWave(), '2026-02-01')
    expect(out.series_id).toBe('series-xyz')
    expect(out.rerun_number).toBe(5)
    expect(out.client).toBe('BAM')
    expect(out.client_id).toBe('client-1')
  })

  it('rerun_date is always a concrete non-null date, even with no cadence and no prior dates', () => {
    const s = series({ cadence_months: null, anchor_date: null, resume_anchor: null })
    const out = nextWaveInherit(
      s,
      prevWave({ rerun_date: null, launch_date: null, deliver_date: null }),
      '2026-02-15'
    )
    expect(out.rerun_date).not.toBeNull()
    expect(typeof out.rerun_date).toBe('string')
  })

  it('rerun_date advances from the prior wave by the cadence in the normal case', () => {
    const out = nextWaveInherit(series({ cadence_months: 1 }), prevWave({ rerun_date: '2026-01-10' }), '2026-02-01')
    expect(out.rerun_date).toBe('2026-02-10')
  })

  it('advances due_date and deliver_date by the cadence when present', () => {
    const out = nextWaveInherit(
      series({ cadence_months: 1 }),
      prevWave({ due_date: '2026-01-20', deliver_date: '2026-01-25' }),
      '2026-02-01'
    )
    expect(out.due_date).toBe('2026-02-20')
    expect(out.deliver_date).toBe('2026-02-25')
  })

  it('leaves due_date/deliver_date null when the prior wave had none, or cadence is unknown', () => {
    const out = nextWaveInherit(
      series({ cadence_months: null }),
      prevWave({ due_date: null, deliver_date: null }),
      '2026-02-01'
    )
    expect(out.due_date).toBeNull()
    expect(out.deliver_date).toBeNull()
  })

  it('resets run-data and stages so the new wave starts fresh at the first stage', () => {
    const out = nextWaveInherit(series(), prevWave(), '2026-02-01')
    expect(out.survey_tool_id).toBeNull()
    expect(out.n_collected).toBeNull()
    expect(out.n_actual).toBeNull()
    expect(out.board_column).toBe('Submitted')
    expect(out.status).toBe('Open')
    expect(out.phase).toBe('Active')
    expect(out.stage_doc_programming).toBe(false)
    expect(out.stage_survey_programming).toBe(false)
    expect(out.stage_edwin_qa).toBe(false)
    expect(out.stage_fielding).toBe(false)
    expect(out.stage_data_qa).toBe(false)
    expect(out.stage_delivery).toBe(false)
  })

  it('pulls n_target/audience/audience_size/budget from future_defaults, defaulting to null', () => {
    const out1 = nextWaveInherit(
      series({ future_defaults: { n_target: 500, audience: 'Gen pop', audience_size: 50000, budget: 12000 } }),
      prevWave(),
      '2026-02-01'
    )
    expect(out1.n_target).toBe(500)
    expect(out1.audience).toBe('Gen pop')
    expect(out1.audience_size).toBe(50000)
    expect(out1.budget).toBe(12000)

    const out2 = nextWaveInherit(series({ future_defaults: {} }), prevWave(), '2026-02-01')
    expect(out2.n_target).toBeNull()
    expect(out2.audience).toBeNull()
    expect(out2.audience_size).toBeNull()
    expect(out2.budget).toBeNull()
  })

  it('captain_id comes from future_defaults.captain_id, or null (cron resolves the default captain)', () => {
    const withCaptain = nextWaveInherit(series({ future_defaults: { captain_id: 'sree-id' } }), prevWave(), '2026-02-01')
    expect(withCaptain.captain_id).toBe('sree-id')

    const withoutCaptain = nextWaveInherit(series({ future_defaults: {} }), prevWave(), '2026-02-01')
    expect(withoutCaptain.captain_id).toBeNull()
  })

  it('carries compliance_required_override from future_defaults, defaulting to null', () => {
    const withOverride = nextWaveInherit(
      series({ future_defaults: { compliance_required_override: true } }),
      prevWave(),
      '2026-02-01'
    )
    expect(withOverride.compliance_required_override).toBe(true)

    const withoutOverride = nextWaveInherit(series({ future_defaults: {} }), prevWave(), '2026-02-01')
    expect(withoutOverride.compliance_required_override).toBeNull()
  })
})
