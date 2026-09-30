import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { DrillSpec } from '@/lib/finance/drill'
import type { DrillOpts } from './tabs/types'
import { DrillPanel } from './DrillPanel'

/**
 * The drill panel is a modal dialog a keyboard user can actually use, and its
 * check can turn red. Both regress quietly: the old panel let Tab walk out
 * into the page behind it, and the old strip compared the rows with
 * themselves, so it could never fail.
 */

const router = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }

const CODES: Record<string, string> = { a: 'PR00001', b: 'PR00002', c: 'PR00003', x: 'PR00099' }

const spec = (o: Partial<DrillSpec> = {}): DrillSpec => ({
  key: 'margin',
  title: 'We keep — every survey with a price and a cost',
  population: 'Delivered · From 1 Jun 2026 · 2 surveys',
  columns: [
    { key: 'acct', header: 'Account', tip: 'The client account.', value: r => String(r.account ?? '') },
    { key: 'n', header: 'Billed N', tip: 'Delivered, never more than the N sold.', num: true, value: r => Number(r.n) },
  ],
  rows: [
    { id: 'a', code: 'PR00001', contribution: 100, account: 'BAM', n: 1200 },
    { id: 'b', code: 'PR00002', contribution: 50, account: 'Coatue', n: 80 },
  ],
  expectedTotal: 150,
  expectedIds: ['a', 'b'],
  totalLabel: 'We keep',
  format: 'money',
  ...o,
})

function Harness({ s, opts, onClose }: { s: DrillSpec; opts?: DrillOpts; onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
      <button type="button" onClick={() => setOpen(true)}>Open drill</button>
      <DrillPanel
        drill={open ? { spec: s, opts } : null}
        onClose={() => { onClose?.(); setOpen(false) }}
        codeOf={id => CODES[id] ?? null}
        exportContext={rows => ({
          header: ['SOCC finance export', `Rows: ${rows}`],
          audit: { route: 'finance-drill', filters: { tab: 'results' }, includedRestricted: true },
        })}
      />
    </AppRouterContext.Provider>
  )
}

