import { describe, it, expect } from 'vitest'
import { confidenceBand, routeMatch, describeCandidates, AUTO_FILE_THRESHOLD } from './confidence'
import type { MatchResult } from './types'

const matchData = {
  clients: [{ id: 'c1', name: 'Coatue', code: 'CL001' }],
  projects: [{ id: 'p1', client_id: 'c1', project_code: 'PR00003', project_name: 'B2B Tracker' }],
}

describe('confidenceBand', () => {
  it('maps scores to High/Med/Low', () => {
    expect(confidenceBand(0.9)).toBe('High')
    expect(confidenceBand(AUTO_FILE_THRESHOLD)).toBe('High')
    expect(confidenceBand(0.7)).toBe('Med')
    expect(confidenceBand(0.2)).toBe('Low')
  })
})

describe('routeMatch', () => {
  const base: MatchResult = { clientId: null, projectId: null, confidence: 0, method: 'none', candidates: [] }
  it('files when confident with a project', () => {
    expect(routeMatch({ ...base, clientId: 'c1', projectId: 'p1', confidence: 0.9 })).toEqual({ confident: true, hasProject: true, status: 'filed' })
  })
  it('unsorted when confident client but no project', () => {
    expect(routeMatch({ ...base, clientId: 'c1', confidence: 0.9 })).toEqual({ confident: true, hasProject: false, status: 'unsorted' })
  })
  it('review when below threshold', () => {
    expect(routeMatch({ ...base, clientId: 'c1', projectId: 'p1', confidence: 0.6 })).toEqual({ confident: false, hasProject: true, status: 'review' })
  })
  it('review when no client even if score is high', () => {
    expect(routeMatch({ ...base, confidence: 0.9 })).toEqual({ confident: false, hasProject: false, status: 'review' })
  })
})

describe('describeCandidates', () => {
  it('labels project candidates as "Client → Project (CODE)" with a band', () => {
    const labeled = describeCandidates(
      [{ clientId: 'c1', projectId: 'p1', confidence: 0.9, reason: 'contact', method: 'contact_email' }],
      matchData,
    )
    expect(labeled).toEqual([{ clientId: 'c1', projectId: 'p1', confidence: 0.9, band: 'High', label: 'Coatue → B2B Tracker (PR00003)' }])
  })
  it('labels client-only candidates with just the client name', () => {
    const labeled = describeCandidates([{ clientId: 'c1', projectId: null, confidence: 0.6, reason: 'cname', method: 'name' }], matchData)
    expect(labeled[0].label).toBe('Coatue')
    expect(labeled[0].band).toBe('Med')
  })
})
