import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Ledger } from './Ledger'
import { clientStage, ledgerTotals, n0, todayET, type StatementRow } from '@/lib/sales/statement'
import { PRINT_COLUMNS, type PrintColumnId } from '@/lib/sales/printColumns'
import {
  FIXTURE_CLIENT, FIXTURE_NEVER_RECORDED, FIXTURE_NOW, FIXTURE_ROWS,
} from '@/lib/sales/statement.fixture'

/**
 * The survey table under every choice of columns (David, 2026-09-27). What
 * must hold whatever is ticked: every row spans exactly the columns the table
 * declares, so no subset can push past the page or leave a hole; the
 * "Responses" spanner covers only the response columns that print; and a total
 * never sits under a column that is not there.
 */
const TODAY = todayET(FIXTURE_NOW)
const never = new Set(FIXTURE_NEVER_RECORDED)
const rows = FIXTURE_ROWS.map(p => ({ ...p, client_id: FIXTURE_CLIENT.id })) as StatementRow[]
const ALL = PRINT_COLUMNS.map(c => c.id)
const HEAD: Partial<Record<PrintColumnId, string>> = { target: 'Target', final: 'Final', collected: 'Collected' }

function render(columns: PrintColumnId[], { grouped = true, accountCol = false } = {}) {
  const html = renderToStaticMarkup(
    <Ledger
      rows={rows}
      grouped={grouped}
      accountCol={accountCol}
      accountNameById={{ [FIXTURE_CLIENT.id]: FIXTURE_CLIENT.name }}
      today={TODAY}
      currentTermId="term-2026"
      neverRecorded={never}
      totalLabel={(n, credits) => `Total${credits ? ' credits drawn' : ''} · ${n} listed`}
      fn={{ unpriced: 1, final: 2 }}
      columns={columns}
    />,
  )
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
  const table = doc.querySelector('table.st-ledger') as HTMLTableElement
  const span = (c: Element) => Number(c.getAttribute('colspan') ?? 1)
  const text = (c: Element) => (c.textContent ?? '').trim()
  const headRows = [...table.querySelectorAll('thead tr')]
  return {
    html,
    table,
    cols: table.querySelectorAll('colgroup col').length,
    head1: [...headRows[0].querySelectorAll('th')].map(text),
    head2: headRows[1] ? [...headRows[1].querySelectorAll('th')].map(text) : null,
    headRows: headRows.length,
    spanner: table.querySelector('th.st-span'),
    /** Columns each head row covers, counting a rowspan-2 cell in both. */
    headWidths: headRows.map((tr, i) => {
      const own = [...tr.querySelectorAll('th')].reduce((t, c) => t + span(c), 0)
      const fromAbove = i === 1 ? [...headRows[0].querySelectorAll('th')].filter(c => c.getAttribute('rowspan') === '2').length : 0
      return own + fromAbove
    }),
    bodyWidths: [...table.querySelectorAll('tbody tr')].map(tr => [...tr.children].reduce((t, c) => t + span(c), 0)),
    sub: (label: string) => [...table.querySelectorAll('tr.st-sub')].find(tr => text(tr.children[0]).startsWith(label)),
    subs: table.querySelectorAll('tr.st-sub').length,
    total: table.querySelector('tr.st-total'),
    text,
  }
}

const delivered = rows.filter(p => clientStage(p).group === 'delivered')
const inProgress = rows.filter(p => clientStage(p).group === 'progress')
/** In progress and delivered: the fixture has nothing paused or stopped. */
const GROUPS = new Set(rows.map(p => clientStage(p).group)).size

describe('the ledger, all columns (the system default)', () => {
  const t = render(ALL)

  it('prints every column under a three-column Responses spanner', () => {
    expect(t.cols).toBe(8)
    expect(t.head1).toEqual(['Ref.', 'Survey and audience', 'Requested by', 'Status', 'Responses', 'Credits'])
    expect(t.head2).toEqual(['Target', 'Final', 'Collected'])
    expect(t.spanner?.getAttribute('colspan')).toBe('3')
    expect(t.headWidths).toEqual([8, 8])
    expect(new Set(t.bodyWidths)).toEqual(new Set([8]))
  })

  it('totals Target and Final by group, and credits', () => {
    const d = ledgerTotals(delivered)
    const row = t.sub('Total delivered') as Element
    const cells = [...row.children].map(t.text)
    // Label, Target, Final, Collected (never totalled), Credits.
    expect(cells.slice(1, 4)).toEqual([n0(d.target), n0(d.final), ''])
    expect(cells[0]).toContain('Target and Final: the 10 surveys with both.')
    expect(t.text(t.total as Element)).toContain('Total credits drawn')
  })
})

