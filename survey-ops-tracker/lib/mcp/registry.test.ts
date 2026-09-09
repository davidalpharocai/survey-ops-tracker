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
      'search_projects', 'get_project', 'pipeline_summary', 'survey_stats', 'survey_report',
      'rerun_radar', 'search_reruns', 'get_rerun_series', 'rerun_calendar',
      'ops_metrics', 'whats_at_risk', 'get_change_history', 'reconcile_project',
      'data_health', 'pipeline_throughput', 'get_me',
      'get_client_history', 'get_project_history', 'search_clients', 'get_client',
      'list_activity', 'get_email', 'decode_survey_id', 'list_reminders', 'list_launches',
    ])
    for (const t of TOOLS) {
      expect(t.kind, `${t.name}`).toBe(READ.has(t.name) ? 'read' : 'write')
    }
    // Every declared read tool actually exists in the registry.
    const names = new Set(TOOLS.map(t => t.name))
    for (const r of READ) expect(names.has(r), `registry is missing read tool ${r}`).toBe(true)
  })

  it('the cost-line tools exist and keep their preview-then-apply contract', () => {
    // These write money into actual_spend (migration 101 -> the project_costs
    // spend trigger), so committing on the first call would move a project's
    // recorded spend with nobody having seen the figure. `confirm` in the schema
    // is what makes confirmable() preview instead of apply.
    for (const name of ['add_cost', 'update_cost', 'remove_cost']) {
      const t = TOOLS.find(x => x.name === name)
      expect(t, `registry is missing ${name}`).toBeDefined()
      expect(t!.kind, `${name} must be a write`).toBe('write')
      expect('confirm' in t!.schema, `${name} must accept confirm`).toBe(true)
      expect('project' in t!.schema, `${name} must take a project`).toBe(true)
    }

    // add_cost is the only one that may invent a line, so it is the only one
    // that takes an idem_key; the other two address an existing line by ref.
    const add = TOOLS.find(x => x.name === 'add_cost')!
    expect('idem_key' in add.schema).toBe(true)
    for (const name of ['update_cost', 'remove_cost']) {
      expect('cost_ref' in TOOLS.find(x => x.name === name)!.schema, `${name} takes cost_ref`).toBe(true)
      // NOT idem_key: these address a row by its primary key. Giving them one
      // would invite the confusion that add_cost's probe was originally built
      // wrong for — an id passed where a key was expected.
      expect('idem_key' in TOOLS.find(x => x.name === name)!.schema, `${name} must NOT take idem_key`).toBe(false)
    }
  })

  it('pins the exact set of tools that accept an idem_key', () => {
    // app/api/assistant/route.ts mints a stable idem_key for any tool whose
    // SCHEMA carries one, because its confirmation tokens are stateless HMAC
    // with no single-use record — the key is the replay defence. That check used
    // to read `tool.name === 'log_blast'`, so every tool added afterwards
    // silently inherited no protection: add_cost and create_project both move
    // real state and both were excluded.
    //
    // This list is therefore a REPLAY-SAFETY inventory, not a style assertion.
    // If it fails because you added an idem_key to a tool, good — confirm the
    // route still pins it (it keys off the schema, so it should) and add the
    // name here. If it fails because one went MISSING, a write lost its replay
    // defence.
    const withIdemKey = TOOLS.filter(t => 'idem_key' in t.schema).map(t => t.name).sort()
    expect(withIdemKey).toEqual(['add_cost', 'create_project', 'log_blast'])
    for (const name of withIdemKey) {
      expect(TOOLS.find(t => t.name === name)!.kind, `${name} takes an idem_key so it must be a write`).toBe('write')
    }

    // The kind enum must stay exactly migration 080's CHECK constraint. A third
    // value here would be accepted by zod and then rejected by Postgres, so the
    // caller would get a database error instead of a usable tool.
    for (const name of ['add_cost', 'update_cost']) {
      const shape = TOOLS.find(x => x.name === name)!.schema as Record<string, z.ZodTypeAny>
      // update_cost's kind is optional, so unwrap before reading the options.
      const k = shape.kind as unknown as { _def: { innerType?: z.ZodEnum<never> } } & z.ZodEnum<never>
      const inner = (k._def.innerType ?? k) as unknown as { options: string[] }
      expect(new Set(inner.options), `${name} kind enum`).toEqual(
        new Set(['sms_email_blast', 'contacts_export'])
      )
    }
  })

  it('the series-membership tools exist and keep their preview-then-apply contract', () => {
    // These two move a survey in or out of a rerun series, which renumbers every
    // other wave in that series — so they must never commit on the first call.
    // `confirm` in the schema is what makes confirmable() return a preview
    // instead of applying (see lib/mcp/toolHelpers.ts), so losing it would turn
    // a question into an irreversible edit of a whole series.
    for (const name of ['add_survey_to_series', 'remove_survey_from_series']) {
      const t = TOOLS.find(x => x.name === name)
      expect(t, `registry is missing ${name}`).toBeDefined()
      expect(t!.kind, `${name} must be a write`).toBe('write')
      expect('confirm' in t!.schema, `${name} must accept confirm`).toBe(true)
    }
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
