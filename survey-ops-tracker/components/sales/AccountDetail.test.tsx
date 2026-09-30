import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountDetail, ACCOUNT_COLS } from './AccountDetail'
import {
  FIXTURE_CLIENT, FIXTURE_ROWS, FIXTURE_TERMS, FIXTURE_NEVER_RECORDED,
} from '@/lib/sales/statement.fixture'

/**
 * The account table's columns, and what a column choice saved before one of
 * them was retired does now.
 *
 * WHY THIS FILE EXISTS: David, 2026-09-28 — "remove Collected and only keep the
 * Final (ie Delivered) and Target". Removing a column is a one-line edit; the
 * thing that breaks quietly is the choice a reader already saved, which names
 * the column by an id nothing renders any more. Every assertion below is about
 * one of those two halves: the column is gone, and no stored choice comes back
 * as a table missing its response count.
 *
 * The rows are the real fixture (lib/sales/statement.fixture), so the table is
 * exercised against the awkward cases — surveys never priced, a count typed in
 * mid-field, four surveys whose collection was never recorded — rather than
 * against a row invented to pass.
 *
 * next/link is a plain anchor here. This file is about which headers render,
 * and the App Router context Link wants in Next 15 is not part of that question.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...rest}>{children}</a>,
}))

const V2 = 'socc-sales-account-columns-v2'
const V1 = 'socc-sales-account-columns'

const CLIENT = { ...FIXTURE_CLIENT, salesperson: 'A Salesperson', created_at: '2024-01-01' }

/** No study priced — the state 52 of 63 owned accounts are actually in. */
const NO_VALUE = { byId: {} as Record<string, number>, withN: [] as string[], blocked: false }

const show = (value = NO_VALUE) => render(
  <AccountDetail
    client={CLIENT}
    projects={FIXTURE_ROWS}
    contacts={[]}
    terms={FIXTURE_TERMS}
    neverRecordedIds={FIXTURE_NEVER_RECORDED}
    value={value}
  />,
)

/** The table's headers, left to right. */
const headers = () => screen.getAllByRole('columnheader').map(th => th.textContent)

/** The picker's ticks, open it first. */
const openPicker = async () => {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Columns' }))
}

beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AccountDetail columns', () => {
  it('offers no Collected column at all', () => {
    expect(ACCOUNT_COLS.map(c => c.id)).not.toContain('collected')
    expect(ACCOUNT_COLS.map(c => c.label)).not.toContain('Collected')
  })

  it('shows Target and Final, and no Collected, by default', () => {
    show()
    expect(headers()).toEqual([
      'Code', 'Study', 'Requested by', 'Stage', 'Target', 'Final', 'Credits', 'Delivered',
    ])
    expect(headers()).not.toContain('Collected')
  })

  it('does not offer Collected in the picker', async () => {
    show()
    await openPicker()
    expect(screen.queryByRole('checkbox', { name: 'Collected' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Target' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Final' })).toBeChecked()
  })
})

describe('AccountDetail: a column choice saved when Collected existed', () => {
  // The whole point of the migration: a reader who had deliberately set this
  // table up to show a response count still has one. Dropping the retired id
  // would leave them with Code and Survey and no figure.
  it('replaces Collected with Final in a v2 choice', () => {
    localStorage.setItem(V2, JSON.stringify(['code', 'survey', 'collected']))
    show()
    expect(headers()).toEqual(['Code', 'Study', 'Final'])
  })

  // v1 is the older key, where "collected" WAS the final figure on a delivered
  // survey — so the substitution is if anything more literal there.
  it('replaces Collected with Final in a v1 choice', () => {
    localStorage.setItem(V1, JSON.stringify(['code', 'survey', 'collected', 'credits']))
    show()
    expect(headers()).toEqual(['Code', 'Study', 'Final', 'Credits'])
  })

  it('never leaves the table columnless, even when Collected was the only tick', () => {
    localStorage.setItem(V2, JSON.stringify(['collected']))
    show()
    expect(headers()).toEqual(['Final'])
  })

  it('adds Final once when a choice ticked both, in the order the table renders', () => {
    localStorage.setItem(V2, JSON.stringify(['final', 'collected', 'code']))
    show()
    expect(headers()).toEqual(['Code', 'Final'])
  })

  // Deliberate, and pinned so nobody "helpfully" adds it: Target answers a
  // different question (what the client bought) and was never what Collected
  // meant. Inventing a tick the reader never made is not a migration. Target is
  // in the DEFAULT columns instead, which is what the test above checks.
  it('does not force Target on', () => {
    localStorage.setItem(V2, JSON.stringify(['code', 'collected']))
    show()
    expect(headers()).toEqual(['Code', 'Final'])
  })

  it('writes the retired id away on the first save, and reads back the same table', async () => {
    localStorage.setItem(V2, JSON.stringify(['code', 'survey', 'collected']))
    show()
    await openPicker()
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Credits' }))

    const saved = JSON.parse(localStorage.getItem(V2) as string)
    expect(saved).toEqual(['code', 'survey', 'final', 'credits'])
    expect(saved).not.toContain('collected')

    // Idempotent: the stored value now holds no retired id, so a second pass
    // through the migration changes nothing.
    cleanup()
    show()
    expect(headers()).toEqual(['Code', 'Study', 'Final', 'Credits'])
  })

  // A private window, or blocked site data: the read throws outright rather
  // than returning null. The table still has to render.
  it('falls back to the default columns when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    show()
    expect(headers()).toEqual([
      'Code', 'Study', 'Requested by', 'Stage', 'Target', 'Final', 'Credits', 'Delivered',
    ])
  })

  it('falls back to the default columns when the stored value is not a list of ids', () => {
    localStorage.setItem(V2, JSON.stringify({ cols: ['code'] }))
    show()
    expect(headers()).toContain('Target')
    expect(headers()).toContain('Final')
    expect(headers()).not.toContain('Collected')
  })
})

/**
 * The value of delivered work (David, 2026-09-30).
 *
 * The figure is computed on the server from lib/finance/revenue.ts and arrives
 * as plain JSON, so what these assert is the half that can mislead: what the
 * tile says when there is no figure. Measured on live data the day it was
 * built, 52 of 63 owned accounts with delivered work had NOTHING priced — so
 * the empty state is the normal state, not the edge case, and "$0" there would
 * read to a salesperson as "this client has paid us nothing".
 */
describe('value of delivered work', () => {
  const valueText = () =>
    screen.getByText('Value of delivered work').parentElement?.textContent ?? ''

  it('shows no dollar amount when nothing on the account is priced', () => {
    show()
    const t = valueText()
    expect(t).not.toMatch(/\$[\d,]*[1-9]/)
    expect(t).toMatch(/Not known yet/)
    expect(t).toMatch(/not the same as \$0/)
  })

  it('sums the studies that do have a figure, and says what it left out', () => {
    show({ byId: { 'p-00433': 5000, 'p-00390': 7500 }, withN: ['p-00433', 'p-00390'], blocked: false })
    const t = valueText()
    expect(t).toMatch(/\$12,500/)
    expect(t).toMatch(/across 2 studies of \d+ delivered/)
    expect(t).toMatch(/understates/)
  })

  it('says a failed read did not load, rather than showing zero', () => {
    show({ byId: { 'p-00433': 5000 }, withN: ['p-00433'], blocked: true })
    const t = valueText()
    expect(t).toMatch(/did not load/)
    expect(t).not.toMatch(/\$[\d,]*[1-9]/)
  })
})
