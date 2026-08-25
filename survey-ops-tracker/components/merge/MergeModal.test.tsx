import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MergeModal } from './MergeModal'

const mutate = vi.fn()
vi.mock('@/lib/hooks/useMerge', () => ({
  useMergeProjects: () => ({ mutate, isPending: false }),
  useMergeClients: () => ({ mutate, isPending: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
// MergeModal reads the finance capability to decide whether restricted fields
// (Total budget) are even offered as conflicts. Mocked so these tests exercise
// merge behaviour rather than Supabase auth; the gating itself is covered below.
const canViewFinancials = vi.fn(() => true)
vi.mock('@/lib/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: [], isLoading: false }),
  useCanViewFinancials: () => canViewFinancials(),
}))

const a = { id: 'A', project_name: 'Tracker', due_date: '2026-07-20', budget: 6000, project_code: 'PR001' }
const b = { id: 'B', project_name: 'Tracker', due_date: '2026-07-25', budget: 6000, project_code: 'PR002' }
// Same pair but with DIFFERING budgets, so 'Total budget' is a real conflict and
// the only thing deciding whether it renders is the finance capability.
const richA = { ...a, budget: 6000 }
const richB = { ...b, budget: 9000 }

it('shows only differing fields and merges with the survivor + picks', () => {
  render(<MergeModal kind="project" a={a} b={b} open onClose={() => {}} />)
  expect(screen.getByText('Due date')).toBeInTheDocument()
  expect(screen.queryByText('Total budget')).not.toBeInTheDocument() // equal → hidden
  fireEvent.click(screen.getByRole('button', { name: /^Merge/ }))
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ survivorId: 'A', loserId: 'B' }),
    expect.anything()
  )
})

describe('restricted merge fields', () => {
  it('offers Total budget as a conflict to a finance-capability holder', () => {
    canViewFinancials.mockReturnValue(true)
    render(<MergeModal kind="project" a={richA} b={richB} open onClose={() => {}} />)
    expect(screen.getByText('Total budget')).toBeInTheDocument()
  })

  it('hides Total budget from everyone else, even though the values differ', () => {
    // The leak this guards: conflicts() surfaces every differing field and the
    // modal prints BOTH projects' values, so an ungated budget row showed two
    // restricted numbers side by side to any analyst merging two projects.
    canViewFinancials.mockReturnValue(false)
    render(<MergeModal kind="project" a={richA} b={richB} open onClose={() => {}} />)
    expect(screen.queryByText('Total budget')).not.toBeInTheDocument()
    expect(screen.queryByText('9,000')).not.toBeInTheDocument()
    expect(screen.queryByText('$9,000')).not.toBeInTheDocument()
  })
})
