import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ContextTab } from '@/components/project/ContextTab'
import type { ProjectContext, ProjectContextState } from '@/lib/hooks/useProjectContext'
import type { SurveyProject } from '@/lib/hooks/useProjects'

// The tab's whole job is choosing the right words for each state, so the three
// hooks are mocked and every state is driven straight from here. The PURE parts
// of the module (contextView, parseContextRow) are kept real — the component
// uses contextView, and re-implementing it in the mock would test nothing.
let state: { data: ProjectContextState | undefined; isLoading: boolean; isError: boolean }
let refreshPending = false
const setTopics = vi.fn()
const refresh = vi.fn()

vi.mock('@/lib/hooks/useProjectContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useProjectContext')>()
  return {
    ...actual,
    useProjectContext: () => state,
    useRefreshProjectContext: () => ({ mutate: refresh, isPending: refreshPending }),
    useSetContextTopics: () => ({ mutate: setTopics, isPending: false }),
  }
})

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

function mkProject(over: Partial<SurveyProject> = {}): SurveyProject {
  return {
    id: 'p1',
    project_name: 'Airbnb hotel supply',
    status: 'Open',
    audience: 'US adults 18+',
    objective: 'Measure awareness of hotels listing on Airbnb',
    launch_date: '2026-06-03',
    deliver_date: '2026-06-17',
    ...over,
  } as unknown as SurveyProject
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

/** A parsed context row in 083's shape. */
function mkCtx(over: Partial<ProjectContext> = {}): ProjectContext {
  return {
    summary: 'Airbnb told investors hotels are listing on the platform.',
    sources: [
      {
        url: 'https://example.com/transcript',
        title: 'Q2 earnings call transcript',
        published_at: '2026-05-02',
        publisher: 'Example Wire',
        note: 'Cited for the supply remark',
        uncorroborated: false,
      },
    ],
    auto_topics: [],
    auto_companies: [],
    topics_override: null,
    companies_override: null,
    topics_set_by: null,
    topics_set_at: null,
    effective_topics: [],
    effective_companies: [],
    generated_at: daysAgo(1),
    last_refreshed_at: daysAgo(1),
    status: 'ok',
    error: null,
    model: null,
    inputs_fingerprint: 'fp',
    ...over,
  }
}
const ok = (over: Partial<ProjectContext> = {}) => ({ available: true, context: mkCtx(over) })

beforeEach(() => {
  state = { data: { available: true, context: null }, isLoading: false, isError: false }
  refreshPending = false
  setTopics.mockClear()
  refresh.mockClear()
})

describe('ContextTab — states', () => {
  it('names the missing migration when the context store cannot be read', () => {
    state = { data: { available: false, context: null }, isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/switched on yet/i)).toBeInTheDocument()
    expect(screen.getByText(/083/)).toBeInTheDocument()
    // Not a broken shell: none of the real sections are drawn.
    expect(screen.queryByText(/what.s driving this/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/topics being tracked/i)).not.toBeInTheDocument()
  })

  it('separates a genuine read failure from "the migration is missing"', () => {
    state = { data: undefined, isLoading: false, isError: true }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/couldn.t load the background/i)).toBeInTheDocument()
    expect(screen.queryByText(/switched on yet/i)).not.toBeInTheDocument()
  })

  it('explains what will happen when nothing has been generated yet', () => {
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/nothing generated yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate now/i })).toBeInTheDocument()
    expect(screen.getByText(/no brief yet/i)).toBeInTheDocument()
    // Topics stay editable before the first run so an analyst can prime it.
    expect(screen.getAllByText('+ add')).toHaveLength(2)
  })

  it('says a refresh is running and keeps the old brief readable underneath', () => {
    refreshPending = true
    state = { data: ok(), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/searching and rebuilding/i)).toBeInTheDocument()
    expect(screen.getByText(/hotels are listing on the platform/i)).toBeInTheDocument()
  })

  it('shows the OLD brief AND the failure when the last refresh failed', () => {
    state = {
      data: ok({
        status: 'error',
        error: 'Search provider timed out',
        generated_at: daysAgo(9),
        last_refreshed_at: daysAgo(0),
      }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/the last refresh failed/i)).toBeInTheDocument()
    expect(screen.getByText(/search provider timed out/i)).toBeInTheDocument()
    // The stale-but-good brief is still on screen — not one or the other.
    expect(screen.getByText(/hotels are listing on the platform/i)).toBeInTheDocument()
    // Deliberately NOT "the last good version": a failed run can now carry a
    // partial brief of its own (see the comment on this copy in ContextTab).
    expect(screen.getByText(/showing the brief from/i)).toBeInTheDocument()
  })

  it('shows only the failure when there is no earlier brief to fall back on', () => {
    state = {
      data: ok({ summary: null, status: 'error', error: 'No usable sources found' }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/couldn.t build this brief/i)).toBeInTheDocument()
    expect(screen.getByText(/no usable sources found/i)).toBeInTheDocument()
  })

  it('treats a failed status with no message as a failure, not as current', () => {
    state = { data: ok({ status: 'error', error: null }), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/the last refresh failed/i)).toBeInTheDocument()
    expect(screen.getByText(/no reason was recorded/i)).toBeInTheDocument()
  })

  it('marks an uncorroborated brief so it does not read like a normal one', () => {
    state = { data: ok({ status: 'empty', sources: [] }), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/nothing was found to back this up/i)).toBeInTheDocument()
    expect(screen.getByText('unverified')).toBeInTheDocument()
    // The text is still there to read — flagged, not hidden.
    expect(screen.getByText(/hotels are listing on the platform/i)).toBeInTheDocument()
    expect(screen.getByText(/no sources came back with this brief/i)).toBeInTheDocument()
  })

  it('distinguishes "we looked and found nothing" from "never generated"', () => {
    state = {
      data: ok({ summary: null, sources: [], status: 'empty' }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/found nothing worth reporting/i)).toBeInTheDocument()
    expect(screen.queryByText(/nothing generated yet/i)).not.toBeInTheDocument()
  })

  it('says the automatic refresh no longer covers an archived project', () => {
    state = { data: ok(), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject({ status: 'Closed' })} />))

    expect(screen.getByText(/no longer picked up by the automatic refresh/i)).toBeInTheDocument()
  })

  it('warns when the project gave topic derivation almost nothing to work with', () => {
    state = { data: ok(), isLoading: false, isError: false }
    const { rerender } = render(
      wrap(<ContextTab project={mkProject({ audience: null, objective: null })} />),
    )
    expect(screen.getByText(/little to suggest\s+topics from/i)).toBeInTheDocument()

    rerender(wrap(<ContextTab project={mkProject()} />))
    expect(screen.queryByText(/little to suggest\s+topics from/i)).not.toBeInTheDocument()
  })
})

