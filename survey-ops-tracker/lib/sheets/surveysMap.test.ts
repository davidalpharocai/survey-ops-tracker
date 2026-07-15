import { describe, it, expect } from 'vitest'
import {
  mappedCells,
  fullRow,
  rowHash,
  updateData,
  classifyLinkedDocs,
  headerGuardOk,
  EXPECTED_HEADERS,
  SHEET_WIDTH,
} from './surveysMap'

const base = {
  latest_next_steps: 'ping client',
  client: 'A4A',
  project_name: 'TSA Poll',
  longitudinal: false,
  project_type: 'PS',
  delivered_at: null,
  submitted_date: '2026-07-01',
  launch_date: null,
  due_date: '2026-07-20',
  deliver_date: null,
  voter_survey_qa: true,
  citation_language_needed: null,
  row_level_data: false,
  n_target: 400,
  n_internal_target: 450,
  n_collected: 0,
  n_actual: null,
  audience_size: 100000,
  terminations: false,
  stage_doc_programming: true,
  stage_survey_programming: false,
  stage_edwin_qa: false,
  stage_fielding: false,
  stage_data_qa: false,
  stage_delivery: false,
  linked_documents: ['https://docs.google.com/document/d/abc', 'https://docs.google.com/spreadsheets/d/xyz'],
  salesperson: 'Jenna Shrove',
  project_code: 'PR00057',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

describe('mappedCells', () => {
  it('places values at the correct sheet columns', () => {
    const c = mappedCells(base, 'CT, SC')
    expect(c[1]).toBe('A4A')
    expect(c[2]).toBe('TSA Poll')
    expect(c[4]).toBe('PS')
    expect(c[5]).toBe('In Progress')
    expect(c[13]).toBe('400')
    expect(c[17]).toBe('100000')
    expect(c[18]).toBe('CT, SC')
    expect(c[37]).toBe('Jenna Shrove')
    expect(c[38]).toBe('PR00057')
  })
  it('derives status from delivered_at', () => {
    expect(mappedCells({ ...base, delivered_at: null }, '')[5]).toBe('In Progress')
    expect(mappedCells({ ...base, delivered_at: '2026-07-10' }, '')[5]).toBe('Done')
  })
  it('formats booleans as TRUE/FALSE and null as blank', () => {
    const c = mappedCells(base, '')
    expect(c[10]).toBe('TRUE')
    expect(c[12]).toBe('FALSE')
    expect(c[11]).toBe('') // citation null -> blank (unknown)
  })
  it('classifies linked docs into Doc (AG=32) and Sheet (AI=34)', () => {
    const c = mappedCells(base, '')
    expect(c[32]).toContain('/document/')
    expect(c[34]).toContain('/spreadsheets/')
  })
})

describe('classifyLinkedDocs', () => {
  it('is blank when no matching link', () => {
    expect(classifyLinkedDocs(null)).toEqual({ doc: '', sheet: '' })
    expect(classifyLinkedDocs(['https://example.com'])).toEqual({ doc: '', sheet: '' })
  })
})

describe('fullRow', () => {
  it('is full-width with blanks in unmapped columns', () => {
    const row = fullRow(mappedCells(base, 'CT'))
    expect(row.length).toBe(SHEET_WIDTH)
    expect(row[20]).toBe('') // gap
    expect(row[30]).toBe('') // Comments (team-owned)
    expect(row[35]).toBe('') // Survey IDs (deferred)
    expect(row[1]).toBe('A4A')
    expect(row[38]).toBe('PR00057')
  })
})

describe('rowHash', () => {
  it('changes when a mapped field changes', () => {
    const a = rowHash(mappedCells(base, 'CT'))
    const b = rowHash(mappedCells({ ...base, n_collected: 10 }, 'CT'))
    expect(a).not.toBe(b)
  })
  it('is stable for identical inputs', () => {
    expect(rowHash(mappedCells(base, 'CT'))).toBe(rowHash(mappedCells(base, 'CT')))
  })
})

describe('updateData', () => {
  it('emits only SOCC-owned ranges for the target row, never the gap/comment columns', () => {
    const ranges = updateData(mappedCells(base, 'CT'), 57).map((r) => r.range)
    expect(ranges).toEqual(['Surveys!A57:T57', 'Surveys!X57:AC57', 'Surveys!AG57:AG57', 'Surveys!AI57:AI57', 'Surveys!AL57:AM57'])
  })
})

describe('headerGuardOk', () => {
  it('passes on the real header order', () => {
    const live: string[] = []
    for (const [i, label] of Object.entries(EXPECTED_HEADERS)) live[Number(i)] = label
    expect(headerGuardOk(live)).toBe(true)
  })
  it('fails if a mapped column drifted', () => {
    const live: string[] = []
    for (const [i, label] of Object.entries(EXPECTED_HEADERS)) live[Number(i)] = label
    live[38] = 'Something Else'
    expect(headerGuardOk(live)).toBe(false)
  })
})
