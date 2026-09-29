import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

/**
 * Two things the ribbon has to get right.
 *
 * FINANCE (David, 2026-09-24): a main tab, after Calendar, shown ONLY to
 * finance holders. The two ways that goes wrong are both about the saved
 * order: a holder whose order was saved before Finance existed must still get
 * it, and a non-holder whose browser holds an order naming it must never see
 * it.
 *
 * INSIGHTS AND ADMIN (David, 2026-09-29): "lets move insights to the main nav
 * bar so analysts see it" — and Admin goes to the account menu with Sign out.
 * That is a tab ARRIVING and a tab LEAVING in one change, which is the case
 * mergeNavOrder has to survive without a storage-key bump: an order saved
 * yesterday names /admin and does not name /insights, and both have to be
 * reconciled against today's defaults rather than stranding the reader with a
 * ribbon that is missing its first tab and carrying a dead one.
 */

const caps = vi.hoisted(() => ({ finance: false }))
vi.mock('@/lib/hooks/useCapabilities', () => ({ useCanViewFinancials: () => caps.finance }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))
// The badge counts answer "0"; the account menu's identity lookup answers a
// roster row. `auth` is here because UserMenu reads the signed-in email before
// it reads the roster — without it the menu would still render (React Query
// swallows the throw and the circle falls back), which is exactly the kind of
// pass that proves nothing.
vi.mock('@/lib/supabase/client', () => {
  const chain: Record<string, unknown> = {}
  for (const k of ['select', 'in', 'is', 'eq']) chain[k] = () => chain
  chain.maybeSingle = async () => ({ data: { name: 'Test Analyst', initials: 'TA' } })
  chain.then = (resolve: (v: { count: number }) => unknown) => resolve({ count: 0 })
  return {
    createClient: () => ({
      from: () => chain,
      auth: { getUser: async () => ({ data: { user: { email: 'test@alpharoc.ai' } } }) },
    }),
  }
})
vi.mock('@/components/shared/NavSearch', () => ({ NavSearch: () => null }))
vi.mock('@/components/shared/ThemeToggle', () => ({ ThemeToggle: () => null }))

import { DEFAULT_TAB_ORDER, mergeNavOrder, NAV_ORDER_KEY, TopNav } from './TopNav'
import { initialsOf, viewerLabel } from './UserMenu'

const router = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }

function renderNav() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
      <QueryClientProvider client={qc}><TopNav /></QueryClientProvider>
    </AppRouterContext.Provider>,
  )
}

/** The ribbon's tabs, left to right, by href (the logo link excluded). Both
 *  menus are closed, so every other link on screen is a ribbon tab. */
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
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(['/finance', '/insights', '/review', '/calendar', '/reruns']))
    renderNav()
    expect(screen.queryByRole('link', { name: /Finance/ })).toBeNull()
    // …and the rest of their saved order is still honoured.
    expect(ribbon()).toEqual(['/insights', '/review', '/calendar', '/reruns'])
  })

  it('still shows it to a holder whose order was saved before Finance existed, after Calendar', () => {
    caps.finance = true
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(['/insights', '/calendar', '/reruns', '/review']))
    renderNav()
    expect(ribbon()).toEqual(['/insights', '/calendar', '/finance', '/reruns', '/review'])
  })

  it('is gone from the More menu for everyone', async () => {
    for (const holder of [false, true]) {
      caps.finance = holder
      const user = userEvent.setup()
      const { unmount } = renderNav()
      await user.click(screen.getByRole('button', { name: /More/ }))
      const menu = screen.getByRole('link', { name: /Internal Projects/ }).parentElement as HTMLElement
      expect(within(menu).queryByRole('link', { name: /Finance/ })).toBeNull()
      unmount()
    }
  })
})

describe('Insights is a ribbon tab, Admin is not', () => {
  it('leads the ribbon with Insights, as a real link', () => {
    renderNav()
    expect(ribbon()[0]).toBe('/insights')
    const link = screen.getByRole('link', { name: /Insights/ })
    expect(link).toHaveAttribute('href', '/insights')
    // A real href, so cmd/middle-click opens it in a tab like any other.
    expect(link.tagName).toBe('A')
  })

  it('no longer hides Insights in the More menu', async () => {
    const user = userEvent.setup()
    renderNav()
    await user.click(screen.getByRole('button', { name: /More/ }))
    // Exactly one Insights link on screen: the ribbon tab, not a second copy.
    expect(screen.getAllByRole('link', { name: /Insights/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /More/ }).getAttribute('title')).not.toMatch(/insights/i)
  })

  it('keeps Admin out of the ribbon and out of More', async () => {
    const user = userEvent.setup()
    renderNav()
    expect(ribbon()).not.toContain('/admin')
    await user.click(screen.getByRole('button', { name: /More/ }))
    expect(screen.queryByRole('link', { name: /Admin/ })).toBeNull()
  })

  it('drops a saved /admin and leads with Insights, with no storage-key bump', () => {
    // An order saved the day before the swap: names /admin, does not name
    // /insights. Both have to be reconciled, or the reader loses the new tab
    // and keeps a dead one.
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(['/reruns', '/calendar', '/review', '/admin']))
    renderNav()
    expect(ribbon()).toEqual(['/insights', '/reruns', '/calendar', '/review'])
  })
})

