import { describe, it, expect } from 'vitest'
import { buildSummaryFacts } from './projectSummary'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import type { Blast } from '@/lib/hooks/useProjectBlasts'

function project(overrides: Partial<SurveyProject> = {}): SurveyProject {
  return {
    id: 'p1',
    project_name: 'Test Project',
    client: 'Acme - B2B',
    board_column: 'Fielding',
    delivered_at: null,
    due_date: null,
    launch_date: '2026-07-01',
    created_at: '2026-06-01T00:00:00Z',
    n_collected: 0,
    n_target: null,
    actual_spend: 0,
    budget: null,
    compliance_override: null,
    longitudinal: false,
    voter_survey_qa: null,
    citation_language_needed: null,
    row_level_data: false,
    terminations: false,
    rerun_number: 1,
    captain: null,
    ...overrides,
  } as unknown as SurveyProject
}

function blast(overrides: Partial<Blast> = {}): Blast {
  return {
    id: 'b1',
    project_id: 'p1',
    people: 100,
    completes: 50,
    bid: 5,
    blast_at: '2026-07-10T00:00:00Z',
    created_at: '2026-07-10T00:00:00Z',
    ...overrides,
  } as unknown as Blast
}

describe('buildSummaryFacts — watch-outs', () => {
  it('overdue: true when due_date is past and the project is not delivered', () => {
    const facts = buildSummaryFacts({
      project: project({ due_date: '2026-07-10', board_column: 'Fielding', delivered_at: null }),
      blasts: [],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.overdueDays).toBe(5)
    expect(facts.watchouts.some((w) => w.startsWith('Past due'))).toBe(true)
  })

  it('overdue: false when the project is delivered, even past due_date', () => {
    const facts = buildSummaryFacts({
      project: project({ due_date: '2026-07-10', board_column: 'Delivery', delivered_at: '2026-07-09T00:00:00Z' }),
      blasts: [],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.delivered).toBe(true)
    expect(facts.overdueDays).toBeNull()
    expect(facts.watchouts.some((w) => w.startsWith('Past due'))).toBe(false)
  })

  it('overdue: false when due_date is still in the future', () => {
    const facts = buildSummaryFacts({
      project: project({ due_date: '2026-08-01', board_column: 'Fielding' }),
      blasts: [],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.overdueDays).toBe(0)
    expect(facts.watchouts.some((w) => w.startsWith('Past due'))).toBe(false)
  })

  it('burn: true when spend% outruns N% by more than 10 points', () => {
    const facts = buildSummaryFacts({
      project: project({ actual_spend: 5000, budget: 10000, n_collected: 300, n_target: 1000 }),
      blasts: [],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.spendPct).toBe(50)
    expect(facts.nPct).toBe(30)
    expect(facts.watchouts.some((w) => w.includes('Spending ahead'))).toBe(true)
  })

  it('burn: false when the spend/N gap is within 10 points', () => {
    const facts = buildSummaryFacts({
      project: project({ actual_spend: 4000, budget: 10000, n_collected: 350, n_target: 1000 }),
      blasts: [],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.spendPct).toBe(40)
    expect(facts.nPct).toBe(35)
    expect(facts.watchouts.some((w) => w.includes('Spending ahead'))).toBe(false)
  })

  it('dip: true when the latest blast completion rate is lower than the first', () => {
    const facts = buildSummaryFacts({
      project: project(),
      blasts: [
        blast({ id: 'b1', blast_at: '2026-07-01T00:00:00Z', people: 1000, completes: 400 }), // 40%
        blast({ id: 'b2', blast_at: '2026-07-10T00:00:00Z', people: 1000, completes: 100 }), // 10%
      ],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.blastCompletion).toEqual({ firstPct: 40, lastPct: 10, dipped: true })
    expect(facts.watchouts.some((w) => w.includes('dipped'))).toBe(true)
  })

  it('dip: false when completion rate rises', () => {
    const facts = buildSummaryFacts({
      project: project(),
      blasts: [
        blast({ id: 'b1', blast_at: '2026-07-01T00:00:00Z', people: 1000, completes: 100 }),
        blast({ id: 'b2', blast_at: '2026-07-10T00:00:00Z', people: 1000, completes: 400 }),
      ],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.blastCompletion.dipped).toBe(false)
    expect(facts.watchouts.some((w) => w.includes('dipped'))).toBe(false)
  })

  it('dip: false when the rate is unchanged', () => {
    const facts = buildSummaryFacts({
      project: project(),
      blasts: [
        blast({ id: 'b1', blast_at: '2026-07-01T00:00:00Z', people: 1000, completes: 200 }),
        blast({ id: 'b2', blast_at: '2026-07-10T00:00:00Z', people: 1000, completes: 200 }),
      ],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.blastCompletion.dipped).toBe(false)
  })

  it('dip: false with fewer than 2 blasts', () => {
    const facts = buildSummaryFacts({
      project: project(),
      blasts: [blast({ id: 'b1', blast_at: '2026-07-01T00:00:00Z', people: 1000, completes: 200 })],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.blastCompletion).toEqual({ firstPct: 20, lastPct: 20, dipped: false })
  })

  it('dip: false with no blasts at all', () => {
    const facts = buildSummaryFacts({
      project: project(),
      blasts: [],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.blastCompletion).toEqual({ firstPct: null, lastPct: null, dipped: false })
  })
})

describe('buildSummaryFacts — happy path shape', () => {
  it('computes stage/N/spend/flags/rerun/next-steps for known inputs', () => {
    const facts = buildSummaryFacts({
      project: project({
        board_column: 'Fielding',
        n_collected: 250,
        n_target: 500,
        actual_spend: 1000,
        budget: 4000,
        longitudinal: true,
        rerun_number: 2,
        voter_survey_qa: true,
        row_level_data: true,
      }),
      blasts: [],
      stageHistory: [
        { stage: 'Doc Programming', entered_at: '2026-07-01T00:00:00Z' },
        { stage: 'Fielding', entered_at: '2026-07-05T00:00:00Z' },
      ],
      now: '2026-07-10T00:00:00Z',
      openNextSteps: ['Send reminder email'],
    })

    expect(facts.stage).toBe('Fielding')
    expect(facts.daysInStage).toBe(5)
    expect(facts.delivered).toBe(false)
    expect(facts.nCollected).toBe(250)
    expect(facts.nTarget).toBe(500)
    expect(facts.nPct).toBe(50)
    expect(facts.spend).toBe(1000)
    expect(facts.budget).toBe(4000)
    expect(facts.spendPct).toBe(25)
    expect(facts.costPerComplete).toBe(4)
    expect(facts.compliance).toBe('n/a')
    expect(facts.flagsOn).toEqual(['Longitudinal', 'Voter Survey QA', 'Row-Level Data'])
    expect(facts.rerun).toBe('Wave 2')
    expect(facts.nextSteps).toEqual(['Send reminder email'])
    // No due_date, and spend% (25) is behind N% (50), and no blasts → no watch-outs.
    expect(facts.watchouts).toEqual([])
  })

  it('daysInStage / rerun / compliance are defensive when data is absent', () => {
    const facts = buildSummaryFacts({
      project: project({ longitudinal: false, compliance_override: null }),
      blasts: [],
      stageHistory: [],
      now: '2026-07-10T00:00:00Z',
    })
    expect(facts.daysInStage).toBeNull()
    expect(facts.rerun).toBeNull()
    expect(facts.compliance).toBe('n/a')
    expect(facts.nextSteps).toEqual([])
  })

  it('reports compliance_override when explicitly set', () => {
    expect(buildSummaryFacts({ project: project({ compliance_override: true }), blasts: [], stageHistory: [], now: '2026-07-10' }).compliance).toBe(
      'compliance required (override)'
    )
    expect(buildSummaryFacts({ project: project({ compliance_override: false }), blasts: [], stageHistory: [], now: '2026-07-10' }).compliance).toBe(
      'compliance waived (override)'
    )
  })
})

describe('buildSummaryFacts — status & delivered lifecycle', () => {
  it('open project → Open, not archived, no delivered date', () => {
    const facts = buildSummaryFacts({
      project: project({ status: 'Open', board_column: 'Fielding', delivered_at: null }),
      blasts: [],
      stageHistory: [],
      now: '2026-07-10T00:00:00Z',
    })
    expect(facts.status).toBe('Open')
    expect(facts.archived).toBe(false)
    expect(facts.delivered).toBe(false)
    expect(facts.deliveredDate).toBeNull()
  })

  it('closed + delivered → Archived, delivered true, dated with the year', () => {
    const facts = buildSummaryFacts({
      project: project({ status: 'Closed', board_column: 'Delivery', delivered_at: '2026-04-09T00:00:00Z' }),
      blasts: [],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.status).toBe('Archived')
    expect(facts.archived).toBe(true)
    expect(facts.delivered).toBe(true)
    expect(facts.deliveredDate).toBe('Apr 9, 2026')
  })

  it('falls back to deliver_date when delivered_at is absent', () => {
    const facts = buildSummaryFacts({
      project: project({ status: 'Closed', board_column: 'Delivery', delivered_at: null, deliver_date: '2026-04-09' }),
      blasts: [],
      stageHistory: [],
      now: '2026-07-15T00:00:00Z',
    })
    expect(facts.deliveredDate).toBe('Apr 9, 2026')
  })

  it('on hold → On hold', () => {
    const facts = buildSummaryFacts({
      project: project({ status: 'Hold' }),
      blasts: [],
      stageHistory: [],
      now: '2026-07-10T00:00:00Z',
    })
    expect(facts.status).toBe('On hold')
  })
})
