import { describe, it, expect } from 'vitest'
import {
  contextView,
  isMissingTableError,
  parseContextRow,
  parseOverride,
  parseStatus,
  type ProjectContext,
  type ProjectContextState,
} from '@/lib/hooks/useProjectContext'

/**
 * The pure half of the Context tab: reading a migration-083 row, and deciding
 * which of the tab's states that row is in. Both are load-bearing —
 *   · the row parser is the only thing standing between a renamed column and a
 *     blank tab that looks like "this project has no background", and
 *   · the state resolver is what stops a stale or unsourced brief being shown as
 *     if it were current.
 */

/** A row as PostgREST hands it back, in 083's REAL column names. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: 'p1',
    summary: 'Airbnb told investors hotels are listing on the platform.',
    sources: [{ url: 'https://example.com/a', title: 'Q2 transcript', published_at: '2026-05-02' }],
    auto_topics: ['hotel supply'],
    auto_companies: ['Airbnb'],
    topics_override: null,
    companies_override: null,
    topics_set_by: null,
    topics_set_at: null,
    generated_at: '2026-08-18T09:00:00Z',
    model: 'claude-opus-5',
    inputs_fingerprint: 'abc123',
    last_refreshed_at: '2026-08-25T02:00:00Z',
    refresh_status: 'ok',
    refresh_error: null,
    created_at: '2026-08-01T00:00:00Z',
    effective_topics: ['hotel supply'],
    effective_companies: ['Airbnb'],
    ...over,
  }
}

describe('parseContextRow — 083 column names', () => {
  it('reads the real columns, not the invented ones', () => {
    const c = parseContextRow(row())
    expect(c.summary).toMatch(/hotels are listing/)
    expect(c.status).toBe('ok')
    expect(c.error).toBeNull()
    expect(c.model).toBe('claude-opus-5')
    expect(c.sources).toHaveLength(1)
    expect(c.sources[0].url).toBe('https://example.com/a')
  })

  it('keeps generated_at and last_refreshed_at apart', () => {
    // A row attempted overnight whose last GOOD brief is a week older. Collapsing
    // these two is how a month-old brief gets shown as fresh.
    const c = parseContextRow(row())
    expect(c.generated_at).toBe('2026-08-18T09:00:00Z')
    expect(c.last_refreshed_at).toBe('2026-08-25T02:00:00Z')
    expect(c.generated_at).not.toBe(c.last_refreshed_at)
  })

  it('reads the auto lists and the overrides separately, and the generated ones for display', () => {
    const c = parseContextRow(
      row({
        auto_companies: ['Airbnb', 'Marriott'],
        companies_override: ['Airbnb', 'Vrbo'],
        effective_companies: ['Airbnb', 'Vrbo'],
      }),
    )
    // The machine's answer is still visible — it has NOT been overwritten by the
    // human's, which is the whole point of the split.
    expect(c.auto_companies).toEqual(['Airbnb', 'Marriott'])
    expect(c.companies_override).toEqual(['Airbnb', 'Vrbo'])
    expect(c.effective_companies).toEqual(['Airbnb', 'Vrbo'])
  })

  it('preserves NULL override (nobody ruled) vs EMPTY override (ruled: none)', () => {
    expect(parseContextRow(row({ topics_override: null })).topics_override).toBeNull()
    expect(parseContextRow(row({ topics_override: [] })).topics_override).toEqual([])
    // ...and they are genuinely different values, not both falsy-equal.
    expect(parseOverride(null)).toBeNull()
    expect(parseOverride([])).toEqual([])
  })

  it('falls back to the coalesce when the generated columns are missing', () => {
    const bare = row({ effective_topics: undefined, effective_companies: undefined })
    delete bare.effective_topics
    delete bare.effective_companies
    const c = parseContextRow(bare)
    expect(c.effective_topics).toEqual(['hotel supply'])

    const overridden = row({ topics_override: [], effective_topics: undefined })
    delete overridden.effective_topics
    // An empty override wins over the auto list — it is a real "search nothing".
    expect(parseContextRow(overridden).effective_topics).toEqual([])
  })

  it('degrades instead of throwing when the row is nothing like the contract', () => {
    const c = parseContextRow({ project_id: 'p1' })
    expect(c.summary).toBeNull()
    expect(c.sources).toEqual([])
    expect(c.auto_topics).toEqual([])
    expect(c.topics_override).toBeNull()
    expect(c.status).toBe('pending')
  })
})

describe('parseStatus', () => {
  it("accepts 083's four values", () => {
    for (const s of ['pending', 'ok', 'empty', 'error'] as const) {
      expect(parseStatus(s, true, false)).toBe(s)
    }
  })

  it('tolerates the server track’s earlier spellings of "empty"', () => {
    expect(parseStatus('no_sources', true, false)).toBe('empty')
    expect(parseStatus('uncorroborated', true, false)).toBe('empty')
  })

  it('infers from the row when the status is unrecognisable', () => {
    expect(parseStatus('weird', true, true)).toBe('error')
    expect(parseStatus(null, true, false)).toBe('ok')
    expect(parseStatus(null, false, false)).toBe('pending')
  })
})

describe('isMissingTableError — only 083-not-applied, never a real failure', () => {
  it('matches the shapes PostgREST/Postgres use for a missing table', () => {
    expect(isMissingTableError({ code: '42P01', message: 'relation does not exist' })).toBe(true)
    expect(isMissingTableError({ code: 'PGRST205', message: 'x' })).toBe(true)
    expect(
      isMissingTableError({ code: null, message: "Could not find the table 'public.project_context'" }),
    ).toBe(true)
  })

  it('does NOT swallow a permission or network failure as a missing migration', () => {
    expect(isMissingTableError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingTableError({ code: null, message: 'Failed to fetch' })).toBe(false)
  })
})

/* -- the state machine ----------------------------------------------------- */

