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

const a = { id: 'A', project_name: 'Tracker', due_date: '2026-07-20', budget: 6000, project_code: 'PR001' }
const b = { id: 'B', project_name: 'Tracker', due_date: '2026-07-25', budget: 6000, project_code: 'PR002' }

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