describe('the ledger, every optional column off', () => {
  const t = render([])

  it('is the reference and the survey, in one header row, with no spanner', () => {
    expect(t.cols).toBe(2)
    expect(t.headRows).toBe(1)
    expect(t.head1).toEqual(['Ref.', 'Survey and audience'])
    expect(t.spanner).toBeNull()
    expect(new Set(t.bodyWidths)).toEqual(new Set([2]))
  })

  it('prints no subtotal or total row, since none would hold a figure', () => {
    expect(t.subs).toBe(0)
    expect(t.total).toBeNull()
    expect(t.html).not.toContain('Total credits drawn')
    // Still every survey, still grouped.
    expect(t.table.querySelectorAll('td.st-ref').length).toBe(rows.length)
    expect(t.table.querySelectorAll('tr.st-grp').length).toBe(GROUPS)
  })
})

describe('the ledger, Target off', () => {
  const t = render(ALL.filter(id => id !== 'target'))

  it('narrows the spanner to Final and Collected', () => {
    expect(t.cols).toBe(7)
    expect(t.spanner?.getAttribute('colspan')).toBe('2')
    expect(t.head2).toEqual(['Final', 'Collected'])
    expect(t.headWidths).toEqual([7, 7])
    expect(new Set(t.bodyWidths)).toEqual(new Set([7]))
  })

  it('has no Target subtotal, and says what the Final total is over', () => {
    const d = ledgerTotals(delivered)
    const cells = [...(t.sub('Total delivered') as Element).children].map(t.text)
    // Label, Final, Collected, Credits: no cell holds the target total.
    expect(cells).toHaveLength(4)
    expect(cells[1]).toBe(n0(d.final))
    expect(cells).not.toContain(n0(d.target))
    expect(cells[0]).toContain('Final: the 10 surveys with both a target and a final count.')
    expect(cells[0]).not.toContain('Target and Final')
    const progress = [...(t.sub('Total in progress') as Element).children].map(t.text)
    expect(progress).toHaveLength(4)
    expect(progress).not.toContain(n0(ledgerTotals(inProgress).targetAll))
  })

  it('prints no Target cell on any row', () => {
    for (const tr of t.table.querySelectorAll('tbody tr:not(.st-grp):not(.st-sub):not(.st-total)')) {
      expect(tr.children).toHaveLength(7)
    }
  })
})

describe('the ledger, one response column', () => {
  // Measured in headless Chrome at print width: "Responses" needs 54px and the
  // response columns are 45–51px, so a spanner over one of them pushed the
  // table 3–9px past the paper. It now prints the column's own header instead.
  for (const only of ['target', 'final', 'collected'] as PrintColumnId[]) {
    it(`prints ${HEAD[only]} in one header row, with no spanner`, () => {
      const t = render(ALL.filter(id => !['target', 'final', 'collected'].includes(id) || id === only))
      expect(t.spanner).toBeNull()
      expect(t.headRows).toBe(1)
      expect(t.head2).toBeNull()
      expect(t.head1).toContain(HEAD[only])
      expect(t.html).not.toContain('Responses')
      expect(t.headWidths).toEqual([t.cols])
      expect(new Set(t.bodyWidths)).toEqual(new Set([t.cols]))
    })
  }
})

describe('the ledger, Credits off', () => {
  const t = render(ALL.filter(id => id !== 'credits'))

  it('prints no credit figure and no total that promises one', () => {
    expect(t.head1).not.toContain('Credits')
    expect(t.html).not.toContain('Not yet priced')
    expect(t.html).not.toContain('committed')
    expect(t.html).not.toContain('Total credits drawn')
    expect(t.html).not.toContain('Credits:')
    // Grouped: the subtotals still carry Target and Final.
    expect(t.subs).toBe(GROUPS)
  })
})

describe('the ledger, every subset of columns', () => {
  // 2^7 subsets, on the grouped statement and the ungrouped internal list.
  const subsets: PrintColumnId[][] = []
  for (let m = 0; m < 1 << ALL.length; m++) subsets.push(ALL.filter((_, i) => m & (1 << i)))

  it('always spans exactly its declared columns, with the spanner over only the response columns that print', () => {
    for (const cols of subsets) {
      for (const mode of [{ grouped: true, accountCol: false }, { grouped: false, accountCol: true }]) {
        const t = render(cols, mode)
        const shown = cols.filter(id => id !== 'account' || mode.accountCol)
        const responses = shown.filter(id => id === 'target' || id === 'final' || id === 'collected')
        const where = `${mode.grouped ? 'statement' : 'list'} [${cols.join(',')}]`
        expect(t.cols, where).toBe(2 + shown.length)
        expect(t.headWidths.every(w => w === t.cols), where).toBe(true)
        expect(t.bodyWidths.every(w => w === t.cols), where).toBe(true)
        // The spanner groups, so it appears only with two or more to group;
        // over one it would be wider than the column it labels.
        expect(t.headRows, where).toBe(responses.length > 1 ? 2 : 1)
        expect(t.spanner ? Number(t.spanner.getAttribute('colspan')) : 0, where).toBe(responses.length > 1 ? responses.length : 0)
        for (const id of responses) expect(t.head1.concat(t.head2 ?? []), where).toContain(HEAD[id])
        if (!shown.includes('credits')) expect(t.html, where).not.toContain('credits drawn')
        if (!shown.includes('target') && !shown.includes('final')) expect(t.html, where).not.toContain('surveys with both')
      }
    }
  }, 120_000)
})
