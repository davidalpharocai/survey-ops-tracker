import { describe, it, expect } from 'vitest'
import {
  csvColumnsFor,
  csvIncludedRestricted,
  buildProjectsCsv,
} from './exportCsv'
import type { SurveyProject } from '@/lib/hooks/useProjects'

// A partial row is enough: every column reads one field, and a missing field
// renders as an empty cell — which is exactly what a sparse real project does.
const project = {
  project_code: 'PR00123',
  project_name: 'Homebuyer Sentiment',
  client: 'Holocene',
  n_target: 800,
  budget: 12500,
  actual_spend: 9100,
} as unknown as SurveyProject

const headersOf = (canViewFinancials: boolean) =>
  csvColumnsFor(canViewFinancials).map(c => c.header)

describe('csvColumnsFor', () => {
  it('omits Budget for a user without view_financials', () => {
    expect(headersOf(false)).not.toContain('Budget')
  })

  it('includes Budget for a capability holder', () => {
    expect(headersOf(true)).toContain('Budget')
  })

  it('keeps cost-to-run public — Actual Spend survives the strip', () => {
    // The locked decision: budget/price/margin are restricted, what we actually
    // spent is everyone's business.
    expect(headersOf(false)).toContain('Actual Spend')
  })

  it('strips ONLY the restricted columns', () => {
    const restricted = csvColumnsFor(true).filter(c => c.restricted).map(c => c.header)
    const gated = headersOf(false)
    expect(restricted.length).toBeGreaterThan(0)
    expect(headersOf(true).filter(h => !restricted.includes(h))).toEqual(gated)
  })

  it('does not mutate the shared column list between calls', () => {
    const before = headersOf(true).length
    headersOf(false)
    expect(headersOf(true)).toHaveLength(before)
  })
})

describe('csvIncludedRestricted', () => {
  it('is what gets logged: true only when restricted columns were written', () => {
    expect(csvIncludedRestricted(csvColumnsFor(true))).toBe(true)
    expect(csvIncludedRestricted(csvColumnsFor(false))).toBe(false)
  })
})

describe('buildProjectsCsv', () => {
  it("a non-holder's file contains neither the header nor the value", () => {
    const csv = buildProjectsCsv([project], csvColumnsFor(false))
    expect(csv).not.toContain('Budget')
    expect(csv).not.toContain('12500')
    // ...but the row is otherwise intact, including the public money.
    expect(csv).toContain('PR00123')
    expect(csv).toContain('9100')
  })

  it("a holder's file carries the budget", () => {
    const csv = buildProjectsCsv([project], csvColumnsFor(true))
    expect(csv).toContain('Budget')
    expect(csv).toContain('12500')
  })

  it('keeps header and row column counts in step after stripping', () => {
    const [header, row] = buildProjectsCsv([project], csvColumnsFor(false)).split('\r\n')
    expect(row.split(',')).toHaveLength(header.split(',').length)
  })

  it('writes a header-only file for no projects', () => {
    expect(buildProjectsCsv([], csvColumnsFor(false)).split('\r\n')).toHaveLength(1)
  })
})