function ctx(over: Partial<ProjectContext> = {}): ProjectContext {
  return { ...parseContextRow(row()), ...over }
}
const state = (context: ProjectContext | null, available = true): ProjectContextState => ({
  available,
  context,
})

describe('contextView', () => {
  it('unavailable when the store could not be read at all', () => {
    expect(contextView(state(null, false), false).kind).toBe('unavailable')
    expect(contextView(undefined, false).kind).toBe('unavailable')
  })

  it('not_generated when the store is there but the project has no row', () => {
    expect(contextView(state(null), false).kind).toBe('not_generated')
  })

  it('generating outranks everything, and keeps the old brief on screen', () => {
    const v = contextView(state(ctx({ status: 'error', error: 'timed out' })), true)
    expect(v.kind).toBe('generating')
    expect(v.hasSummary).toBe(true)
    // The previous failure is hushed while a new attempt is actually running.
    expect(v.showFailure).toBe(false)
  })

  it('failed WITH a previous brief shows both, not one or the other', () => {
    const v = contextView(state(ctx({ status: 'error', error: 'search timed out' })), false)
    expect(v.kind).toBe('failed')
    expect(v.showFailure).toBe(true)
    expect(v.hasSummary).toBe(true)
  })

  it('failed with no brief behind it is still failed', () => {
    const v = contextView(state(ctx({ summary: null, status: 'error', error: null })), false)
    expect(v.kind).toBe('failed')
    expect(v.hasSummary).toBe(false)
  })

  it('uncorroborated when a summary exists but nothing backs it', () => {
    expect(contextView(state(ctx({ status: 'empty' })), false).kind).toBe('uncorroborated')
    // Same condition seen from the data side: a brief with an empty source list.
    expect(contextView(state(ctx({ sources: [] })), false).kind).toBe('uncorroborated')
  })

  it('nothing_found is not a failure and not "never run"', () => {
    const v = contextView(state(ctx({ summary: null, sources: [], status: 'empty' })), false)
    expect(v.kind).toBe('nothing_found')
    expect(v.showFailure).toBe(false)
  })

  it('current only when there is a brief AND something behind it', () => {
    expect(contextView(state(ctx()), false).kind).toBe('current')
  })
})
