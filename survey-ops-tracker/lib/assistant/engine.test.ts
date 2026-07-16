import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  previewWrite,
  commitWrite,
  isAppendTool,
  ANTHROPIC_TOOLS,
  TOOLS_BY_NAME,
} from './engine'
import { TOOLS, type AssistantTool, type ToolCtx } from '@/lib/mcp/registry'

/**
 * Unit tests for the write-interception core the in-app agent loop is built on.
 * The loop itself (app/api/assistant/route.ts) is exercised end-to-end with a
 * mocked Anthropic stream in app/api/assistant/route.test.ts; here we prove the
 * pure preview/commit semantics against synthetic tools with spy handlers.
 */

const CTX: ToolCtx = { userId: 'u1', userEmail: 'david@alpharoc.ai' }

function confirmableTool(handler: AssistantTool['handler']): AssistantTool {
  return {
    name: 'fake_update',
    description: 'confirmable write',
    kind: 'write',
    schema: { x: z.string(), confirm: z.boolean().optional() },
    handler,
  }
}

function appendTool(handler: AssistantTool['handler']): AssistantTool {
  return {
    name: 'fake_add',
    description: 'append write',
    kind: 'write',
    schema: { x: z.string() },
    previewSummary: (args) => `Add ${(args as { x: string }).x}`,
    handler,
  }
}

describe('isAppendTool', () => {
  it('is true only when a previewSummary is present', () => {
    expect(isAppendTool(appendTool(vi.fn()))).toBe(true)
    expect(isAppendTool(confirmableTool(vi.fn()))).toBe(false)
  })
})

describe('previewWrite — never commits', () => {
  it('append tool: synthesizes a summary and does NOT run the handler', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    const out = await previewWrite(appendTool(handler), { x: 'hello' }, CTX, {})
    expect(out).toEqual({ kind: 'pending', summary: 'Add hello', preview: { summary: 'Add hello' } })
    expect(handler).not.toHaveBeenCalled()
  })

  it('confirmable tool: runs the handler with confirm:false and returns its preview', async () => {
    const handler = vi.fn(async (args: Record<string, unknown>) =>
      args.confirm ? { ok: true, committed: true } : { preview: { summary: 'X → Y' } }
    )
    const out = await previewWrite(confirmableTool(handler), { x: 'v' }, CTX, {})
    expect(out).toEqual({ kind: 'pending', summary: 'X → Y', preview: { summary: 'X → Y' } })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({ x: 'v', confirm: false })
  })

  it('confirmable tool: an early non-write return (error/blocked) passes through, no commit', async () => {
    const handler = vi.fn(async () => ({ error: 'Project not found.' }))
    const out = await previewWrite(confirmableTool(handler), { x: 'v' }, CTX, {})
    expect(out).toEqual({ kind: 'passthrough', result: { error: 'Project not found.' } })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({ confirm: false })
  })

  it('falls back to a generic summary when the preview has none', async () => {
    const handler = vi.fn(async () => ({ preview: { from: 1, to: 2 } }))
    const out = await previewWrite(confirmableTool(handler), { x: 'v' }, CTX, {})
    expect(out).toEqual({ kind: 'pending', summary: 'Apply fake_update', preview: { from: 1, to: 2 } })
  })
})

describe('commitWrite — executes exactly once', () => {
  it('append tool: runs the handler once, as-is (no confirm injected)', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    await commitWrite(appendTool(handler), { x: 'v' }, CTX, {})
    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0][0] as Record<string, unknown>).confirm).toBeUndefined()
  })

  it('confirmable tool: runs the handler once with confirm:true', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    await commitWrite(confirmableTool(handler), { x: 'v' }, CTX, {})
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({ x: 'v', confirm: true })
  })
})

describe('ANTHROPIC_TOOLS / TOOLS_BY_NAME derived from the registry', () => {
  it('exposes one Anthropic tool per registry tool', () => {
    expect(ANTHROPIC_TOOLS).toHaveLength(TOOLS.length)
    expect(ANTHROPIC_TOOLS.map(t => t.name).sort()).toEqual(TOOLS.map(t => t.name).sort())
  })

  it('never exposes the server-only `confirm` field to the model', () => {
    for (const t of ANTHROPIC_TOOLS) {
      const props = (t.input_schema as { properties?: Record<string, unknown> }).properties ?? {}
      expect('confirm' in props, `${t.name} must not expose confirm`).toBe(false)
    }
    // Sanity: a known confirmable tool DOES declare confirm in the registry schema,
    // proving the stripping above is load-bearing (not vacuously true).
    const updateProject = TOOLS.find(t => t.name === 'update_project')!
    expect('confirm' in updateProject.schema).toBe(true)
  })

  it('TOOLS_BY_NAME indexes every registry tool', () => {
    expect(TOOLS_BY_NAME.size).toBe(TOOLS.length)
    for (const t of TOOLS) expect(TOOLS_BY_NAME.get(t.name)).toBe(t)
  })
})
