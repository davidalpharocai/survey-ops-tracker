import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { TOOLS } from './registry'

/**
 * Guards the shared tool registry (lib/mcp/registry.ts) — the single source of
 * truth for both the MCP connector and the in-app assistant. Every tool must be
 * well-formed, names must be unique, and the set the MCP route registers must
 * equal TOOLS (so the connector never drifts from the registry).
 */

describe('TOOLS registry shape', () => {
  it('every tool has a non-empty name, description, object schema, and valid kind', () => {
    for (const t of TOOLS) {
      expect(typeof t.name, `name of ${JSON.stringify(t.name)}`).toBe('string')
      expect(t.name.length, `name of ${t.name}`).toBeGreaterThan(0)
      expect(typeof t.description, `description of ${t.name}`).toBe('string')
      expect(t.description.length, `description of ${t.name}`).toBeGreaterThan(0)
      expect(t.schema && typeof t.schema, `schema of ${t.name}`).toBe('object')
      // Every schema entry is a Zod type (z.ZodRawShape).
      for (const [key, val] of Object.entries(t.schema)) {
        expect(val instanceof z.ZodType, `${t.name}.${key} is a ZodType`).toBe(true)
      }
      expect(['read', 'write'], `kind of ${t.name}`).toContain(t.kind)
    }
  })

  it('tool names are unique', () => {
    const names = TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('only write tools carry a previewSummary (append/direct-commit marker)', () => {
    for (const t of TOOLS) {
      if (typeof t.previewSummary === 'function') {
        expect(t.kind, `${t.name} has previewSummary so must be a write`).toBe('write')
      }
    }
  })

  it('classifies the spec read tools as read and the rest as write', () => {
    const READ = new Set([
      'search_projects', 'get_project', 'pipeline_summary', 'get_me',
      'get_client_history', 'get_project_history', 'search_clients', 'get_client',
      'list_activity', 'get_email', 'decode_survey_id', 'list_reminders',
    ])
    for (const t of TOOLS) {
      expect(t.kind, `${t.name}`).toBe(READ.has(t.name) ? 'read' : 'write')
    }
    // Every declared read tool actually exists in the registry.
    const names = new Set(TOOLS.map(t => t.name))
    for (const r of READ) expect(names.has(r), `registry is missing read tool ${r}`).toBe(true)
  })
})

describe('MCP route ⇄ registry parity', () => {
  it('the MCP route registers exactly the set of tools in TOOLS', async () => {
    // Capture the tool names the route registers by stubbing the mcp-handler
    // surface: createMcpHandler synchronously invokes the setup callback with a
    // fake server whose .tool() records names. (No real MCP server is spun up.)
    const registered: string[] = []
    vi.resetModules()

    vi.doMock('mcp-handler', () => ({
      createMcpHandler: (setup: (server: unknown) => void) => {
        const server = {
          tool: (name: string) => { registered.push(name) },
          prompt: () => {},
        }
        setup(server)
        return () => new Response('ok')
      },
      experimental_withMcpAuth: (handler: unknown) => handler,
    }))
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
    vi.doMock('@/lib/oauth/store', () => ({
      findAccessToken: vi.fn(), revokeTokenById: vi.fn(),
    }))

    // Importing the route runs createMcpHandler at module load, populating `registered`.
    await import('@/app/api/mcp/route')
    const { TOOLS: FreshTools } = await import('./registry')

    expect(registered.sort()).toEqual(FreshTools.map(t => t.name).sort())

    vi.doUnmock('mcp-handler')
    vi.doUnmock('@/lib/supabase/admin')
    vi.doUnmock('@/lib/oauth/store')
    vi.resetModules()
  })
})
