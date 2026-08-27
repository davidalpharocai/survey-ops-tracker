import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { RowLink } from '@/components/shared/RowLink'
import { ProjectCard } from '@/components/board/ProjectCard'
import { InternalCard } from '@/components/internal/InternalCard'
import { ProjectTable } from '@/components/list/ProjectTable'
import { CalendarAgenda } from '@/components/calendar/CalendarAgenda'
import { CalendarGrid } from '@/components/calendar/CalendarGrid'
import type { SlimProject } from '@/lib/hooks/useProjects'
import type { CalendarEvent } from '@/lib/calendar/events'

/**
 * Every hyperlinked thing must be a REAL <a href>.
 *
 * The bug this guards: navigation wired as `onClick={() => router.push(...)}` on
 * a <tr>/<div> looks clickable but is not a link — no "Open in new tab", no
 * middle-click, no cmd/ctrl-click, no status-bar URL, no keyboard focus, nothing
 * announced to a screen reader. People here work several studies side by side,
 * so that costs them every day. It is also exactly the kind of thing that
 * silently regresses the next time a row is refactored, hence these tests.
 */

const push = vi.fn()
const mockRouter = { push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/hooks/useSubmissions', () => ({
  useLatestSubmissionStatuses: () => ({ data: undefined }),
}))

const asProject = (p: object) => p as SlimProject

const baseProject = {
  id: 'proj-1',
  project_name: 'AARP Membership',
  client: 'AARP',
  project_type: 'PS' as const,
  board_column: 'Survey Programming' as const,
  phase: 'Active' as const,
  status: 'Open' as const,
  due_date: '2099-12-31',
  n_collected: 1200,
  n_target: 1350,
  n_actual: null,
  captain: { id: '1', name: 'Anne W', initials: 'AW' },
  captain_id: '1',
  latest_next_steps: null,
  priority: null,
  scoping_stage: null,
  submitted_date: null,
  launch_date: null,
  deliver_date: null,
  sort_order: 0,
  longitudinal: false,
  segment_count: 1,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

/** Renders with the App Router context Link needs to handle a click. */
function withRouter(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AppRouterContext.Provider value={mockRouter as unknown as AppRouterInstance}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </AppRouterContext.Provider>,
  )
}

beforeEach(() => {
  push.mockClear()
})

describe('RowLink', () => {
  it('is a real anchor carrying the href', () => {
    withRouter(<RowLink href="/projects/proj-1">AARP Membership</RowLink>)
    const link = screen.getByRole('link', { name: 'AARP Membership' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/projects/proj-1')
  })

  it('does not let a click reach the surrounding row handler (no double navigation)', () => {
    const rowClick = vi.fn()
    withRouter(
      <div onClick={rowClick}>
        <RowLink href="/projects/proj-1">AARP Membership</RowLink>
      </div>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'AARP Membership' }))
    expect(rowClick).not.toHaveBeenCalled()
  })
})

describe('ProjectTable (list view)', () => {
  const tableProps = {
    hiddenCols: new Set<string>(),
    onToggleCol: () => {},
    sortField: 'project_name' as const,
    sortDir: 'asc' as const,
    onSortChange: () => {},
  }

  it('renders the project name as a real anchor to the project', () => {
    withRouter(<ProjectTable projects={[asProject(baseProject)]} {...tableProps} />)
    const link = screen.getByRole('link', { name: 'AARP Membership' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/projects/proj-1')
  })

  it('keeps the whole-row click, but the row click and the link never both fire', () => {
    withRouter(<ProjectTable projects={[asProject(baseProject)]} {...tableProps} />)
    // Clicking a non-link cell still opens the project (row convenience click)
    fireEvent.click(screen.getByText('AARP'))
    expect(push).toHaveBeenCalledWith('/projects/proj-1')

    // Clicking the anchor leaves the navigation to the anchor: the row's own
    // router.push is stopped, so the project can't be pushed twice.
    push.mockClear()
    fireEvent.click(screen.getByRole('link', { name: 'AARP Membership' }))
    expect(push).not.toHaveBeenCalled()
  })
})

describe('board and internal cards', () => {
  it('ProjectCard title is a real anchor and does not also fire the card click', () => {
    const cardClick = vi.fn()
    withRouter(<ProjectCard project={asProject(baseProject)} onClick={cardClick} />)
    const link = screen.getByRole('link', { name: 'AARP Membership' })
    expect(link).toHaveAttribute('href', '/projects/proj-1')
    fireEvent.click(link)
    expect(cardClick).not.toHaveBeenCalled()
  })

  it('InternalCard title is a real anchor and does not also fire the card click', () => {
    const cardClick = vi.fn()
    withRouter(
      <InternalCard
        project={asProject({ ...baseProject, project_name: 'Tracker UX pass', project_type: 'Internal' })}
        sprintConfig={null}
        onClick={cardClick}
      />,
    )
    const link = screen.getByRole('link', { name: 'Tracker UX pass' })
    expect(link).toHaveAttribute('href', '/projects/proj-1')
    fireEvent.click(link)
    expect(cardClick).not.toHaveBeenCalled()
  })
})

describe('calendar chips', () => {
  const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: 'proj-1:due',
    type: 'due',
    date: '2099-12-31',
    title: 'AARP · Membership',
    projectId: 'proj-1',
    projectName: 'Membership',
    client: 'AARP',
    urgency: null,
    ...over,
  })

  it('agenda chip with a project is a real anchor', () => {
    withRouter(<CalendarAgenda byDate={{ '2099-12-31': [event()] }} />)
    const link = screen.getByRole('link', { name: /AARP · Membership/ })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/projects/proj-1')
  })

  it('agenda chip with no project renders no link at all', () => {
    withRouter(
      <CalendarAgenda
        byDate={{ '2099-12-31': [event({ id: 'reminder:1', type: 'reminder', projectId: null })] }}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('month-grid chip with a project is a real anchor', () => {
    withRouter(
      <CalendarGrid
        byDate={{ '2099-12-31': [event()] }}
        viewMonth={new Date(2099, 11, 1)}
        onMonthChange={() => {}}
      />,
    )
    const link = screen.getByRole('link', { name: /AARP · Membership/ })
    expect(link).toHaveAttribute('href', '/projects/proj-1')
  })
})
