import { describe, it, expect } from 'vitest'
import { matchEmail } from './match'
import type { EmailContactRec, EmailMatchData, EmailProjectRec } from './load'

const NOW = new Date('2026-07-07T12:00:00Z')
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

/** Build a project record with sensible active-operational defaults. */
function P(o: Partial<EmailProjectRec> & { id: string }): EmailProjectRec {
  return {
    id: o.id,
    project_code: o.project_code ?? null,
    client_id: o.client_id ?? null,
    project_name: o.project_name ?? 'Untitled Project',
    status: o.status ?? 'Open',
    phase: o.phase ?? 'Active',
    board_column: o.board_column ?? 'Fielding',
    rerun_series_id: o.rerun_series_id ?? null,
    rerun_number: o.rerun_number ?? 1,
    delivered_at: o.delivered_at ?? null,
    survey_ids_from_sheet: o.survey_ids_from_sheet ?? null,
  }
}

function data(
  projects: EmailProjectRec[],
  contacts: EmailContactRec[] = [],
  surveyIdMap: Map<string, string[]> = new Map()
): EmailMatchData {
  return { projects, contacts, surveyIdMap }
}

describe('matchEmail — explicit PR-code (always auto-log, any state)', () => {
  it('auto-logs a PR-code match even for a Closed/Delivered project', () => {
    const p = P({ id: 'p1', project_code: 'PR00001', client_id: 'c1', status: 'Closed', board_column: 'Delivery' })
    const r = matchEmail(
      { fromEmail: 'stranger@nowhere.com', toEmails: [], subject: 'Re: PR00001 topline', body: '' },
      data([p])
    )
    expect(r.decision).toBe('auto-log')
    expect(r.projectId).toBe('p1')
    expect(r.clientId).toBe('c1')
    expect(r.method).toBe('code')
    expect(r.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it('matches a lower-case code appearing in the body', () => {
    const p = P({ id: 'p2', project_code: 'PR00002', client_id: 'c2' })
    const r = matchEmail(
      { fromEmail: 'x@ext.com', toEmails: [], subject: 'update', body: 'see pr00002 please' },
      data([p])
    )
    expect(r.decision).toBe('auto-log')
    expect(r.projectId).toBe('p2')
  })

  it('ignores the watch window: Delivered past-sweep + code still auto-logs', () => {
    const p = P({ id: 'p12', project_code: 'PR00012', client_id: 'c12', board_column: 'Delivery', delivered_at: days(-30) })
    const r = matchEmail(
      { fromEmail: 'stranger@x.com', toEmails: [], subject: 'PR00012', body: '' },
      data([p]),
      { now: NOW }
    )
    expect(r.decision).toBe('auto-log')
    expect(r.projectId).toBe('p12')
  })

  it('routes to pending_no_project when a PR-code is present but the project is missing', () => {
    const r = matchEmail(
      { fromEmail: 'stranger@unknown.com', toEmails: [], subject: 'PR99999?', body: '' },
      data([])
    )
    expect(r.decision).toBe('pending_no_project')
  })
})

describe('matchEmail — validated survey-ID', () => {
  it('auto-logs a single-owner survey-ID in any state (membership, not substring)', () => {
    const p = P({ id: 'p4', client_id: 'c4', status: 'Closed', board_column: 'Delivery', survey_ids_from_sheet: 'ALACME20260101' })
    const map = new Map([['ALACME20260101', ['p4']]])
    const r = matchEmail(
      { fromEmail: 'x@ext.com', toEmails: [], subject: 'results for ALACME20260101', body: '' },
      data([p], [], map)
    )
    expect(r.decision).toBe('auto-log')
    expect(r.projectId).toBe('p4')
    expect(r.method).toBe('survey_id')
  })

  it('never substring-matches a survey-ID (embedded token is not a hit)', () => {
    const map = new Map([['ABCD1234', ['p5']]])
    const p = P({ id: 'p5', client_id: 'c5' })
    const r = matchEmail(
      { fromEmail: 'stranger@unknown.com', toEmails: [], subject: 'ref XABCD1234X', body: '' },
      data([p], [], map)
    )
    expect(r.decision).toBe('review')
    expect(r.projectId).toBeNull()
  })

  it('routes a survey-ID owned by >1 project to review with both candidates', () => {
    const map = new Map([['SHARED99', ['pa', 'pb']]])
    const pa = P({ id: 'pa', client_id: 'ca' })
    const pb = P({ id: 'pb', client_id: 'cb' })
    const r = matchEmail(
      { fromEmail: 'x@ext.com', toEmails: [], subject: 'about SHARED99', body: '' },
      data([pa, pb], [], map)
    )
    expect(r.decision).toBe('review')
    expect(r.candidates.map((c) => c.projectId).sort()).toEqual(['pa', 'pb'])
  })
})

describe('matchEmail — single active-operational (fuzzy, flag-gated)', () => {
  const p = P({ id: 'p7', client_id: 'c7', board_column: 'Fielding' })
  const contacts: EmailContactRec[] = [{ email: 'jane@acme.com', client_id: 'c7', project_id: null }]
  const input = { fromEmail: 'jane@acme.com', toEmails: ['ops@alpharoc.ai'], subject: 'hello', body: 'quick question' }

  it('Phase 1 (fuzzyAutoLog=false) routes a single-active contact match to review', () => {
    const r = matchEmail(input, data([p], contacts))
    expect(r.decision).toBe('review')
    expect(r.direction).toBe('inbound')
    expect(r.method).toBe('contact_email')
    expect(r.candidates[0].projectId).toBe('p7')
  })

  it('Phase 2 (fuzzyAutoLog=true) auto-logs a single-active contact match', () => {
    const r = matchEmail(input, data([p], contacts), { fuzzyAutoLog: true })
    expect(r.decision).toBe('auto-log')
    expect(r.projectId).toBe('p7')
    expect(r.clientId).toBe('c7')
  })

  it('routes to review when the client has 2+ active projects (both candidates)', () => {
    const p1 = P({ id: 'p8a', client_id: 'c8' })
    const p2 = P({ id: 'p8b', client_id: 'c8' })
    const c: EmailContactRec[] = [{ email: 'jane@acme.com', client_id: 'c8', project_id: null }]
    const r = matchEmail({ fromEmail: 'jane@acme.com', toEmails: [], subject: 'hi', body: '' }, data([p1, p2], c), { fuzzyAutoLog: true })
    expect(r.decision).toBe('review')
    expect(r.candidates.map((x) => x.projectId).sort()).toEqual(['p8a', 'p8b'])
  })

  it('does NOT go pending when a client resolves despite an unresolved code', () => {
    const px = P({ id: 'p18', client_id: 'c18' })
    const c: EmailContactRec[] = [{ email: 'jane@acme.com', client_id: 'c18', project_id: null }]
    const r = matchEmail({ fromEmail: 'jane@acme.com', toEmails: [], subject: 'PR99999 maybe', body: '' }, data([px], c))
    expect(r.decision).toBe('review')
  })
})

describe('matchEmail — rerun family disambiguation', () => {
  const w1 = P({ id: 'w1', client_id: 'c9', rerun_series_id: 'S', rerun_number: 1 })
  const w2 = P({ id: 'w2', client_id: 'c9', rerun_series_id: 'S', rerun_number: 2 })
  const c: EmailContactRec[] = [{ email: 'jane@acme.com', client_id: 'c9', project_id: null }]
  const input = { fromEmail: 'jane@acme.com', toEmails: [], subject: 'hi', body: '' }

  it('auto-logs the newest non-Delivered in-window wave (fuzzyAutoLog=true)', () => {
    const r = matchEmail(input, data([w1, w2], c), { fuzzyAutoLog: true, now: NOW })
    expect(r.decision).toBe('auto-log')
    expect(r.projectId).toBe('w2')
  })

  it('still reviews under Phase 1 default (but resolves the single wave candidate)', () => {
    const r = matchEmail(input, data([w1, w2], c), { now: NOW })
    expect(r.decision).toBe('review')
    expect(r.candidates[0].projectId).toBe('w2')
  })
})

describe('matchEmail — direction', () => {
  it('treats an @alpharoc sender as outbound and resolves the client from recipients', () => {
    const p = P({ id: 'p10', client_id: 'c10' })
    const c: EmailContactRec[] = [{ email: 'jane@acme.com', client_id: 'c10', project_id: null }]
    const r = matchEmail({ fromEmail: 'david@alpharoc.ai', toEmails: ['jane@acme.com'], subject: 'hi', body: '' }, data([p], c), { fuzzyAutoLog: true })
    expect(r.direction).toBe('outbound')
    expect(r.decision).toBe('auto-log')
    expect(r.projectId).toBe('p10')
  })
})

describe('matchEmail — watch window (fuzzy)', () => {
  const c: EmailContactRec[] = [{ email: 'jane@acme.com', client_id: 'c11', project_id: null }]
  const input = { fromEmail: 'jane@acme.com', toEmails: [], subject: 'x', body: '' }

  it('auto-logs during the Sweep window (delivered within 2 days)', () => {
    const sweep = P({ id: 'ps', client_id: 'c11', board_column: 'Delivery', delivered_at: days(-1) })
    const r = matchEmail(input, data([sweep], c), { fuzzyAutoLog: true, now: NOW })
    expect(r.decision).toBe('auto-log')
    expect(r.projectId).toBe('ps')
  })

  it('reviews once past the Sweep window (delivered 10 days ago)', () => {
    const past = P({ id: 'pp', client_id: 'c11', board_column: 'Delivery', delivered_at: days(-10) })
    const r = matchEmail(input, data([past], c), { fuzzyAutoLog: true, now: NOW })
    expect(r.decision).toBe('review')
  })

  it('reviews a Delivered project with a NULL delivered_at (past-sweep)', () => {
    const nul = P({ id: 'pn', client_id: 'c11', board_column: 'Delivery', delivered_at: null })
    const r = matchEmail(input, data([nul], c), { fuzzyAutoLog: true, now: NOW })
    expect(r.decision).toBe('review')
  })
})

describe('matchEmail — fuzzy client tiers', () => {
  it('resolves a client by a non-shared sender domain (auto-logs only under fuzzyAutoLog)', () => {
    const p = P({ id: 'p15', client_id: 'c15' })
    const c: EmailContactRec[] = [{ email: 'jane@acme.com', client_id: 'c15', project_id: null }]
    const input = { fromEmail: 'bob@acme.com', toEmails: [], subject: 'hi', body: '' }
    expect(matchEmail(input, data([p], c), { fuzzyAutoLog: true }).method).toBe('domain')
    expect(matchEmail(input, data([p], c), { fuzzyAutoLog: true }).decision).toBe('auto-log')
    expect(matchEmail(input, data([p], c)).decision).toBe('review')
  })

  it('downgrades a shared-domain exact contact to review even with fuzzyAutoLog', () => {
    const p = P({ id: 'p16', client_id: 'c16' })
    const c: EmailContactRec[] = [{ email: 'alice@gmail.com', client_id: 'c16', project_id: null }]
    const r = matchEmail({ fromEmail: 'alice@gmail.com', toEmails: [], subject: 'hi', body: '' }, data([p], c), { fuzzyAutoLog: true })
    expect(r.decision).toBe('review')
    expect(r.clientId).toBe('c16')
  })

  it('resolves via project-name text (auto-logs only under fuzzyAutoLog)', () => {
    const p = P({ id: 'p17', client_id: 'c17', project_name: 'Coatue Brand Tracker' })
    const input = { fromEmail: 'stranger@ext.com', toEmails: [], subject: 'notes', body: 'quick note on the Coatue Brand Tracker rollout' }
    const r = matchEmail(input, data([p]))
    expect(r.decision).toBe('review')
    expect(r.method).toBe('name')
    expect(r.candidates[0].projectId).toBe('p17')
    expect(matchEmail(input, data([p]), { fuzzyAutoLog: true }).decision).toBe('auto-log')
  })

  it('routes a contact email mapping to >1 client to review with per-client candidates', () => {
    const p1 = P({ id: 'pm1', client_id: 'cm1' })
    const p2 = P({ id: 'pm2', client_id: 'cm2' })
    const c: EmailContactRec[] = [
      { email: 'shared@vendor.com', client_id: 'cm1', project_id: null },
      { email: 'shared@vendor.com', client_id: 'cm2', project_id: null },
    ]
    const r = matchEmail({ fromEmail: 'shared@vendor.com', toEmails: [], subject: 'hi', body: '' }, data([p1, p2], c), { fuzzyAutoLog: true })
    expect(r.decision).toBe('review')
    expect(r.candidates.map((x) => x.clientId).sort()).toEqual(['cm1', 'cm2'])
  })

  it('reviews an unknown sender with no client and no explicit signal', () => {
    const r = matchEmail({ fromEmail: 'nobody@random.com', toEmails: [], subject: 'hello', body: 'just chatting' }, data([]))
    expect(r.decision).toBe('review')
    expect(r.clientId).toBeNull()
    expect(r.candidates).toEqual([])
  })
})
