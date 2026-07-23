import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DeliverablesPanel } from '@/components/deliverables/DeliverablesPanel'

const remove = vi.fn()

vi.mock('@/lib/hooks/useDeliverables', () => ({
  useDeliverables: () => ({
    data: [
      {
        id: '1',
        file_name: '2026.06.10 — Topline.pdf',
        original_file_name: 'Topline.pdf',
        kind: 'file',
        status: 'filed',
        source: 'email',
        drive_file_id: 'd1',
        source_url: null,
        filed_at: '2026-06-10T00:00:00Z',
      },
      {
        id: '2',
        file_name: '2026.06.10 — Occam study',
        original_file_name: null,
        kind: 'link',
        status: 'filed',
        source: 'email',
        drive_file_id: 'bm1',
        source_url: 'https://app.occamdata.com/study/42',
        filed_at: '2026-06-10T00:00:00Z',
      },
    ],
    isLoading: false,
  }),
  useUploadDeliverable: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveDeliverable: () => ({ mutate: remove, isPending: false }),
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('DeliverablesPanel', () => {
  beforeEach(() => {
    remove.mockClear()
  })

  it('lists filed deliverables and shows the attach control', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    expect(screen.getByText('2026.06.10 — Topline.pdf')).toBeInTheDocument()
    expect(screen.getByText(/attach deliverable/i)).toBeInTheDocument()
  })

  it('link row anchor href is source_url, not a drive.google.com URL', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    const anchor = screen.getByRole('link', { name: '2026.06.10 — Occam study' })
    expect(anchor).toHaveAttribute('href', 'https://app.occamdata.com/study/42')
    expect(anchor.getAttribute('href')).not.toMatch(/drive\.google\.com/)
  })

  it('remove asks for confirmation, then fires the mutation on confirm', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    fireEvent.click(screen.getAllByLabelText('Remove deliverable')[0])
    expect(screen.getByText(/stays in the client/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(remove).toHaveBeenCalledWith('1', expect.anything())
  })

  it('Keep cancels the remove without firing the mutation', () => {
    render(wrap(<DeliverablesPanel projectId="p1" />))
    fireEvent.click(screen.getAllByLabelText('Remove deliverable')[0])
    expect(screen.getByText(/stays in the client/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.queryByText(/stays in the client/i)).not.toBeInTheDocument()
  })
})