describe('ContextTab — age of the brief', () => {
  it('leads with when the BRIEF was written, and flags a month-old one', () => {
    state = {
      data: ok({ generated_at: daysAgo(40), last_refreshed_at: daysAgo(40) }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    const stamp = screen.getByText(/brief from/i)
    expect(stamp).toHaveTextContent('40d ago')
    // Old enough that it must not look like ordinary muted metadata.
    expect(stamp.className).toMatch(/red/)
  })

  it('shows the last ATTEMPT separately from the last successful generation', () => {
    state = {
      data: ok({ generated_at: daysAgo(9), last_refreshed_at: daysAgo(1) }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/brief from/i)).toHaveTextContent('9d ago')
    expect(screen.getByText(/last tried 1d ago/i)).toBeInTheDocument()
  })
})

describe('ContextTab — refresh', () => {
  it('forces past the freshness window only when a brief already exists', () => {
    state = { data: ok(), isLoading: false, isError: false }
    const { unmount } = render(wrap(<ContextTab project={mkProject()} />))
    // Exact name: several InfoTooltips carry the word "refresh" in their label.
    fireEvent.click(screen.getByRole('button', { name: '↻ Refresh' }))
    expect(refresh).toHaveBeenCalledWith({ force: true })
    unmount()

    refresh.mockClear()
    state = { data: { available: true, context: null }, isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))
    fireEvent.click(screen.getByRole('button', { name: 'Generate now' }))
    expect(refresh).toHaveBeenCalledWith({ force: false })
  })
})

describe('ContextTab — sources are untrusted', () => {
  it('links http(s) sources in a new tab and REFUSES a javascript: URL', () => {
    state = {
      data: ok({
        sources: [
          {
            url: 'https://example.com/transcript',
            title: 'Q2 earnings call transcript',
            publisher: 'Example Wire',
            published_at: '2026-05-02',
            note: null,
            uncorroborated: false,
          },
          // Untrusted input: a source URL is attacker-controlled if the page is.
          // An href is executable, so this one must never become an anchor.
          {
            url: 'javascript:alert(document.cookie)',
            title: 'Totally normal article',
            publisher: null,
            published_at: null,
            note: null,
            uncorroborated: false,
          },
        ],
      }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    const good = screen.getByRole('link', { name: 'Q2 earnings call transcript' })
    expect(good).toHaveAttribute('href', 'https://example.com/transcript')
    expect(good).toHaveAttribute('target', '_blank')
    expect(good).toHaveAttribute('rel', 'noopener noreferrer')

    expect(screen.queryByRole('link', { name: /totally normal article/i })).not.toBeInTheDocument()
    expect(screen.getByText(/totally normal article \(unlinkable\)/i)).toBeInTheDocument()
    // Nothing anywhere on the tab carries a javascript: href.
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('href')).toMatch(/^https?:/)
    }
  })

  it('renders a hostile summary as text, with no markup surviving', () => {
    state = {
      data: ok({
        summary: '## Origin\n\nSee <img src=x onerror="alert(1)"> and **bold** text.',
      }),
      isLoading: false,
      isError: false,
    }
    const { container } = render(wrap(<ContextTab project={mkProject()} />))

    expect(container.querySelector('img')).toBeNull()
    // The heading marker styles a heading; its text is still just text.
    expect(screen.getByText('Origin')).toBeInTheDocument()
    // Emphasis markers are stripped cosmetically, the tag text is NOT executed.
    expect(screen.getByText(/see <img src=x onerror="alert\(1\)"> and bold text\./i)).toBeInTheDocument()
  })
})

describe('ContextTab — topic overrides (083 auto vs human)', () => {
  const withTopics = (over: Partial<ProjectContext> = {}) =>
    ok({
      auto_companies: ['Airbnb', 'Marriott'],
      auto_topics: ['hotel supply'],
      effective_companies: ['Airbnb', 'Marriott'],
      effective_topics: ['hotel supply'],
      ...over,
    })

  it('shows companies and keywords as two separate groups', () => {
    state = { data: withTopics(), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText('Subject companies')).toBeInTheDocument()
    expect(screen.getByText('Keywords')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop tracking Airbnb' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop tracking hotel supply' })).toBeInTheDocument()
  })

  it('marks a machine-suggested list differently from a human-set one', () => {
    state = {
      data: withTopics({
        companies_override: ['Airbnb', 'Vrbo'],
        effective_companies: ['Airbnb', 'Vrbo'],
        topics_set_by: 'jenna@alpharoc.ai',
        topics_set_at: '2026-08-20T10:00:00Z',
      }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/set by jenna@alpharoc.ai/i)).toBeInTheDocument()
    // Keywords have no override, so that group still reads as a suggestion.
    expect(screen.getByText('suggested')).toBeInTheDocument()
    expect(screen.getByText('Vrbo').parentElement?.className).toMatch(/border-solid/)
    expect(screen.getByText('hotel supply').parentElement?.className).toMatch(/border-dashed/)
    // The machine's discarded suggestion is still surfaced, so an override can't
    // silently hide a newly relevant subject — and it goes back in one click.
    expect(screen.getByText(/also suggested, not searched/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Track Marriott' })).toBeInTheDocument()
  })

  it('writes ONLY the edited group’s override and never freezes the other list', () => {
    state = { data: withTopics(), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    fireEvent.click(screen.getByRole('button', { name: 'Stop tracking Marriott' }))

    expect(setTopics).toHaveBeenCalledTimes(1)
    expect(setTopics).toHaveBeenCalledWith({
      companies_override: ['Airbnb'],
      // Untouched: the keyword list stays machine-owned and keeps updating on
      // every refresh. This is the bug — one edit used to write every chip on the tab
      // into the overrides and freeze the auto lists forever.
      topics_override: null,
    })
  })

  it('adding to a suggested list takes ownership of only that list', () => {
    state = { data: withTopics(), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    const addButtons = screen.getAllByText('+ add')
    fireEvent.click(addButtons[1]) // keywords
    const input = screen.getByLabelText('Add a keyword')
    fireEvent.change(input, { target: { value: 'loyalty programs' } })
    fireEvent.blur(input)

    expect(setTopics).toHaveBeenCalledWith({
      topics_override: ['hotel supply', 'loyalty programs'],
      companies_override: null,
    })
  })

  it('removing the last entry writes [] — "ruled none", not "never ruled"', () => {
    state = {
      data: withTopics({ topics_override: ['hotel supply'], effective_topics: ['hotel supply'] }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    fireEvent.click(screen.getByRole('button', { name: 'Stop tracking hotel supply' }))
    const arg = setTopics.mock.calls[0][0]
    expect(arg.topics_override).toEqual([])
    expect(arg.topics_override).not.toBeNull()
  })

  it('says out loud when a human ruled there are none', () => {
    state = {
      data: withTopics({ topics_override: [], effective_topics: [] }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/the team ruled there are no keywords/i)).toBeInTheDocument()
  })

  it('offers a way back to the suggestions, so one edit is not a one-way door', () => {
    state = {
      data: withTopics({ companies_override: ['Vrbo'], effective_companies: ['Vrbo'] }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    // Only the overridden group offers it.
    // Exact name again: the "set by" InfoTooltip mentions the button by name.
    const revert = screen.getAllByRole('button', { name: 'Use suggestions' })
    expect(revert).toHaveLength(1)

    fireEvent.click(revert[0])
    expect(setTopics).toHaveBeenCalledWith({
      companies_override: null, // back to the auto list
      topics_override: null,
    })
  })
})

/**
 * PART 1 of the bullet change: the server now writes markdown "- " lines INSIDE
 * the single `summary` text column (no new column, no schema change), and this
 * tab has to render them as a real list — while every row already in production
 * is still one prose paragraph until it regenerates. Both shapes are tested here
 * because both are live at the same time for the first few days after ship.
 */
describe('ContextTab — the briefing renders as bullets', () => {
  const BULLETED = [
    '**Why this study exists**',
    '',
    '- Novo Nordisk cut its 2026 outlook on 29 July, blaming compounded semaglutide.',
    '- Eli Lilly launched Zepbound self-pay vials at $399 a month.',
    '',
    '**During the field window**',
    '',
    '- CMS said it would pilot Medicare coverage of obesity drugs.',
  ].join('\n')

  it('renders markdown bullets as a real list, one <li> per bullet', () => {
    state = { data: ok({ summary: BULLETED }), isLoading: false, isError: false }
    const { container } = render(wrap(<ContextTab project={mkProject()} />))

    // One list per section — bullets are never merged across a heading. The
    // sources card uses <ol>, so <ul> counts only the briefing's own lists.
    expect(container.querySelectorAll('ul')).toHaveLength(2)
    expect(container.querySelectorAll('ul li')).toHaveLength(3)
    // The "- " marker is consumed by the parser, never shown to the reader.
    expect(container.textContent).not.toContain('- Novo Nordisk')
    expect(screen.getByText(/cut its 2026 outlook/i).closest('li')).not.toBeNull()
  })

  it('treats a wholly-bold line as a section heading, not as a paragraph', () => {
    state = {
      data: ok({
        summary:
          'The client asked after an earnings call.\n\n**During the field window**\n\n- CMS moved.',
      }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    // This is how composeSummary() has always written the divider; before the
    // bullet change it rendered as ordinary body prose.
    expect(screen.getByText('During the field window').tagName).toBe('H4')
  })

  it('handles a mix of prose and bullets under one heading', () => {
    state = {
      data: ok({
        summary:
          '## Why this study exists\n\nThe client asked right after the Q2 call.\n\n- Novo cut guidance.\n- Lilly cut price.',
      }),
      isLoading: false,
      isError: false,
    }
    const { container } = render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/right after the Q2 call/i).tagName).toBe('P')
    expect(container.querySelectorAll('ul')).toHaveLength(1)
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
  })

  it('says so when a heading has nothing under it', () => {
    state = {
      data: ok({
        summary: '## Why this study exists\n\n- Novo cut guidance.\n\n**During the field window**',
      }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    // An empty section is a real answer (nothing moved in field) — it must not
    // render as an unexplained gap under a heading.
    expect(screen.getByText(/nothing was recorded under this heading/i)).toBeInTheDocument()
  })

  it('still renders a LEGACY prose-only summary, with nothing broken', () => {
    // Every row in production is this shape until its next refresh, which is the
    // common case for the first few days after the bullet prompt ships.
    const prose =
      'Airbnb told investors that hotels are listing on the platform. Management framed it as supply diversification, and analysts pressed on take rate.'
    state = { data: ok({ summary: prose }), isLoading: false, isError: false }
    const { container } = render(wrap(<ContextTab project={mkProject()} />))

    expect(container.querySelectorAll('ul')).toHaveLength(0)
    expect(screen.getByText(/supply diversification/i).tagName).toBe('P')
    // ...and the reader is told why this one looks different from the next.
    expect(screen.getByText(/older prose format/i)).toBeInTheDocument()
    // No section header was invented for it, and no empty-section text either.
    expect(screen.queryByText(/nothing was recorded under this heading/i)).not.toBeInTheDocument()
  })
})

/**
 * PART 2: the chips shown for PR00376 in production were fragments of the project
 * title ("Considerers", "Current"). The server track fixes the extraction; the
 * presentation has to make correcting it cost one click in BOTH directions.
 */
describe('ContextTab — correcting the machine', () => {
  const withTopics = (over: Partial<ProjectContext> = {}) =>
    ok({
      auto_companies: ['Airbnb', 'Marriott'],
      auto_topics: ['hotel supply'],
      effective_companies: ['Airbnb', 'Marriott'],
      effective_topics: ['hotel supply'],
      ...over,
    })

  it('removes a wrong chip on one click, with no confirmation step', () => {
    state = { data: withTopics(), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    fireEvent.click(screen.getByRole('button', { name: 'Stop tracking Marriott' }))

    expect(setTopics).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('adds several comma-separated entries in one write', () => {
    state = { data: withTopics(), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    fireEvent.click(screen.getAllByText('+ add')[0]) // companies
    const input = screen.getByLabelText('Add a subject company')
    fireEvent.change(input, { target: { value: 'Novo Nordisk, Eli Lilly' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(setTopics).toHaveBeenCalledWith({
      companies_override: ['Airbnb', 'Marriott', 'Novo Nordisk', 'Eli Lilly'],
      topics_override: null,
    })
    // ONE write, not two: the payload is the complete desired list, so two
    // sequential adds would have to be built on a list the server has not
    // answered with yet — and the second would silently drop the first.
    expect(setTopics).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Add a subject company')).not.toBeInTheDocument()
  })

  it('ignores a duplicate rather than writing the same chip twice', () => {
    state = { data: withTopics(), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    fireEvent.click(screen.getAllByText('+ add')[0])
    const input = screen.getByLabelText('Add a subject company')
    fireEvent.change(input, { target: { value: 'airbnb' } })
    fireEvent.blur(input)

    expect(setTopics).not.toHaveBeenCalled()
  })

  it('puts a discarded suggestion back on one click', () => {
    state = {
      data: withTopics({ companies_override: ['Airbnb'], effective_companies: ['Airbnb'] }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    fireEvent.click(screen.getByRole('button', { name: 'Track Marriott' }))

    expect(setTopics).toHaveBeenCalledWith({
      companies_override: ['Airbnb', 'Marriott'],
      topics_override: null,
    })
  })

  it('keeps "ruled none" and "never ruled" apart in words, not just in the payload', () => {
    state = {
      data: withTopics({ topics_override: [], effective_topics: [] }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    // Removing the last chip lands here, so the state has to say which of the
    // two it is — and offer the way back to the other.
    const none = screen.getByText(/the team ruled there are no keywords/i)
    expect(none).toHaveTextContent(/searches nothing here/i)
    expect(none).toHaveTextContent(/not the same as/i)
    expect(screen.getAllByRole('button', { name: 'Use suggestions' })).toHaveLength(1)
  })

  it('states the real cadence, and no longer claims a nightly one', () => {
    state = { data: withTopics(), isLoading: false, isError: false }
    const { container } = render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/suggested automatically, every 3 days/i)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/nightly/i)
  })

  it('shows the topics the server WOULD search before any brief exists', () => {
    // The hook fetches these for a project with no context row; without them the
    // moment an analyst's correction is worth the most shows an empty list.
    state = {
      data: {
        available: true,
        context: null,
        suggested: { companies: ['Novo Nordisk'], topics: ['GLP-1 adherence'] },
      },
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByRole('button', { name: 'Stop tracking Novo Nordisk' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop tracking GLP-1 adherence' })).toBeInTheDocument()
    // Nobody has ruled yet, so they are drawn as suggestions.
    expect(screen.getByText('Novo Nordisk').parentElement?.className).toMatch(/border-dashed/)
  })
})

/**
 * PART 3: this tab asks an analyst to believe an AI briefing. It must never look
 * confident when it is uncorroborated, or fresh when it is stale.
 */
describe('ContextTab — trust signals', () => {
  it('shouts when a successful brief has gone stale', () => {
    state = { data: ok({ generated_at: daysAgo(21) }), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    const banner = screen.getByText(/out of date/i)
    expect(banner).toHaveTextContent('21 days old')
    expect(banner.className).toMatch(/red/)
    expect(screen.getByText(/rebuilds about every 3 days/i)).toBeInTheDocument()
  })

  it('flags a brief that has missed a run, more mildly', () => {
    state = { data: ok({ generated_at: daysAgo(6) }), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText('This brief is 6 days old')).toBeInTheDocument()
    expect(screen.queryByText(/out of date/i)).not.toBeInTheDocument()
  })

  it('says nothing about age when the brief is current', () => {
    state = { data: ok({ generated_at: daysAgo(2) }), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.queryByText(/days old/i)).not.toBeInTheDocument()
  })

  it('does not stack the age banner on top of a failure banner', () => {
    state = {
      data: ok({ status: 'error', error: 'Search provider timed out', generated_at: daysAgo(21) }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    // The failure banner already says how old the surviving brief is.
    expect(screen.getByText(/the last refresh failed/i)).toBeInTheDocument()
    expect(screen.queryByText(/out of date/i)).not.toBeInTheDocument()
  })

  it('marks a link the search returned but the briefing never cited', () => {
    state = {
      data: ok({
        status: 'empty',
        sources: [
          {
            url: 'https://example.com/hit',
            title: 'Something the search turned up',
            publisher: 'Example Wire',
            published_at: '2026-08-01',
            note: null,
            // reconcileSources keeps the raw hits when it could not match a
            // single citation. A hit is NOT evidence.
            uncorroborated: true,
          },
        ],
      }),
      isLoading: false,
      isError: false,
    }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText(/^search hit/i)).toBeInTheDocument()
    expect(screen.getByText(/1 not cited/)).toBeInTheDocument()
    expect(screen.getByText(/none of these were cited by the briefing/i)).toBeInTheDocument()
    // Still linked, so the analyst can go and look.
    expect(screen.getByRole('link', { name: 'Something the search turned up' })).toHaveAttribute(
      'href',
      'https://example.com/hit',
    )
  })

  it('shows what the briefing used a cited source FOR', () => {
    state = { data: ok(), isLoading: false, isError: false }
    render(wrap(<ContextTab project={mkProject()} />))

    expect(screen.getByText('Cited for the supply remark')).toBeInTheDocument()
    expect(screen.queryByText(/^search hit/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not cited/i)).not.toBeInTheDocument()
  })
})
