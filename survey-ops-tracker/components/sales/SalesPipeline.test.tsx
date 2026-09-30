import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SalesRow } from './SalesPipeline'

/**
 * The survey list's response column: what it is called, what each row's cell
 * claims, and what a column choice or a link saved before the rename does now.
 *
 * WHY THIS FILE EXISTS: David, 2026-09-28 — "remove Collected and only keep the
 * Final (ie Delivered) and Target". On THIS screen that is a rename, not a
 * delete. The cell has routed through deliveredN since 2026-09-23, so on a
 * delivered survey it already showed n_actual — the final figure — and the list
 * carries no other response count. Deleting it would have left a sales user
 * with a survey list that says nothing about responses, which is the opposite
 * of what was asked for.
 *
 * So the two halves tested below are the two ways a rename goes wrong:
 *
 *   1. The number stops being honest. "Collected 7" was self-explanatory;
 *      "Final 7" on a survey still in field is a claim that it delivered 7.
 *      Every non-delivered state has to carry its own mark.
 *   2. Something saved under the old id stops working — a stored column choice
 *      (socc-sales-columns), a saved view, a bookmarked ?s=collected sort.
 *      Those are silent failures: the reader gets a table missing its response
 *      count, or a list quietly re-sorted by Client.
 *
 * next/link is a plain anchor and next/navigation a fixed query string: this
 * file is about which headers render and what the cells say, and the App Router
 * context they want in Next 15 is not part of that question.
 */

let qs = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(qs),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...rest}>{children}</a>,
}))

import { SalesPipeline } from './SalesPipeline'

const STORE_KEY = 'socc-sales-columns'

const row = (o: Partial<SalesRow> & { id: string; project_name: string }): SalesRow => ({
  project_code: null, client: null, client_id: null, requested_by_name: null,
  board_column: 'Fielding', status: 'Open', phase: 'Active',
  n_target: null, n_target_max: null, n_collected: 0, n_actual: null,
  n_collected_updated_at: '2026-09-01', credits: null,
  submitted_date: null, deliver_date: null, delivered_at: null,
  ...o,
})

/**
 * Four surveys, one per reading of the response cell. The client names, the
 * response counts and the delivery dates each sort to a DIFFERENT order, so a
 * sort assertion can tell "sorted by Final" from "fell back to Client" and from
 * "never re-sorted at all".
 */
const ROWS: SalesRow[] = [
  // Delivered, with a recorded post-QA count: the only true Final on the list.
  row({
    id: 'a', project_name: 'Delivered survey', client: 'Alpha', client_id: 'c-a',
    board_column: 'Delivery', status: 'Closed',
    n_target: 250, n_collected: 404, n_actual: 260, deliver_date: '2026-01-04',
  }),
  // Still in field. 7 responses are in hand and nothing has been delivered.
  row({
    id: 'b', project_name: 'In field survey', client: 'Bravo', client_id: 'c-b',
    board_column: 'Fielding', status: 'Open',
    n_target: 75, n_collected: 7, deliver_date: '2026-01-03',
  }),
  // Out of field, in quality review, no actual recorded yet: deliveredN's
  // measured projection, which is an estimate and says so.
  row({
    id: 'c', project_name: 'Quality review survey', client: 'Charlie', client_id: 'c-c',
    board_column: 'Data QA', status: 'Open',
    n_target: 250, n_collected: 404, deliver_date: '2026-01-02',
  }),
  // Never counted: 0 is the column default, not a measurement (migration 111).
  row({
    id: 'd', project_name: 'Unrecorded survey', client: 'Delta', client_id: 'c-d',
    board_column: 'Submitted', status: 'Open',
    n_target: 1000, n_collected: 0, n_collected_updated_at: null, deliver_date: '2026-01-01',
  }),
]

const show = (rows: SalesRow[] = ROWS) => render(<SalesPipeline rows={rows} />)

/** The table's headers, left to right, without the sort arrow. */
const headers = () =>
  screen.getAllByRole('columnheader').map(th => (th.textContent ?? '').replace(/[↑↓]/g, '').trim())

/** The one header carrying the sort arrow, or null. */
const sortedHeader = () => {
  const th = screen.getAllByRole('columnheader').find(h => /[↑↓]/.test(h.textContent ?? ''))
  return th ? (th.textContent ?? '').replace(/[↑↓]/g, '').trim() : null
}

/** Survey names in the order the TABLE renders them. Scoped to the table
 *  because the toolbar's Export is an anchor too. */
const order = () =>
  within(screen.getByRole('table')).getAllByRole('link').map(a => a.textContent)

/** One survey's response cell. Sixth cell under the default columns: Survey,
 *  Client, Requested by, Stage, Target, Final. */
