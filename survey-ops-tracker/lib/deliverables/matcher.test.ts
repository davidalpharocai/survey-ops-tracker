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
})
