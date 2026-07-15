import { describe, it, expect, vi } from 'vitest'
import { aiMatch, serverCorroborates, type AiMatchInput } from './ai-matcher'

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeClient(toolInput: unknown) {
  return {
    messages: {
      stream: vi.fn().mockReturnValue({
        finalMessage: vi.fn().mockResolvedValue({
          content: [{ type: 'tool_use', name: 'pick_survey', input: toolInput }],
          stop_reason: 'end_turn',
        }),
      }),
    },
  }
}
function throwingClient() {
  return { messages: { stream: vi.fn(() => { throw new Error('boom') }) } }
}

const base: AiMatchInput = {
  from: 'analyst@alpharoc.ai',
  subject: 'Fwd: Korea Survey',
  filename: 'Wellington - Harvey Study.xlsx',
  bodySnippet: 'see attached',
  candidates: [{ projectCode: 'PR00226', projectName: 'Harvey Study', clientName: 'Wellington' }],
  history: [],
}

describe('aiMatch', () => {
  it('returns a validated pick', async () => {
    const r = await aiMatch(base, fakeClient({ projectCode: 'PR00226', confidence: 0.95, reasoning: 'filename', corroboratingSignal: 'filename' }) as any)
    expect(r.projectCode).toBe('PR00226')
    expect(r.confidence).toBeCloseTo(0.95)
    expect(r.corroboratingSignal).toBe('filename')
  })

  it('coerces a hallucinated code to null (unsure)', async () => {
    const r = await aiMatch(base, fakeClient({ projectCode: 'PR99999', confidence: 0.9, reasoning: 'x', corroboratingSignal: null }) as any)
    expect(r.projectCode).toBeNull()
    expect(r.confidence).toBe(0)
  })

  it('handles a genuine unsure (null pick)', async () => {
    const r = await aiMatch(base, fakeClient({ projectCode: null, confidence: 0, reasoning: 'weak', corroboratingSignal: null }) as any)
    expect(r.projectCode).toBeNull()
  })

  it('never throws — returns a null result on client error', async () => {
    const r = await aiMatch(base, throwingClient() as any)
    expect(r.projectCode).toBeNull()
    expect(r.reasoning).toMatch(/ai error/)
  })

  it('skips the call when there are no candidates', async () => {
    const c = fakeClient({})
    const r = await aiMatch({ ...base, candidates: [] }, c as any)
    expect(c.messages.stream).not.toHaveBeenCalled()
    expect(r.projectCode).toBeNull()
  })
})

describe('serverCorroborates', () => {
  const d = { clientName: 'Wellington', projectName: 'Harvey Study', senderDomainMatchesClient: false, clientHasHistory: false }
  it('true when the client name is in the haystack', () => {
    expect(serverCorroborates({ ...d, haystack: 'Wellington - Harvey Study.xlsx' })).toBe(true)
  })
  it('true on a distinctive project-name token', () => {
    expect(serverCorroborates({ ...d, haystack: 'harvey deck.pdf' })).toBe(true)
  })
  it('true when the sender domain maps to the client', () => {
    expect(serverCorroborates({ ...d, haystack: 'x.pdf', senderDomainMatchesClient: true })).toBe(true)
  })
  it('true when the client has prior filings', () => {
    expect(serverCorroborates({ ...d, haystack: 'x.pdf', clientHasHistory: true })).toBe(true)
  })
  it('false when nothing supports the pick', () => {
    expect(serverCorroborates({ ...d, haystack: 'q3 report.pdf' })).toBe(false)
  })
})