const finalCell = (survey: string) => {
  const tr = screen.getByRole('link', { name: survey }).closest('tr') as HTMLElement
  return (within(tr).getAllByRole('cell')[5].textContent ?? '')
}

const openPicker = () => userEvent.setup().click(screen.getByRole('button', { name: /Columns/ }))

beforeEach(() => { localStorage.clear(); qs = 'g=all' })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('SalesPipeline columns', () => {
  it('shows Target and Final, and no Collected, by default', () => {
    show()
    expect(headers()).toEqual([
      'Study', 'Client', 'Requested by', 'Stage', 'Target', 'Final', 'Credits', 'Deliver',
    ])
    expect(headers()).not.toContain('Collected')
  })

  it('does not offer Collected in the column picker', async () => {
    show()
    await openPicker()
    expect(screen.queryByRole('checkbox', { name: /^Collected/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /^Target/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^Final/ })).toBeChecked()
  })

  it('never puts the word Collected on the page', () => {
    show()
    expect(document.body.textContent).not.toContain('Collected')
  })
})

/**
 * The relabel's real risk. Under "Collected", a bare running count needed no
 * qualifier; under "Final" a bare number asserts the survey delivered it. The
 * figures themselves are unchanged — deliveredN still decides them — so these
 * assertions are about the MARKS.
 */
describe('SalesPipeline: only a delivered survey reads as final', () => {
  it('shows a recorded post-QA count plainly, with no hedge', () => {
    show()
    const c = finalCell('Delivered survey')
    expect(c).toMatch(/^260/)       // n_actual, not the 404 collected
    expect(c).toContain('104%')
    expect(c).not.toContain('so far')
    expect(c).not.toContain('~')
    expect(c).not.toContain('est.')
  })

  it('marks a survey still in field as "so far", never as a final figure', () => {
    show()
    const c = finalCell('In field survey')
    expect(c).toMatch(/^7/)
    expect(c).toContain('so far')
    // Not an estimate either: nothing has been projected, this is the count in
    // hand. deliveredN's end-of-life keep rate would print 6 under a 7.
    expect(c).not.toContain('est.')
    expect(c).not.toContain('~')
  })

  it('explains the in-field cell on hover rather than leaving "so far" bare', () => {
    show()
    const tr = screen.getByRole('link', { name: 'In field survey' }).closest('tr') as HTMLElement
    const mark = within(tr).getByText('so far')
    expect(mark.getAttribute('title')).toMatch(/still in field/i)
  })

  it('marks a survey past field but not delivered as an estimate', () => {
    show()
    const c = finalCell('Quality review survey')
    expect(c).toContain('~')
    expect(c).toContain('est.')
    // The over-collection is NOT the answer: 404 collected against a 250 target
    // projects to roughly what was sold.
    expect(c).not.toContain('404')
    expect(c).not.toContain('so far')
  })

  it('still says "not recorded" where no count has ever been entered', () => {
    show()
    const c = finalCell('Unrecorded survey')
    expect(c).toContain('not recorded')
    // A failed or absent measurement is not a zero, and never a final one.
    expect(c).not.toMatch(/\b0\b/)
    expect(c).not.toContain('so far')
  })
})

/**
 * "so far" says more is coming. Two shapes of FINISHED survey used to get it,
 * because the mark was inferred from what deliveredN returned rather than from
 * whether the survey was still collecting: a ranged target (which this cell
 * refuses to project against) and no target at all (which deliveredN cannot
 * project against). Measured 2026-09-28: 60 of 433 live surveys.
 */
describe('SalesPipeline: a finished survey is never "so far"', () => {
  const rangedDelivered = row({
    id: 'e', project_name: 'Ranged delivered survey', client: 'Echo', client_id: 'c-e',
    board_column: 'Delivery', status: 'Closed',
    n_target: 200, n_target_max: 300, n_collected: 1418, deliver_date: '2026-02-01',
  })
  const untargetedDelivered = row({
    id: 'f', project_name: 'Untargeted delivered survey', client: 'Foxtrot', client_id: 'c-f',
    board_column: 'Delivery', status: 'Closed',
    n_collected: 100, deliver_date: '2026-02-02',
  })

  it('does not claim a delivered survey sold as a range is still collecting', () => {
    show([rangedDelivered])
    const c = finalCell('Ranged delivered survey')
    expect(c).not.toContain('so far')
    // And it does not read as a final figure either — nothing post-QA was ever
    // recorded, so an unmarked 1,418 in a column headed Final would be a claim.
    expect(c).toContain('not final')
  })

  it('does not claim a delivered survey with no target is still collecting', () => {
    show([untargetedDelivered])
    const c = finalCell('Untargeted delivered survey')
    expect(c).not.toContain('so far')
    expect(c).toContain('not final')
  })

  it('says on hover why the figure is not final, instead of leaving the mark bare', () => {
    show([rangedDelivered, untargetedDelivered])
    const ranged = screen.getByRole('link', { name: 'Ranged delivered survey' }).closest('tr') as HTMLElement
    expect(within(ranged).getByText('not final').getAttribute('title')).toMatch(/range/i)
    const untargeted = screen.getByRole('link', { name: 'Untargeted delivered survey' }).closest('tr') as HTMLElement
    // deliveredN's own sentence for the no-target case, not a second copy of it.
    expect(within(untargeted).getByText('not final').getAttribute('title')).toMatch(/no target is set/i)
  })

  it('still marks a survey sold as a range and STILL in field "so far"', () => {
    // The fix must not take the mark off the rows that earned it.
    show([row({
      id: 'g', project_name: 'Ranged in field survey', client: 'Golf', client_id: 'c-g',
      board_column: 'Fielding', status: 'Open',
      n_target: 200, n_target_max: 300, n_collected: 90,
    })])
    const c = finalCell('Ranged in field survey')
    expect(c).toContain('so far')
    expect(c).not.toContain('not final')
  })
})

