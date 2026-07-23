import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DeliverablesPanel } from '@/components/deliverables/DeliverablesPanel'

const rename = vi.fn()
const remove = vi.fn()

vi.mock('@/lib/hooks/useDeliverables', () => ({
  useDeliverables: () => ({
    data: [
      {
        id: '1',
        file_name: '2026.06.10 — Topline.pdf',
        original_file_name: 'Topline.pdf',
        display_name: null,
        kind: 'file',
        status: 'filed',
        source: 'email',
        drive_file_id: 'd1',
        source_url: null,
        filed_at: '2026-06-10T00:00:00Z',
      },
      {
        id: '2',
        file_name: '2026.06.10 — bit.ly/x9f2',
        original_file_name: null,
        display_name: 'Live dashboard',
        kind: 'link',
        status: 'filed',
        source: 'upload',
        drive_file_id: 'bm1',
        source_url: 'https://app.occamdata.com/study/42',
        filed_at: '2026-06-10T00:00:00Z',
      },
    ],
    isLoading: false,
  }),
  useUploadDeliverable: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameDeliverable: () => ({ mutate: rename, isPending: false }),
  useRemoveDeliverable: () => ({ mutate: remove, isPending: false }),
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('DeliverablesPanel rename & remove', () => {
  beforeEach(() => {
    rename.mockClear()
    remove.mockClear()
  })

  it('shows the display_name override in preference to file_name', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    expect(screen.getByRole('link', { name: 'Live dashboard' })).toBeInTheDocument()
    expect(screen.queryByText('2026.06.10 — bit.ly/x9f2')).not.toBeInTheDocument()
  })

  it('renames via the pencil: opens an input and fires the mutation with the typed value', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    fireEvent.click(screen.getAllByLabelText('Rename')[0])
    const input = screen.getByDisplayValue('2026.06.10 — Topline.pdf')
    fireEvent.change(input, { target: { value: 'Final topline' } })
    fireEvent.click(screen.getByText('Save'))
    expect(rename).toHaveBeenCalledWith(
      { id: '1', displayName: 'Final topline' },
      expect.anything(),
    )
  })

  it('Escape cancels rename without firing the mutation', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    fireEvent.click(screen.getAllByLabelText('Rename')[0])
    const input = screen.getByDisplayValue('2026.06.10 — Topline.pdf')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(rename).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: '2026.06.10 — Topline.pdf' })).toBeInTheDocument()
  })

  it('remove asks for confirmation, then fires the mutation on confirm', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    fireEvent.click(screen.getAllByLabelText('Remove deliverable')[0])
    expect(screen.getByText(/stays in the client/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(remove).toHaveBeenCalledWith('1', expect.anything())
  })

  it('shows "reset to auto name" only for rows with an override', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    expect(screen.getAllByText(/reset to auto name/i)).toHaveLength(1)
  })
})
