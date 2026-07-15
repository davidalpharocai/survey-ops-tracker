import { describe, it, expect } from 'vitest'
import { matchDeliverable } from './matcher'
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

  // (d) Distinctive-token fallback: a forward whose subject drops the boilerplate still guesses the project
  it('tier 4 (token): a distinctive project-name word matches when the full name is not present', () => {
    const projects = [{ id: 'p-k', client_id: 'c-bam', project_code: 'PR00227', project_name: 'Korea Consumer Survey' }]
    const r = matchDeliverable({ ...base, projects, subject: 'Fwd: Korea Survey', body: 'see attached', fromEmail: 'x@gmail.com' })
    expect(r.projectId).toBe('p-k')
    expect(r.method).toBe('name')
    expect(r.confidence).toBeGreaterThanOrEqual(0.6)
    expect(r.confidence).toBeLessThan(0.85) // stays in review — a fuzzy token never auto-files
  })

  // (e) Never resolve to our own company from fuzzy text (a forwarder's signature/domain)
  it('does not match our own company (AlphaROC) from body/signature text', () => {
    const clients = [
      { id: 'c-self', name: 'AlphaROC', code: 'Cl00003' },
      { id: 'c-bam', name: 'Balyasny', code: 'Cl00012' },
    ]
    const r = matchDeliverable({
      ...base, clients, projects: [], contacts: [], domainMap: {},
      subject: 'Korea deck', body: 'Thanks,\nJane\nAlphaROC', fromEmail: 'jane@alpharoc.ai',
    })
    expect(r.method).toBe('none')
    expect(r.clientId).toBeNull()
  })

  // (f) Generic survey words alone must not token-match a project
  it('does not token-match on generic survey jargon alone', () => {
    const projects = [{ id: 'p-1', client_id: 'c-bam', project_code: 'PR00112', project_name: 'Q2 Consumer Tracker' }]
    const r = matchDeliverable({ ...base, projects, subject: 'quarterly consumer report', body: 'the tracker data', fromEmail: 'x@gmail.com' })
    expect(r.method).toBe('none') // "consumer"/"tracker" are stopwords; "q2" is too short → no distinctive token
  })

  // (g) The attachment filename drives the match when subject/body are generic (the common forward case)
  it('tier 4 (filename): a distinctive word in the attachment filename resolves the project', () => {
    const clients = [{ id: 'c-aarp', name: 'AARP', code: 'Cl00050' }, ...base.clients]
    const projects = [{ id: 'p-aarp', client_id: 'c-aarp', project_code: 'PR00185', project_name: 'AARP Membership (2 questions)' }]
    const r = matchDeliverable({
      ...base, clients, projects, contacts: [], domainMap: {},
      subject: 'Data now available', body: 'See attached, thanks.', fromEmail: 'x@gmail.com',
      filenames: ['AARP - July Study - Deliverable'],
    })
    expect(r.projectId).toBe('p-aarp')
    expect(r.method).toBe('name')
    expect(r.confidence).toBeLessThan(0.85) // fuzzy signal — stays in review, never auto-files
  })

  // (h) A distinctive word that appears ONLY in the quoted body must not drive matching (that was the
  // "Wellington/Harvey → wrong project" noise: a long forwarded thread hitting random project tokens).
  it('ignores distinctive words that appear only in the email body', () => {
    const projects = [{ id: 'p-k', client_id: 'c-bam', project_code: 'PR00227', project_name: 'Korea Consumer Survey' }]
    const r = matchDeliverable({
      ...base, projects,
      subject: 'Fwd: quick follow up', body: 'earlier we discussed the Korea numbers at length', fromEmail: 'x@gmail.com',
      filenames: ['Q3 deck'],
    })
    expect(r.method).toBe('none') // "Korea" is only in the body → not a match signal
  })

  // (i) Client-first: a distinctive CLIENT name in the filename beats another client's verbatim project name.
  // Real bug: "holocene_ai_tracker_survey" contains Bain's whole project name "AI tracker" (→ 0.75 verbatim),
  // but the file is Holocene's. The client named in the file must win; the cross-client match is demoted.
  it('client-first: the client named in the file wins over another client\'s verbatim project-name match', () => {
    const clients = [
      { id: 'c-bain', name: 'Bain', code: 'Cl00030' },
      { id: 'c-holo', name: 'Holocene', code: 'Cl00031' },
    ]
    const projects = [
      { id: 'p-bain', client_id: 'c-bain', project_code: 'PR00039', project_name: 'AI tracker' },
      { id: 'p-holo', client_id: 'c-holo', project_code: 'PR00149', project_name: 'Holocene Tracker' },
    ]
    const r = matchDeliverable({
      ...base, clients, projects, contacts: [], domainMap: {},
      subject: 'Fwd: New Occam data', body: 'see attached', fromEmail: 'x@gmail.com',
      filenames: ['holocene_ai_tracker_survey_0715'],
    })
    expect(r.clientId).toBe('c-holo')
    expect(r.projectId).toBe('p-holo')
    expect(r.method).toBe('name')
    // the cross-client Bain candidate is demoted below the Holocene match
    const bain = r.candidates.find((c) => c.projectId === 'p-bain')
    if (bain) expect(bain.confidence).toBeLessThanOrEqual(0.35)
  })
})
