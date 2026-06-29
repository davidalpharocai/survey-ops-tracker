import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReviewQueue } from '@/components/deliverables/ReviewQueue'

const resolveMutate = vi.fn()
const dismissMutate = vi.fn()

vi.mock('@/lib/hooks/useReviewQueue', () => ({
  useReviewQueue: () => ({
    data: [{
      id: 'd1', file_name: '2026.06.15 — Topline.pdf', original_file_name: 'Topline.pdf', kind: 'file',
      status: 'review', source_url: null, drive_file_id: 'f1', email_subject: 'Final topline', email_from: 'analyst@alpharoc.ai',
      match_candidates: [{ clientId: 'c1', projectId: 'p1', confidence: 0.7, band: 'Med', label: 'Coatue → B2B Tracker (PR00003)' }],
      client_id: null, project_id: null,
    }],
    isLoading: false,
  }),
  useProjectOptions: () => ({ data: [{ id: 'p1', label: 'Coatue — B2B Tracker (PR00003)' }], isLoading: false }),
  useResolveDeliverable: () => ({ mutate: resolveMutate, isPending: false }),
  useDismissDeliverable: () => ({ mutate: dismissMutate, isPending: false }),
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('ReviewQueue', () => {
  it('shows the email context and a candidate with its band', () => {
    render(wrap(<ReviewQueue />))
    expect(screen.getByText('Final topline')).toBeInTheDocument()
    expect(screen.getByText(/Coatue → B2B Tracker \(PR00003\)/)).toBeInTheDocument()
    expect(screen.getByText(/Med/)).toBeInTheDocument()
  })

  it('files the chosen candidate via the resolve mutation', () => {
    render(wrap(<ReviewQueue />))
    fireEvent.click(screen.getByRole('button', { name: /Coatue → B2B Tracker \(PR00003\)/ }))
    expect(resolveMutate).toHaveBeenCalledWith({ id: 'd1', projectId: 'p1' })
  })

  it('dismisses non-deliverables', () => {
    render(wrap(<ReviewQueue />))
    fireEvent.click(screen.getByRole('button', { name: /not a deliverable/i }))
    expect(dismissMutate).toHaveBeenCalledWith({ id: 'd1' })
  })
})
