import { describe, it, expect } from 'vitest'
import {
  clientName,
  composeSummary,
  CONTEXT_FRESH_HOURS,
  computeInputsFingerprint,
  deriveTopics,
  harvestSearchResults,
  hasCorroboration,
  isContextFresh,
  isMissingTable,
  normalizeOverride,
  normalizeRow,
  parseModelPayload,
  reconcileSources,
  refreshSortKey,
  resolveTopics,
  sanitizeText,
  sanitizeUrl,
  shouldRefresh,
  type ContextProject,
  type ProjectContextRow,
} from './projectContext'

function project(overrides: Partial<ContextProject> = {}): ContextProject {
  return {
    id: 'p1',
    project_code: 'PR00301',
    project_name: 'Test Project',
    client: 'Acme - B2B',
    audience: null,
    objective: null,
    category: null,
    launch_date: null,
    deliver_date: null,
    due_date: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Topic derivation
// ---------------------------------------------------------------------------

describe('deriveTopics', () => {
  it('pulls the subject company out of the project name, not the client', () => {
    // The study David described: DE Shaw commissioned it, Airbnb is the subject.
    const t = deriveTopics(
      project({ project_name: 'Airbnb Hotel Supply Wave 3', client: 'DE Shaw - Equities' }),
    )
    expect(t.companies).toEqual(['Airbnb'])
    expect(t.companies).not.toContain('DE Shaw')
  })

  it('routes the generic half of the name into topic keywords', () => {
    const t = deriveTopics(project({ project_name: 'Airbnb Hotel Supply Wave 3' }))
    expect(t.topics).toContain('hotel supply')
  })

  it('keeps companies and keywords in two separate lists', () => {
    const t = deriveTopics(
      project({
        project_name: 'Starbucks Loyalty Tracker',
        category: 'Consumer',
        audience: 'US coffee drinkers 18-54',
      }),
    )
    expect(t.companies).toEqual(['Starbucks'])
    expect(t.topics).toContain('Consumer')
    expect(t.topics).toContain('US coffee drinkers 18-54')
    expect(t.topics).not.toContain('Starbucks')
  })

  it('drops survey jargon, wave numbers and quarters', () => {
    const t = deriveTopics(project({ project_name: 'Gen Pop Rerun Wave 4 Q3 2026' }))
    expect(t.companies).toEqual([])
  })

  it('joins multi-word names through a connector', () => {
    const t = deriveTopics(project({ project_name: 'Bank of America Deposits' }))
    expect(t.companies).toEqual(['Bank of America'])
  })

  it('keeps brand-cased and acronym names', () => {
    expect(deriveTopics(project({ project_name: 'eBay Seller Sentiment' })).companies).toEqual(['eBay'])
    expect(deriveTopics(project({ project_name: 'IBM Watson Adoption' })).companies).toEqual(['IBM Watson'])
  })

  it('reads companies out of the objective without swallowing its opening verb', () => {
    const t = deriveTopics(
      project({
        project_name: 'Q3 Consumer Pulse',
        objective: 'Measure whether Marriott guests are switching to Airbnb after the pricing change.',
      }),
    )
    expect(t.companies).toEqual(expect.arrayContaining(['Marriott', 'Airbnb']))
    expect(t.companies).not.toContain('Measure')
  })

  it('returns empty lists rather than noise for a bare project', () => {
    const t = deriveTopics(project({ project_name: 'Wave 2', client: null }))
    expect(t.companies).toEqual([])
    expect(t.topics).toEqual([])
  })
})

describe('clientName', () => {
  it('strips the vertical suffix', () => {
    expect(clientName('DE Shaw - Equities')).toBe('DE Shaw')
    expect(clientName('Acme')).toBe('Acme')
    expect(clientName(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The auto / override split (migration 083's central decision)
// ---------------------------------------------------------------------------

describe('normalizeOverride', () => {
  it('keeps NULL and EMPTY ARRAY apart — they mean different things', () => {
    // null = "no human has ruled; use the auto list".
    expect(normalizeOverride(null, 25)).toBeNull()
    expect(normalizeOverride(undefined, 25)).toBeNull()
    // [] = "a human ruled there are none"; the refresh must search nothing.
    expect(normalizeOverride([], 25)).toEqual([])
  })

  it('trims, de-dupes and caps, and drops non-strings', () => {
    expect(normalizeOverride(['  Airbnb ', 'airbnb', 42, 'Marriott'], 25)).toEqual(['Airbnb', 'Marriott'])
    expect(normalizeOverride(['a1', 'b2', 'c3'], 2)).toEqual(['a1', 'b2'])
  })

  it('treats a non-array as "unset" rather than coercing it', () => {
    expect(normalizeOverride('Airbnb', 25)).toBeNull()
    expect(normalizeOverride({ 0: 'Airbnb' }, 25)).toBeNull()
  })
})

describe('resolveTopics', () => {
  const p = project({ project_name: 'Airbnb Hotel Supply', category: 'Travel' })

  it('auto-derives when no override is stored', () => {
    const t = resolveTopics(p, null)
    expect(t.origin).toBe('auto')
    expect(t.companies).toEqual(['Airbnb'])
    expect(t.auto_companies).toEqual(['Airbnb'])
  })

  it('lets a human override beat auto-derivation', () => {
    const t = resolveTopics(p, {
      companies_override: ['Marriott'],
      topics_override: ['hotel loyalty'],
    })
    expect(t.origin).toBe('override')
    expect(t.companies).toEqual(['Marriott'])
    expect(t.topics).toEqual(['hotel loyalty'])
    // The machine half is still derived fresh — it is what gets written to auto_*.
    expect(t.auto_companies).toEqual(['Airbnb'])
  })

  it('overrides each list independently', () => {
    const t = resolveTopics(p, { companies_override: ['Marriott'], topics_override: null })
    expect(t.origin).toBe('mixed')
    expect(t.companies).toEqual(['Marriott'])
    expect(t.topics).toContain('Travel') // still auto
  })

  it('honours an EMPTY override as "search nothing", not as "fall back to auto"', () => {
    // This is the whole point of the null/[] split. Collapsing them would
    // resurrect a company list an analyst deliberately emptied.
    const t = resolveTopics(p, { companies_override: [], topics_override: null })
    expect(t.companies).toEqual([])
    expect(t.auto_companies).toEqual(['Airbnb'])
    expect(t.origin).toBe('mixed')
  })

  it('never treats the stored auto lists as an override', () => {
    const t = resolveTopics(p, { auto_companies: ['Stale Co'], auto_topics: ['stale'] })
    expect(t.companies).toEqual(['Airbnb'])
    expect(t.origin).toBe('auto')
  })
})

// ---------------------------------------------------------------------------
// inputs_fingerprint — 083's staleness signal
// ---------------------------------------------------------------------------

describe('computeInputsFingerprint', () => {
  const p = project({ project_name: 'Airbnb Hotel Supply', category: 'Travel' })

  it('is stable for unchanged inputs', () => {
    expect(computeInputsFingerprint(p, resolveTopics(p, null))).toBe(
      computeInputsFingerprint(p, resolveTopics(p, null)),
    )
  })

  it('changes when the project is renamed (the merge_projects case)', () => {
    const renamed = project({ project_name: 'Marriott Hotel Supply', category: 'Travel' })
    expect(computeInputsFingerprint(renamed, resolveTopics(renamed, null))).not.toBe(
      computeInputsFingerprint(p, resolveTopics(p, null)),
    )
  })

  it('changes when an analyst overrides the topics', () => {
    const overridden = resolveTopics(p, { companies_override: ['Marriott'] })
    expect(computeInputsFingerprint(p, overridden)).not.toBe(
      computeInputsFingerprint(p, resolveTopics(p, null)),
    )
  })

  it('does not move when only the field window moves', () => {
    const moved = project({ project_name: 'Airbnb Hotel Supply', category: 'Travel', deliver_date: '2026-09-01' })
    expect(computeInputsFingerprint(moved, resolveTopics(moved, null))).toBe(
      computeInputsFingerprint(p, resolveTopics(p, null)),
    )
  })
})

// ---------------------------------------------------------------------------
// Web search harvesting — the success-LIST vs error-OBJECT branch
// ---------------------------------------------------------------------------

const searchBlock = (content: unknown) => ({
  type: 'web_search_tool_result',
  tool_use_id: 'srvtoolu_1',
  content,
})

describe('harvestSearchResults', () => {
  it('reads a successful result LIST', () => {
    const harvest = harvestSearchResults([
      { type: 'server_tool_use', name: 'web_search', id: 'srvtoolu_1', input: { query: 'airbnb earnings' } },
      searchBlock([
        {
          type: 'web_search_result',
          url: 'https://investors.airbnb.com/q3',
          title: 'Q3 shareholder letter',
          page_age: '3 days',
          encrypted_content: 'xxx',
        },
      ]),
    ])
    expect(harvest.errors).toEqual([])
    expect(harvest.searches).toBe(1)
    expect(harvest.results.get('https://investors.airbnb.com/q3')).toEqual({
      title: 'Q3 shareholder letter',
      published: '3 days',
    })
  })

  it('does NOT throw when the result is an error OBJECT (the HTTP-200 failure)', () => {
    // Arrays are objects in JS. If the shape check is written the wrong way round,
    // this input is what turns a rate-limited search into a production TypeError.
    let harvest!: ReturnType<typeof harvestSearchResults>
    expect(() => {
      harvest = harvestSearchResults([
        searchBlock({ type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }),
      ])
    }).not.toThrow()
    expect(harvest.results.size).toBe(0)
    expect(harvest.errors).toEqual(['max_uses_exceeded'])
  })

  it('handles a mixed response: one search succeeded, the next was rate limited', () => {
    const harvest = harvestSearchResults([
      searchBlock([
        { type: 'web_search_result', url: 'https://example.com/a', title: 'A', encrypted_content: 'x' },
      ]),
      searchBlock({ type: 'web_search_tool_result_error', error_code: 'too_many_requests' }),
    ])
    expect(harvest.results.size).toBe(1)
    expect(harvest.errors).toEqual(['too_many_requests'])
  })

  it('labels an error object with no error_code rather than dropping it silently', () => {
    const harvest = harvestSearchResults([searchBlock({ type: 'web_search_tool_result_error' })])
    expect(harvest.errors).toEqual(['unknown_error'])
  })

  it('picks up API citations on text blocks', () => {
    const harvest = harvestSearchResults([
      {
        type: 'text',
        text: 'Airbnb said hotels are joining.',
        citations: [
          {
            type: 'web_search_result_location',
            url: 'https://investors.airbnb.com/call',
            title: 'Earnings call',
            cited_text: '...',
            encrypted_index: 'i',
          },
        ],
      },
    ])
    expect(harvest.results.has('https://investors.airbnb.com/call')).toBe(true)
  })

  it('refuses non-http(s) URLs even when the tool returns them', () => {
    const harvest = harvestSearchResults([
      searchBlock([
        { type: 'web_search_result', url: 'javascript:alert(1)', title: 'nope', encrypted_content: 'x' },
        { type: 'web_search_result', url: 'https://ok.example/1', title: 'yes', encrypted_content: 'x' },
      ]),
    ])
    expect([...harvest.results.keys()]).toEqual(['https://ok.example/1'])
  })

  it('survives junk content shapes', () => {
    expect(harvestSearchResults(null).results.size).toBe(0)
    expect(harvestSearchResults('nope').errors).toEqual([])
    expect(harvestSearchResults([null, 42, searchBlock(null)]).results.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

describe('parseModelPayload', () => {
  const body = JSON.stringify({
    driving_summary: 'Airbnb told investors that hotels are listing on the platform.',
    window_summary: '',
    subject_companies: ['Airbnb'],
    sources: [{ url: 'https://investors.airbnb.com/q3', title: 'Q3', note: 'the remark', section: 'driving' }],
  })

  it('parses a bare JSON answer', () => {
    const payload = parseModelPayload([{ type: 'text', text: body, citations: null }])
    expect(payload?.driving_summary).toContain('hotels are listing')
    expect(payload?.companies).toEqual(['Airbnb'])
  })

  it('parses a fenced answer and prefers the LAST text block', () => {
    const payload = parseModelPayload([
      { type: 'text', text: 'Let me search for that.', citations: null },
      { type: 'text', text: '```json\n' + body + '\n```', citations: null },
    ])
    expect(payload?.driving_summary).toContain('hotels are listing')
  })

  it('returns null instead of throwing on unparseable output', () => {
    expect(parseModelPayload([{ type: 'text', text: 'I could not find anything.', citations: null }])).toBeNull()
    expect(parseModelPayload([])).toBeNull()
    expect(parseModelPayload(undefined)).toBeNull()
  })

  it('rejects JSON with no driving_summary — that section IS the deliverable', () => {
    expect(parseModelPayload([{ type: 'text', text: '{"window_summary":"stuff"}', citations: null }])).toBeNull()
  })
})

describe('composeSummary', () => {
  it('writes origin first and the field window second (083 stores ONE summary)', () => {
    const s = composeSummary('Why the study exists.', 'What moved during fielding.')
    expect(s.indexOf('Why the study exists.')).toBeLessThan(s.indexOf('What moved during fielding.'))
    expect(s).toContain('During the field window')
  })

  it('omits the field-window section entirely when there is nothing to say', () => {
    expect(composeSummary('Why the study exists.', '   ')).toBe('Why the study exists.')
  })
})

describe('reconcileSources', () => {
  const harvested = new Map([
    ['https://investors.airbnb.com/q3', { title: 'Q3 shareholder letter', published: '3 days' }],
  ])

  it('keeps only URLs the search tool actually returned', () => {
    const out = reconcileSources(
      [
        { url: 'https://investors.airbnb.com/q3', title: 'model title', note: 'why', section: 'driving' },
        { url: 'https://totally-made-up.example/story', title: 'invented', note: 'x', section: 'driving' },
      ],
      harvested,
    )
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe('https://investors.airbnb.com/q3')
    // The title comes from the API result, not from the model.
    expect(out[0].title).toBe('Q3 shareholder letter')
    expect(out[0].uncorroborated).toBe(false)
    expect(hasCorroboration(out)).toBe(true)
  })

  it('FLAGS the raw-hit fallback instead of laundering it as a citation', () => {
    // The model cited nothing real. The hits are still shown, but they are "what
    // the search returned", not "what this summary is based on" — and the caller
    // uses hasCorroboration() to store the row as 'empty' rather than 'ok'.
    const out = reconcileSources([{ url: 'https://made-up.example' }], harvested)
    expect(out.map((s) => s.url)).toEqual(['https://investors.airbnb.com/q3'])
    expect(out.every((s) => s.uncorroborated)).toBe(true)
    expect(hasCorroboration(out)).toBe(false)
  })

  it('returns nothing when there were no search hits at all', () => {
    expect(reconcileSources([{ url: 'https://made-up.example' }], new Map())).toEqual([])
    expect(hasCorroboration([])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Sanitisation
// ---------------------------------------------------------------------------

describe('sanitizeUrl', () => {
  it('allows http and https only', () => {
    expect(sanitizeUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(sanitizeUrl('http://example.com/a')).toBe('http://example.com/a')
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeUrl('data:text/html,<script>')).toBeNull()
    expect(sanitizeUrl('not a url')).toBeNull()
    expect(sanitizeUrl(null)).toBeNull()
  })
})

describe('sanitizeText', () => {
  it('strips control characters and truncates', () => {
    const NUL = String.fromCharCode(0)
    const ESC = String.fromCharCode(27)
    expect(sanitizeText('a' + NUL + 'b' + ESC + 'c', 100)).toBe('abc')
    expect(sanitizeText('abcdef', 3)).toBe('abc…')
    expect(sanitizeText(42, 10)).toBe('')
  })

  it('keeps newlines so prose survives', () => {
    expect(sanitizeText('line one\nline two', 100)).toBe('line one\nline two')
  })
})

// ---------------------------------------------------------------------------
// Row normalisation
// ---------------------------------------------------------------------------

describe('normalizeRow', () => {
  it('preserves null vs empty overrides straight off the wire', () => {
    const row = normalizeRow({
      project_id: 'p1',
      auto_topics: ['travel'],
      auto_companies: ['Airbnb'],
      topics_override: null,
      companies_override: [],
      effective_topics: ['travel'],
      effective_companies: [],
      refresh_status: 'ok',
    })!
    expect(row.topics_override).toBeNull()
    expect(row.companies_override).toEqual([])
    expect(row.effective_companies).toEqual([])
  })

  it('re-derives effective_* when the row was selected without them', () => {
    const row = normalizeRow({
      project_id: 'p1',
      auto_topics: ['travel'],
      auto_companies: ['Airbnb'],
      topics_override: ['hotel loyalty'],
      companies_override: null,
      refresh_status: 'ok',
    })!
    expect(row.effective_topics).toEqual(['hotel loyalty'])
    expect(row.effective_companies).toEqual(['Airbnb'])
  })

  it('drops a hostile source URL on the way OUT, not just on the way in', () => {
    const row = normalizeRow({
      project_id: 'p1',
      refresh_status: 'ok',
      sources: [
        { url: 'javascript:alert(1)', title: 'nope' },
        { url: 'https://ok.example/1', title: 'yes', published_at: '2026-08-01', uncorroborated: true },
      ],
    })!
    expect(row.sources.map((s) => s.url)).toEqual(['https://ok.example/1'])
    expect(row.sources[0].uncorroborated).toBe(true)
  })

  it('falls back to "pending" for a status it does not recognise', () => {
    expect(normalizeRow({ project_id: 'p1', refresh_status: 'generating' })!.refresh_status).toBe('pending')
    expect(normalizeRow({ project_id: 'p1' })!.refresh_status).toBe('pending')
  })
})

// ---------------------------------------------------------------------------
// Freshness / staleness / missing-table tolerance
// ---------------------------------------------------------------------------

function row(overrides: Partial<ProjectContextRow> = {}): ProjectContextRow {
  return {
    project_id: 'p1',
    summary: 'x',
    sources: [],
    auto_topics: [],
    auto_companies: [],
    topics_override: null,
    companies_override: null,
    topics_set_by: null,
    topics_set_at: null,
    generated_at: null,
    model: 'claude-opus-5',
    inputs_fingerprint: 'fp-current',
    last_refreshed_at: null,
    refresh_status: 'ok',
    refresh_error: null,
    created_at: null,
    effective_topics: [],
    effective_companies: [],
    ...overrides,
  }
}

const NOW = Date.parse('2026-08-25T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

// Relative to CONTEXT_FRESH_HOURS, never a hard-coded age. That constant IS the
// refresh cadence and is expected to change (20h -> 72h already; weekly next), so
// a test pinning "21 hours is stale" fails for the wrong reason the moment the
// cadence moves and tells you nothing about whether the logic still works.
const INSIDE_WINDOW = Math.max(1, Math.floor(CONTEXT_FRESH_HOURS / 2))
const PAST_WINDOW = CONTEXT_FRESH_HOURS + 1

describe('isContextFresh', () => {
  it('measures the BRIEFING (generated_at), not the last attempt', () => {
    expect(isContextFresh(row({ generated_at: hoursAgo(INSIDE_WINDOW) }), NOW)).toBe(true)
    expect(isContextFresh(row({ generated_at: hoursAgo(PAST_WINDOW) }), NOW)).toBe(false)
    // Attempted an hour ago, but the briefing itself is stale and failing.
    expect(
      isContextFresh(
        { refresh_status: 'error', generated_at: hoursAgo(PAST_WINDOW) } as Parameters<typeof isContextFresh>[0],
        NOW,
      ),
    ).toBe(false)
  })
})

describe('shouldRefresh', () => {
  const FP = 'fp-current'

  it('skips a project refreshed inside the freshness window', () => {
    expect(
      shouldRefresh(row({ last_refreshed_at: hoursAgo(INSIDE_WINDOW), generated_at: hoursAgo(INSIDE_WINDOW) }), NOW, FP),
    ).toBe(false)
  })

  it('refreshes once the context ages past the window', () => {
    expect(
      shouldRefresh(row({ last_refreshed_at: hoursAgo(PAST_WINDOW), generated_at: hoursAgo(PAST_WINDOW) }), NOW, FP),
    ).toBe(true)
  })

  it('throttles retries after a failure instead of burning budget', () => {
    expect(shouldRefresh(row({ refresh_status: 'error', last_refreshed_at: hoursAgo(1) }), NOW, FP)).toBe(false)
    expect(shouldRefresh(row({ refresh_status: 'error', last_refreshed_at: hoursAgo(6) }), NOW, FP)).toBe(true)
  })

  it('does not retry an "empty" result as if it were a failure', () => {
    expect(
      shouldRefresh(row({ refresh_status: 'empty', last_refreshed_at: hoursAgo(2), generated_at: hoursAgo(2) }), NOW, FP),
    ).toBe(false)
  })

  it('regenerates a fresh row whose INPUTS moved (the fingerprint mismatch)', () => {
    const fresh = row({ last_refreshed_at: hoursAgo(1), generated_at: hoursAgo(1), inputs_fingerprint: 'fp-old' })
    expect(shouldRefresh(fresh, NOW, FP)).toBe(true)
  })

  it('regenerates when merge_projects NULLed the fingerprint', () => {
    const merged = row({ last_refreshed_at: hoursAgo(1), generated_at: hoursAgo(1), inputs_fingerprint: null })
    expect(shouldRefresh(merged, NOW, FP)).toBe(true)
    // ...but the failure back-off still wins, so a broken project cannot loop.
    expect(shouldRefresh({ ...merged, refresh_status: 'error' }, NOW, FP)).toBe(false)
  })

  it('ignores the fingerprint entirely when the caller does not supply one', () => {
    const fresh = row({ last_refreshed_at: hoursAgo(1), generated_at: hoursAgo(1), inputs_fingerprint: null })
    expect(shouldRefresh(fresh, NOW)).toBe(false)
  })

  it('refreshes a project that has no row at all', () => {
    expect(shouldRefresh(null, NOW, FP)).toBe(true)
  })
})

describe('refreshSortKey', () => {
  it('puts never-attempted projects ahead of everything else', () => {
    const queue = [
      { id: 'recent', row: row({ last_refreshed_at: hoursAgo(1) }) },
      { id: 'never', row: row({ last_refreshed_at: null }) },
      { id: 'stale', row: row({ last_refreshed_at: hoursAgo(200) }) },
      { id: 'no-row', row: null },
    ]
    const order = [...queue].sort((a, b) => refreshSortKey(a.row) - refreshSortKey(b.row)).map((q) => q.id)
    // never / no-row first (both -Infinity, stable order), then oldest attempt.
    expect(order).toEqual(['never', 'no-row', 'stale', 'recent'])
  })
})

describe('isMissingTable', () => {
  it('recognises the migration-not-run shapes', () => {
    expect(isMissingTable({ code: '42P01' })).toBe(true)
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true)
    expect(isMissingTable({ code: null, message: 'relation "project_context" does not exist' })).toBe(true)
    expect(isMissingTable({ code: null, message: 'Could not find the table in the schema cache' })).toBe(true)
  })

  it('does not swallow real errors', () => {
    expect(isMissingTable({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingTable(null)).toBe(false)
  })
})