async function openWith(s: DrillSpec, opts?: DrillOpts, onClose?: () => void) {
  const user = userEvent.setup()
  render(<Harness s={s} opts={opts} onClose={onClose} />)
  const trigger = screen.getByRole('button', { name: 'Open drill' })
  await user.click(trigger)
  return { user, trigger, dialog: screen.getByRole('dialog') }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

describe('an accessible dialog', () => {
  it('is a modal dialog labelled by its title and described by its population', async () => {
    const { dialog } = await openWith(spec())
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const title = screen.getByRole('heading', { name: /We keep — every survey/ })
    expect(dialog).toHaveAttribute('aria-labelledby', title.id)
    expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('Delivered · From 1 Jun 2026 · 2 surveys').id)
  })

  it('moves focus in, to the close button', async () => {
    await openWith(spec())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close the list' }))
  })

  it('traps Tab and Shift+Tab inside the panel', async () => {
    const { dialog } = await openWith(spec())
    const close = screen.getByRole('button', { name: 'Close the list' })
    const download = screen.getByRole('button', { name: 'Download these rows' })
    // Shift+Tab from the first control wraps to the last…
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(download)
    // …and Tab from the last wraps to the first. Focus never reaches the page.
    fireEvent.keyDown(download, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    // Focus that has somehow landed outside is pulled back in.
    screen.getByRole('button', { name: 'Open drill' }).focus()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('closes on Escape and hands focus back to the figure that opened it', async () => {
    const onClose = vi.fn()
    const { trigger } = await openWith(spec(), undefined, onClose)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('locks the page behind it from scrolling, and unlocks it on close', async () => {
    const { user } = await openWith(spec())
    expect(document.body.style.overflow).toBe('hidden')
    await user.click(screen.getByRole('button', { name: 'Close the list' }))
    expect(document.body.style.overflow).toBe('')
  })
})

describe('the check strip', () => {
  it('is green when the rows add back to the figure and every counted survey is listed', async () => {
    await openWith(spec())
    const strip = screen.getByTestId('drill-check')
    expect(strip).toHaveAttribute('data-ok', 'true')
    expect(strip).toHaveTextContent('The 2 rows below add up to $150, which matches the figure.')
  })

  it('is red with the gap and the codes of missing and extra surveys when they disagree', async () => {
    await openWith(spec({
      rows: [
        { id: 'a', code: 'PR00001', contribution: 100, account: 'BAM', n: 1 },
        { id: 'x', code: 'PR00099', contribution: 25, account: 'BAM', n: 1 },
      ],
      expectedTotal: 150,
      expectedIds: ['a', 'c'],
    }))
    const strip = screen.getByTestId('drill-check')
    expect(strip).toHaveAttribute('data-ok', 'false')
    expect(strip).toHaveAttribute('role', 'alert')
    expect(strip).toHaveTextContent('These rows add up to $125 but the figure says $150 — a gap of $25.')
    // The missing survey is not in the rows, so its code comes from the page.
    const missing = within(strip).getByRole('link', { name: 'PR00003' })
    expect(missing).toHaveAttribute('href', '/projects/c')
    expect(within(strip).getByRole('link', { name: 'PR00099' })).toHaveAttribute('href', '/projects/x')
    expect(strip).toHaveTextContent('Missing from this list: PR00003')
    expect(strip).toHaveTextContent('Listed here but not in the figure: PR00099')
  })

  it('checks only the ids when the figure is not a sum of the rows, and says so', async () => {
    await openWith(spec({ expectedTotal: null }))
    const strip = screen.getByTestId('drill-check')
    expect(strip).toHaveAttribute('data-ok', 'true')
    expect(strip).toHaveTextContent('only the list of studies is checked')
  })
})

describe('the rows', () => {
  it('shows survey codes as real links, and right-aligns numeric columns', async () => {
    await openWith(spec())
    const link = screen.getByRole('link', { name: 'PR00001' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/projects/a')
    const cell = screen.getByText('1,200')
    expect(cell.className).toContain('text-right')
    expect(screen.getByRole('columnheader', { name: /Billed N/ }).className).toContain('text-right')
  })

  it('gives every column header an (i)', async () => {
    await openWith(spec())
    for (const name of ['The client account.', 'Delivered, never more than the N sold.']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('offers the "filter the page" link as a real href when the tab gives one', async () => {
    await openWith(spec(), { filter: { href: '/finance?range=custom&from=2026-08-01&to=2026-08-31', label: 'Filter the page to Aug 2026' } })
    expect(screen.getByRole('link', { name: 'Filter the page to Aug 2026' }))
      .toHaveAttribute('href', '/finance?range=custom&from=2026-08-01&to=2026-08-31')
  })
})

describe('Download these rows', () => {
  it('downloads first, then reports the logged export number', async () => {
    const created: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: (b: Blob) => { created.push(b); return 'blob:x' },
      revokeObjectURL: () => {},
    }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, id: 'abcdef12-0000-0000-0000-000000000000' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { user } = await openWith(spec())
    await user.click(screen.getByRole('button', { name: 'Download these rows' }))
    expect(created).toHaveLength(1)
    const text = await created[0].text()
    expect(text).toContain('SOCC finance export')
    expect(text).toContain('Rows: 2')
    expect(text).toContain('Drill: We keep — every survey with a price and a cost')
    expect(text).toContain('PR00001,BAM,1200,100')
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ route: 'finance-drill', rowCount: 2, includedRestricted: true })
    expect(body.filters).toMatchObject({ drill: 'margin', reconciled: true, tab: 'results' })
    expect(await screen.findByText('Logged as export #abcdef12')).toBeInTheDocument()
  })

  it('says the export was not logged, without blocking the file', async () => {
    const created: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: (b: Blob) => { created.push(b); return 'blob:x' },
      revokeObjectURL: () => {},
    }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'the audit row could not be written' }), { status: 500 })))
    const { user } = await openWith(spec())
    await user.click(screen.getByRole('button', { name: 'Download these rows' }))
    expect(created).toHaveLength(1)
    expect(await screen.findByText(/^Export not logged: the audit row could not be written/)).toBeInTheDocument()
  })
})