describe('the account menu', () => {
  it('shows the viewer’s initials and opens Admin and Sign out', async () => {
    const user = userEvent.setup()
    renderNav()
    const button = await screen.findByRole('button', { name: /Account/ })
    // Closed: neither destination is reachable yet.
    expect(screen.queryByRole('link', { name: /Sign out/ })).toBeNull()
    expect(button).toHaveAttribute('aria-expanded', 'false')

    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: /Admin/ })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('link', { name: /Sign out/ })).toHaveAttribute('href', '/signout')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    renderNav()
    const button = await screen.findByRole('button', { name: /Account/ })
    await user.click(button)
    expect(screen.getByRole('link', { name: /Sign out/ })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('link', { name: /Sign out/ })).toBeNull()
  })
})

describe('initialsOf', () => {
  it('prefers the roster initials, which is what the board avatars already use', () => {
    expect(initialsOf({ initials: 'aj', name: 'Someone Else', email: 'x@y.com' })).toBe('AJ')
  })

  it('takes first and last initial from a name, not the first two letters', () => {
    expect(initialsOf({ initials: null, name: 'Jenna Okafor', email: null })).toBe('JO')
    expect(initialsOf({ initials: null, name: 'Mary Anne Van Dyke', email: null })).toBe('MD')
  })

  it('falls back to two letters for a one-word name', () => {
    expect(initialsOf({ initials: null, name: 'Sree', email: null })).toBe('SR')
  })

  it('falls back to the email local part when there is no roster row', () => {
    // Not an error state: roster rows are added by hand, and an empty circle
    // would read as one.
    expect(initialsOf({ initials: null, name: null, email: 'david@alpharoc.ai' })).toBe('DA')
    expect(initialsOf({ initials: null, name: null, email: 'j.f@alpharoc.ai' })).toBe('JF')
  })

  it('never returns an empty string', () => {
    for (const v of [null, undefined, { initials: null, name: null, email: null }, { initials: '  ', name: ' ', email: '' }]) {
      expect(initialsOf(v).length).toBeGreaterThan(0)
    }
  })
})

describe('viewerLabel', () => {
  it('prefers the name, falls back to the email, then to nothing', () => {
    expect(viewerLabel({ initials: null, name: 'Jenna Okafor', email: 'j@a.ai' })).toBe('Jenna Okafor')
    expect(viewerLabel({ initials: null, name: null, email: 'j@a.ai' })).toBe('j@a.ai')
    expect(viewerLabel({ initials: null, name: '   ', email: null })).toBeNull()
    expect(viewerLabel(null)).toBeNull()
  })
})

describe('mergeNavOrder', () => {
  const D = DEFAULT_TAB_ORDER

  it('leads with Insights and puts Finance after Calendar', () => {
    expect([...D]).toEqual(['/insights', '/reruns', '/calendar', '/finance', '/review'])
    expect([...D]).not.toContain('/admin')
  })

  it('inserts a missing tab after its default predecessor, not at the end', () => {
    expect(mergeNavOrder(['/insights', '/reruns', '/calendar', '/review'], D))
      .toEqual(['/insights', '/reruns', '/calendar', '/finance', '/review'])
    expect(mergeNavOrder(['/review', '/calendar', '/reruns'], D))
      .toEqual(['/insights', '/review', '/calendar', '/finance', '/reruns'])
  })

  it('puts a missing first tab first, drops unknown and repeated hrefs, and gives up on junk', () => {
    expect(mergeNavOrder(['/reruns', '/calendar', '/finance', '/review'], D))
      .toEqual(['/insights', '/reruns', '/calendar', '/finance', '/review'])
    expect(mergeNavOrder(['/gone', '/reruns', '/reruns', 7], D))
      .toEqual(['/insights', '/reruns', '/calendar', '/finance', '/review'])
    expect(mergeNavOrder('nope', D)).toBeNull()
    expect(mergeNavOrder(['/gone'], D)).toBeNull()
  })

  it('drops a retired tab from a saved order', () => {
    // /admin left the ribbon on 2026-09-29. A saved order naming it must not
    // resurrect it — the tabs array no longer has one to render, so a stale
    // href would be a silent gap in the ribbon.
    expect(mergeNavOrder(['/admin', '/reruns'], D)).not.toContain('/admin')
    expect(mergeNavOrder(['/admin'], D)).toBeNull()
  })
})