describe('SalesPipeline: a column choice saved when Collected existed', () => {
  // The whole point of the migration. A reader who had deliberately set this
  // table up to show a response count still has one; dropping the retired id
  // would leave them with a survey list and no responses on it.
  it('replaces Collected with Final', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(['client', 'collected']))
    show()
    expect(headers()).toEqual(['Study', 'Client', 'Final'])
  })

  it('never leaves the table without its response count, even when Collected was the only tick', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(['collected']))
    show()
    expect(headers()).toEqual(['Study', 'Final'])
  })

  it('adds Final once when a choice named both, in the order the table renders', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(['final', 'collected', 'client']))
    show()
    expect(headers()).toEqual(['Study', 'Client', 'Final'])
  })

  // Deliberate, and pinned so nobody "helpfully" adds it: Target answers a
  // different question (what the client bought) and was never what Collected
  // meant. Inventing a tick the reader never made is not a migration — Target
  // is in the DEFAULT columns instead, which the first test checks.
  it('does not force Target on', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(['client', 'collected']))
    show()
    expect(headers()).not.toContain('Target')
  })

  it('writes the retired id away on the first save, and reads back the same table', async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(['client', 'collected']))
    show()
    await openPicker()
    await userEvent.setup().click(screen.getByRole('checkbox', { name: /^Credits/ }))

    const saved = JSON.parse(localStorage.getItem(STORE_KEY) as string)
    expect(saved).toEqual(['client', 'final', 'credits'])
    expect(saved).not.toContain('collected')

    // Idempotent: the stored value now holds no retired id, so a second pass
    // through the migration changes nothing.
    cleanup()
    show()
    expect(headers()).toEqual(['Study', 'Client', 'Final', 'Credits'])
  })

  // A private window, or blocked site data: the read throws outright rather
  // than returning null. The table still has to render.
  it('falls back to the default columns when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    show()
    expect(headers()).toContain('Target')
    expect(headers()).toContain('Final')
    expect(headers()).not.toContain('Collected')
  })

  it('falls back to the default columns when the stored value is not a list of ids', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ cols: ['client'] }))
    show()
    expect(headers()).toContain('Final')
    expect(headers()).not.toContain('Collected')
  })
})

/**
 * ?s=collected is in bookmarks, in pasted links and in every saved view
 * captured before today — applyView writes its stored sortBy straight back into
 * the URL. An unrecognised id falls through to COLS[0], so without the
 * substitution the list silently re-sorts itself by Client and nothing on
 * screen says why.
 */
describe('SalesPipeline: a sort saved when Collected existed', () => {
  it('sorts by Final, and marks Final as the sorted column', () => {
    qs = 'g=all&s=collected'
    show()
    expect(sortedHeader()).toBe('Final')
    // By the response figure ascending — 0, 7, 260, 404. Sorted by Client it
    // would be Alpha, Bravo, Charlie, Delta; by the default Deliver date,
    // Delta, Charlie, Bravo, Alpha.
    expect(order()).toEqual([
      'Unrecorded survey', 'In field survey', 'Delivered survey', 'Quality review survey',
    ])
  })

  it('keeps the direction the link carried', () => {
    qs = 'g=all&s=collected&d=desc'
    show()
    expect(order()).toEqual([
      'Quality review survey', 'Delivered survey', 'In field survey', 'Unrecorded survey',
    ])
  })

  it('leaves a current ?s=final alone', () => {
    qs = 'g=all&s=final'
    show()
    expect(sortedHeader()).toBe('Final')
  })
})
