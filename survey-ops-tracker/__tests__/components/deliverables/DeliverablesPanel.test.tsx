import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DeliverablesPanel } from '@/components/deliverables/DeliverablesPanel'

vi.mock('@/lib/hooks/useDeliverables', () => ({
  useDeliverables: () => ({
    data: [
      {
        id: '1',
        file_name: '2026.06.10 — Topline.pdf',
        kind: 'file',
        status: 'filed',
        source: 'email',
        drive_file_id: 'd1',
        source_url: null,
        filed_at: '2026-06-10T00:00:00Z',
        original_file_name: 'Topline.pdf',
      },
      {
        id: '2',
        file_name: '2026.06.10 — Occam study',
        kind: 'link',
        status: 'filed',
        source: 'email',
        drive_file_id: 'bm1',
        source_url: 'https://app.occamdata.com/study/42',
        filed_at: '2026-06-10T00:00:00Z',
        original_file_name: null,
      },
    ],
    isLoading: false,
  }),
  useUploadDeliverable: () => ({ mutate: vi.fn(), isPending: false }),
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('DeliverablesPanel', () => {
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
})
