import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * End-to-end test of the in-app agent loop and its commit endpoint, with the
 * Anthropic stream and Supabase mocked (matching the repo's route-test style).
 *
 * Proves the crux of UI-gated safety:
 *   1. a READ tool call executes inline during the loop;
 *   2. a WRITE tool call does NOT execute — it emits a `pending` event carrying
 *      a signed token, and the model is told the change is not applied;
 *   3. POSTing that token to /api/assistant/act commits the write exactly once.
 */

const h = vi.hoisted(() => ({
  // Spy handlers for the two synthetic registry tools.
  readHandler: vi.fn(async () => ({ ok: true, rows: ['overdue: PR00228'] })),
  appendHandler: vi.fn(async () => ({ ok: true, committed: 'append' })),
  // Queue of scripted Anthropic finalMessages; each messages.stream() shifts one.
  scripts: [] as { content: unknown[]; usage: Record<string, number> }[],
  userEmail: 'david@alpharoc.ai',
}))

// --- Registry: two synthetic tools (one read, one append-write) so the loop is
//     driven deterministically without touching real DB handlers. -------------
vi.mock('@/lib/mcp/registry', async () => {
  const { z } = await import('zod')
  return {
    TOOLS: [
      {
        name: 'fake_read',
        description: 'a read tool',
        kind: 'read' as const,
        schema: { q: z.string().optional() },
        handler: h.readHandler,
      },
      {
        name: 'fake_add',
        description: 'an append write tool',
        kind: 'write' as const,
        schema: { text: z.string() },
        previewSummary: (args: Record<string, unknown>) => `Add "${String(args.text)}"`,
        handler: h.appendHandler,
      },
    ],
  }
})

// --- Anthropic SDK: a scripted, async-iterable stream with finalMessage(). ----
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error { status = 500 }
  class Anthropic {
    messages = {
      stream: () => {
        const final = h.scripts.shift()
        if (!final) throw new Error('no scripted Anthropic response left')
        const deltas = (final.content as { type: string; text?: string }[])
          .filter(b => b.type === 'text')
          .map(b => b.text as string)
        return {
          async *[Symbol.asyncIterator]() {
            for (const text of deltas) {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
            }
          },
          finalMessage: async () => final,
        }
      },
    }
    constructor() { /* no-op */ }
    static AuthenticationError = class extends Error {}
    static PermissionDeniedError = class extends Error {}
    static RateLimitError = class extends Error {}
    static APIError = APIError
  }
  return { default: Anthropic }
})

// --- Supabase (session + admin telemetry sink) --------------------------------
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: h.userEmail } } }) },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ insert: () => Promise.resolve({ error: null }) }) }),
}))
vi.mock('@/lib/server/observability', () => ({
  getAiBudget: async () => ({ blocked: false, cap: 100, spend: 0 }),
  logAiUsage: async () => {},
}))

process.env.ANTHROPIC_API_KEY = 'sk-test-key'
process.env.WEBHOOK_SECRET = 'test-assistant-secret'

import { POST } from './route'
import { POST as ACT } from './act/route'

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

async function readEvents(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text()
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

beforeEach(() => {
  h.readHandler.mockClear()
  h.appendHandler.mockClear()
  h.scripts = []
})

describe('in-app assistant loop', () => {
  it('executes a READ tool inline and never emits a pending write', async () => {
    h.scripts = [
      { content: [{ type: 'tool_use', id: 'tu1', name: 'fake_read', input: { q: 'overdue' } }], usage: {} },
      { content: [{ type: 'text', text: 'PR00228 is overdue.' }], usage: {} },
    ]

    const res = await POST(makeReq({ messages: [{ role: 'user', content: "what's overdue" }] }))
    const events = await readEvents(res)

    expect(h.readHandler).toHaveBeenCalledTimes(1)
    expect(events.some(e => e.type === 'pending')).toBe(false)
    expect(events.some(e => e.type === 'done')).toBe(true)
    const answer = events.filter(e => e.type === 'text').map(e => e.delta).join('')
    expect(answer).toContain('PR00228 is overdue.')
  })

  it('a WRITE tool does NOT execute — it emits a pending event with a signed token', async () => {
    h.scripts = [
      { content: [{ type: 'tool_use', id: 'tu2', name: 'fake_add', input: { text: 'call client' } }], usage: {} },
      { content: [{ type: 'text', text: "I've prepared that — confirm below." }], usage: {} },
    ]

    const res = await POST(makeReq({ messages: [{ role: 'user', content: 'add a next step' }] }))
    const events = await readEvents(res)

    const pending = events.find(e => e.type === 'pending')
    expect(pending, 'a pending event was emitted').toBeTruthy()
    expect(pending!.tool).toBe('fake_add')
    expect(pending!.summary).toBe('Add "call client"')
    expect(typeof pending!.token).toBe('string')
    expect((pending!.token as string).length).toBeGreaterThan(0)
    // The write handler must NOT have run at preview time.
    expect(h.appendHandler).not.toHaveBeenCalled()
  })

  it('act redeems the pending token and commits the write exactly once', async () => {
    // First, run the loop to mint a genuine token for the write.
    h.scripts = [
      { content: [{ type: 'tool_use', id: 'tu3', name: 'fake_add', input: { text: 'send recap' } }], usage: {} },
      { content: [{ type: 'text', text: 'Prepared — confirm below.' }], usage: {} },
    ]
    const previewRes = await POST(makeReq({ messages: [{ role: 'user', content: 'add step' }] }))
    const events = await readEvents(previewRes)
    const token = events.find(e => e.type === 'pending')!.token as string
    expect(h.appendHandler).not.toHaveBeenCalled()

    // Now redeem it at the commit endpoint.
    const actRes = await ACT(makeReq({ token }))
    const body = (await actRes.json()) as { result?: unknown; error?: string }

    expect(h.appendHandler).toHaveBeenCalledTimes(1)
    expect(body.result).toEqual({ ok: true, committed: 'append' })
  })

  it('act rejects a tampered token and never commits', async () => {
    h.scripts = [
      { content: [{ type: 'tool_use', id: 'tu4', name: 'fake_add', input: { text: 'x' } }], usage: {} },
      { content: [{ type: 'text', text: 'Prepared.' }], usage: {} },
    ]
    const previewRes = await POST(makeReq({ messages: [{ role: 'user', content: 'add step' }] }))
    const token = (await readEvents(previewRes)).find(e => e.type === 'pending')!.token as string
    h.appendHandler.mockClear()

    const [payload, sig] = token.split('.')
    const tampered = `${payload}x.${sig}`
    const actRes = await ACT(makeReq({ token: tampered }))
    const body = (await actRes.json()) as { error?: string }

    expect(h.appendHandler).not.toHaveBeenCalled()
    expect(typeof body.error).toBe('string')
  })
})
