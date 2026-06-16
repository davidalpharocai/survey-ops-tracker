import { describe, it, expect } from 'vitest'
import { matchDeliverable, normalizeName } from './matcher'
import type { MatchInput } from './types'

const base: Omit<MatchInput, 'subject' | 'body' | 'fromEmail'> = {
  clients: [
    { id: 'c-bam', name: 'Balyasny', code: 'Cl00012' },
    { id: 'c-a4a', name: 'Airlines 4 America (A4A)', code: 'Cl00003' },
  ],
  projects: [
    { id: 'p-1', client_id: 'c-bam', project_code: 'PR00112', project_name: 'Q2 Consumer Tracker' },
    { id: 'p-2', client_id: 'c-a4a', project_code: 'PR00040', project_name: 'TSA Poll' },
  ],
  contacts: [{ email: 'rspicer@airlines.org', client_id: 'c-a4a', project_id: 'p-2' }],
  domainMap: { 'airlines.org': 'c-a4a' },
}

describe('matchDeliverable', () => {
  it('tier 1: PR code in subject wins with ~certain confidence', () => {
    const r = matchDeliverable({ ...base, subject: 'Final deck PR00112', body: '', fromEmail: 'x@gmail.com' })
    expect(r.projectId).toBe('p-1')
    expect(r.clientId).toBe('c-bam')
    expect(r.method).toBe('code')
    expect(r.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it('tier 2: known contact email resolves client + its project', () => {
    const r = matchDeliverable({ ...base, subject: 'results', body: '', fromEmail: 'rspicer@airlines.org' })
    expect(r.clientId).toBe('c-a4a')
    expect(r.projectId).toBe('p-2')
    expect(r.method).toBe('contact_email')
  })

  it('tier 3: domain maps to client; shared domains are ignored', () => {
    const r = matchDeliverable({ ...base, subject: 'hi', body: '', fromEmail: 'new.person@airlines.org' })
    expect(r.clientId).toBe('c-a4a')
    expect(r.method).toBe('domain')

    const r2 = matchDeliverable({ ...base, subject: 'hi', body: '', fromEmail: 'someone@gmail.com' })
    expect(r2.method).toBe('none')
  })

  it('tier 4: project name in body resolves the project', () => {
    const r = matchDeliverable({ ...base, subject: 'deliverable', body: 'Attached is the Q2 Consumer Tracker topline', fromEmail: 'x@gmail.com' })
    expect(r.projectId).toBe('p-1')
    expect(r.method).toBe('name')
  })

  it('resolves the single project when only the client is known', () => {
    const onlyBam = { ...base, projects: [base.projects[0]] }
    const r = matchDeliverable({ ...onlyBam, subject: 'x', body: '', fromEmail: 'cfo@balyasny.com', domainMap: { 'balyasny.com': 'c-bam' } })
    expect(r.clientId).toBe('c-bam')
    expect(r.projectId).toBe('p-1') // only one project for the client
  })

  it('returns none when nothing matches', () => {
    const r = matchDeliverable({ ...base, subject: 'lunch?', body: 'see you at noon', fromEmail: 'friend@gmail.com' })
    expect(r.method).toBe('none')
    expect(r.clientId).toBeNull()
  })

  // (a) Cl-code branch
  it('tier 1: Cl code in subject resolves to that client with method=code', () => {
    const r = matchDeliverable({ ...base, subject: 'Deliverables for Cl00012', body: '', fromEmail: 'x@gmail.com' })
    expect(r.clientId).toBe('c-bam')
    expect(r.method).toBe('code')
    expect(r.confidence).toBeCloseTo(0.95, 2)
    // c-bam has exactly one project (p-1) so the resolver promotes it
    expect(r.projectId).toBe('p-1')
  })

  // (b) PR code with no matching project falls through to tier 2
  it('PR code for unknown project falls through to contact_email', () => {
    // PR99999 does not exist in the fixture → tier 1 yields no candidate
    // rspicer@airlines.org is a known contact → tier 2 fires
    const r = matchDeliverable({ ...base, subject: 'Final deck PR99999', body: '', fromEmail: 'rspicer@airlines.org' })
    expect(r.method).toBe('contact_email')
    expect(r.projectId).toBe('p-2')
  })

  // (c) Tie-break determinism when two project-name candidates share the same confidence
  it('tie-break: first project in input.projects order wins when both score 0.75', () => {
    // Both "Q2 Consumer Tracker" and "TSA Poll" appear in the body → each pushes a 0.75 candidate.
    // Array.prototype.sort is stable (guaranteed since ES2019/V8), so the candidate pushed first
    // (p-1, which iterates first in input.projects) stays ahead and wins.
    const r = matchDeliverable({
      ...base,
      subject: 'combined report',
      body: 'See the Q2 Consumer Tracker and TSA Poll results',
      fromEmail: 'x@gmail.com',
    })
    expect(r.projectId).toBe('p-1') // p-1 appears first in base.projects → stable-sort winner
    expect(r.confidence).toBe(0.75)
    expect(r.method).toBe('name')
  })
})
