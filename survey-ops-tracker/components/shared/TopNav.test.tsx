import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

/**
 * Finance in the ribbon (David, 2026-09-24): a main tab, after Calendar, shown
 * ONLY to finance holders. The two ways this goes wrong are both about the
 * saved ribbon order: a holder whose order was saved before Finance existed
 * must still get it, and a non-holder whose browser somehow holds an order
 * that names it must never see it. And Finance leaves the More menu for
 * everyone.
 */

const caps = vi.hoisted(() => ({ finance: false }))
vi.mock('@/lib/hooks/useCapabilities', () => ({ useCanViewFinancials: () => caps.finance }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))
// The badge counts: every query answers "0".
vi.mock('@/lib/supabase/client', () => {
  const chain: Record<string, unknown> = {}
  for (const k of ['select', 'in', 'is', 'eq']) chain[k] = () => chain
  chain.then = (resolve: (v: { count: number }) => unknown) => resolve({ count: 0 })
  return { createClient: () => ({ from: () => chain }) }
})
vi.mock('@/components/shared/NavSearch', () => ({ NavSearch: () => null }))
vi.mock('@/components/shared/ThemeToggle', () => ({ ThemeToggle: () => null }))

import { DEFAULT_TAB_ORDER, mergeNavOrder, NAV_ORDER_KEY, TopNav } from './TopNav'

const router = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }

function renderNav() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
      <QueryClientProvider client={qc}><TopNav /></QueryClientProvider>
    </AppRouterContext.Provider>,
  )
}

/** The ribbon's tabs, left to right, by href (the logo link excluded). The
 *  More menu is closed, so every other link on screen is a ribbon tab. */
const ribbon = () => screen.getAllByRole('link')
  .map(a => a.getAttribute('href'))
  .filter(h => h !== '/')

beforeEach(() => {
  caps.finance = false
  localStorage.clear()
})
afterEach(() => localStorage.clear())

describe('Finance in the ribbon', () => {
  it('shows Finance to a finance holder, right after Calendar, as a real link', () => {
    caps.finance = true
    renderNav()
    const tabs = ribbon()
    expect(tabs.indexOf('/finance')).toBe(tabs.indexOf('/calendar') + 1)
    expect(screen.getByRole('link', { name: /Finance/ })).toHaveAttribute('href', '/finance')
  })

  it('never shows it to anyone else', () => {
    renderNav()
    expect(ribbon()).not.toContain('/finance')
    expect(screen.queryByRole('link', { name: /Finance/ })).toBeNull()
  })

  it('never shows it to a non-holder even when their saved order names it', () => {
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(['/finance', '/admin', '/review', '/calendar', '/reruns']))
    renderNav()
    expect(screen.queryByRole('link', { name: /Finance/ })).toBeNull()
    // …and the rest of their saved order is still honoured.
    expect(ribbon()).toEqual(['/admin', '/review', '/calendar', '/reruns'])
  })

  it('still shows it to a holder whose order was saved before Finance existed, after Calendar', () => {
    caps.finance = true
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(['/admin', '/calendar', '/reruns', '/review']))
    renderNav()
    expect(ribbon()).toEqual(['/admin', '/calendar', '/finance', '/reruns', '/review'])
  })

  it('is gone from the More menu for everyone, and Insights no longer promises budget', async () => {
    for (const holder of [false, true]) {
      caps.finance = holder
      const user = userEvent.setup()
      const { unmount } = renderNav()
      await user.click(screen.getByRole('button', { name: /More/ }))
      const menu = screen.getByRole('link', { name: /Insights/ }).parentElement as HTMLElement
      expect(within(menu).queryByRole('link', { name: /Finance/ })).toBeNull()
      expect(screen.getByRole('link', { name: /Insights/ }).getAttribute('title')).not.toMatch(/budget/i)
      unmount()
    }
  })
})

describe('mergeNavOrder', () => {
  const D = DEFAULT_TAB_ORDER

  it('puts Finance after Calendar in the default order', () => {
    expect([...D]).toEqual(['/reruns', '/calendar', '/finance', '/review', '/admin'])
  })

  it('inserts a missing tab after its default predecessor, not at the end', () => {
    expect(mergeNavOrder(['/reruns', '/calendar', '/review', '/admin'], D))
      .toEqual(['/reruns', '/calendar', '/finance', '/review', '/admin'])
    expect(mergeNavOrder(['/admin', '/review', '/calendar', '/reruns'], D))
      .toEqual(['/admin', '/review', '/calendar', '/finance', '/reruns'])
  })

  it('puts a missing first tab first, drops unknown and repeated hrefs, and gives up on junk', () => {
    expect(mergeNavOrder(['/calendar', '/finance', '/review', '/admin'], D))
      .toEqual(['/reruns', '/calendar', '/finance', '/review', '/admin'])
    expect(mergeNavOrder(['/gone', '/admin', '/admin', 7], D))
      .toEqual(['/reruns', '/calendar', '/finance', '/review', '/admin'])
    expect(mergeNavOrder('nope', D)).toBeNull()
    expect(mergeNavOrder(['/gone'], D)).toBeNull()
  })
})
