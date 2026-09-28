import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectCard, ScopingSignalsContext } from '@/components/board/ProjectCard'
import { fieldActivityOf } from '@/lib/board/sections'
import type { SlimProject } from '@/lib/hooks/useProjects'

const asProject = (p: object) => p as SlimProject

// Mock the submissions hook so tests don't need a real Supabase client
vi.mock('@/lib/hooks/useSubmissions', () => ({
  useLatestSubmissionStatuses: () => ({ data: undefined }),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const mockProject = {
  id: '1',
  project_name: 'AARP Membership',
  client: 'AARP',
  project_type: 'PS' as const,
  due_date: '2099-12-31',
  n_collected: 1200,
  n_target: 1350,
  latest_next_steps: 'Waiting on client feedback on survey doc feedback from the team',
  captain: { id: '1', name: 'Anne W', initials: 'AW' },
  terminations: false,
  board_column: 'Survey Programming' as const,
  phase: 'Active' as const,
  status: 'Open' as const,
  // required fields with defaults
  captain_id: '1',
  phase_value: 'Active',
  scoping_stage: null,
  submitted_date: null,
  launch_date: null,
  deliver_date: null,
  n_last_synced: null,
  audience_size: null,
  row_level_data: false,
  stage_doc_programming: true,
  stage_survey_programming: false,
  stage_edwin_qa: false,
  stage_fielding: false,
  stage_data_qa: false,
  stage_delivery: false,
  linked_documents: [],
  calendar_event_id: null,
  survey_tool_id: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

describe('ProjectCard', () => {
  it('renders project name', () => {
    render(<ProjectCard project={asProject(mockProject)} />, { wrapper })
    expect(screen.getByText('AARP Membership')).toBeInTheDocument()
  })
  it('renders client name', () => {
    render(<ProjectCard project={asProject(mockProject)} />, { wrapper })
    expect(screen.getByText('AARP')).toBeInTheDocument()
  })
  it('renders type badge', () => {
    render(<ProjectCard project={asProject(mockProject)} />, { wrapper })
    expect(screen.getByText('PS')).toBeInTheDocument()
  })
  it('renders captain initials', () => {
    render(<ProjectCard project={asProject(mockProject)} />, { wrapper })
    expect(screen.getByText('AW')).toBeInTheDocument()
  })
  it('shows unassigned warning when no captain', () => {
    render(<ProjectCard project={asProject({ ...mockProject, captain: null })} />, { wrapper })
    expect(screen.getByText(/Unassigned/)).toBeInTheDocument()
  })
  it('shows overdue warning for past due date', () => {
    render(<ProjectCard project={asProject({ ...mockProject, due_date: '2020-01-01' })} />, { wrapper })
    expect(screen.getByText(/⚠/)).toBeInTheDocument()
  })
  it('truncates latest next steps at 100 chars', () => {
    const longText = 'A'.repeat(150)
    render(<ProjectCard project={asProject({ ...mockProject, latest_next_steps: longText })} />, { wrapper })
    const snippet = screen.getByText(/A+…/)
    expect(snippet.textContent!.length).toBeLessThanOrEqual(104) // 100 + '…'
  })
  it('does not show snippet when latest_next_steps is null', () => {
    render(<ProjectCard project={asProject({ ...mockProject, latest_next_steps: null })} />, { wrapper })
    // no snippet paragraph rendered — check there's no element with the snippet's line-clamp class
    const snippets = document.querySelectorAll('p.line-clamp-2')
    expect(snippets.length).toBe(0)
  })
})

describe('ProjectCard — On hold badge', () => {
  it('says "On hold" in words, with an (i) that explains how to end the hold', () => {
    render(<ProjectCard project={asProject({ ...mockProject, status: 'Hold' })} />, { wrapper })
    expect(screen.getByText(/On hold/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Resume/ })).toBeInTheDocument()
  })
  it('reading the (i) does not open the project', () => {
    const onClick = vi.fn()
    render(<ProjectCard project={asProject({ ...mockProject, status: 'Hold' })} onClick={onClick} />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: /Resume/ }))
    expect(onClick).not.toHaveBeenCalled()
  })
  it('an open card has no hold badge', () => {
    render(<ProjectCard project={asProject(mockProject)} />, { wrapper })
    expect(screen.queryByText(/On hold/)).not.toBeInTheDocument()
  })
})

describe('ProjectCard — "Has field activity" flag', () => {
  const scoping = { ...mockProject, id: 's1', phase: 'Scoping' as const, board_column: 'Submitted' as const }
  const activity = fieldActivityOf({ phase: 'Scoping', n_collected: 23 }, { blasts: 17, panel: 0, sendCosts: 0 })!

  it('shows inside the scoping lane when the lane says the survey has fielded, and names what was found', () => {
    const onClick = vi.fn()
    render(
      <ScopingSignalsContext.Provider value={new Map([['s1', activity]])}>
        <ProjectCard project={asProject(scoping)} onClick={onClick} />
      </ScopingSignalsContext.Provider>,
      { wrapper }
    )
    expect(screen.getByText(/Has field activity — move it out of Scoping\?/)).toBeInTheDocument()
    const info = screen.getByRole('button', { name: /17 blasts logged and 23 responses collected/ })
    fireEvent.click(info)
    expect(onClick).not.toHaveBeenCalled()
  })
  it('is absent for a card the lane did not flag', () => {
    render(
      <ScopingSignalsContext.Provider value={new Map([['someone-else', activity]])}>
        <ProjectCard project={asProject(scoping)} />
      </ScopingSignalsContext.Provider>,
      { wrapper }
    )
    expect(screen.queryByText(/Has field activity/)).not.toBeInTheDocument()
  })
  it('is absent outside the scoping lane (no provider)', () => {
    render(<ProjectCard project={asProject(scoping)} />, { wrapper })
    expect(screen.queryByText(/Has field activity/)).not.toBeInTheDocument()
  })
})
