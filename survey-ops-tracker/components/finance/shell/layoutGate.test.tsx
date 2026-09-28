import { render, screen } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { financeAccess } from '@/lib/auth/capabilities'
import FinanceLayout from '@/app/(app)/finance/layout'
import { useFinanceAccess } from './FinanceAccess'

/**
 * The finance gate (David, 2026-09-24: /finance is for view_financials holders
 * only). The layout is a server component, so it is called here as the async
 * function it is and its output rendered. The point of every test is the same:
 * without a clear yes, the page's children are NEVER rendered — not hidden,
 * not rendered — so none of the page's code runs and none of its data is read.
 *
 * The second point, from the review: a failed read must not be SAID as a
 * refusal. "Finance is limited to the finance team: David, Shanu and Vineet"
 * names three people and is a fact about the reader; a query that did not come
 * back is not that fact.
 */

// Hoisted above the imports, so the layout imports this stand-in and never
// the real server-only module.
vi.mock('@/lib/auth/capabilities', () => ({ financeAccess: vi.fn() }))

const rendered = vi.fn()
function Secret() {
  rendered()
  return <p>Client price $274,038</p>
}
function Probe() {
  return <p>{useFinanceAccess() ? 'server said yes' : 'no verdict'}</p>
}

const renderLayout = async (children: React.ReactNode) => render(await FinanceLayout({ children }))

beforeEach(() => {
  rendered.mockClear()
  vi.mocked(financeAccess).mockReset()
})

describe('the /finance server gate', () => {
  it('shows a plain, friendly page and never the children to a non-holder', async () => {
    vi.mocked(financeAccess).mockResolvedValue('no')
    await renderLayout(<Secret />)
    expect(screen.getByText('Finance is limited to the finance team: David, Shanu and Vineet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the board' })).toHaveAttribute('href', '/')
    expect(rendered).not.toHaveBeenCalled()
    expect(screen.queryByText(/\$274,038/)).toBeNull()
  })

  it('fails closed when the check throws, and does not call it a refusal', async () => {
    vi.mocked(financeAccess).mockRejectedValue(new Error('profiles did not load'))
    await renderLayout(<Secret />)
    expect(rendered).not.toHaveBeenCalled()
    expect(screen.getByText('We could not check your access just now.')).toBeInTheDocument()
    expect(screen.queryByText(/Finance is limited/)).toBeNull()
  })

  it('a read that did not answer says so, names nobody, and offers a reload', async () => {
    vi.mocked(financeAccess).mockResolvedValue('unknown')
    await renderLayout(<Secret />)
    expect(rendered).not.toHaveBeenCalled()
    expect(screen.getByText('We could not check your access just now.')).toBeInTheDocument()
    expect(screen.getByText(/Nothing is wrong with your account/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reload' })).toHaveAttribute('href', '/finance')
    // The definite refusal, and the three names in it, must not appear.
    expect(screen.queryByText(/Finance is limited/)).toBeNull()
    expect(screen.queryByText(/Vineet/)).toBeNull()
  })

  it('fails closed on anything but a clear yes', async () => {
    vi.mocked(financeAccess).mockResolvedValue(undefined as unknown as 'yes')
    await renderLayout(<Secret />)
    expect(rendered).not.toHaveBeenCalled()
    // Not a clear no either, so it reads as "could not tell", not as a refusal.
    expect(screen.queryByText(/Finance is limited/)).toBeNull()
  })

  it('renders the page for a holder, inside the verified provider the page checks', async () => {
    vi.mocked(financeAccess).mockResolvedValue('yes')
    await renderLayout(<><Secret /><Probe /></>)
    expect(rendered).toHaveBeenCalled()
    expect(screen.getByText('server said yes')).toBeInTheDocument()
    expect(screen.queryByText(/Finance is limited/)).toBeNull()
    expect(screen.queryByText(/could not check/)).toBeNull()
  })

  it('outside the gate, the page reads no verdict (its second lock)', () => {
    render(<Probe />)
    expect(screen.getByText('no verdict')).toBeInTheDocument()
  })
})
