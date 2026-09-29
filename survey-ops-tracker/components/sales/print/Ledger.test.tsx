import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Ledger } from './Ledger'
import { clientStage, ledgerTotals, n0, todayET, type StatementRow } from '@/lib/sales/statement'
import {
  PRINT_COLUMNS, SYSTEM_DEFAULT, ledgerColumns, parseStoredChoice, parseUrlChoice,
  printsOf, resolveChoice, type PrintColumnId,
} from '@/lib/sales/printColumns'
import {
  FIXTURE_CLIENT, FIXTURE_NEVER_RECORDED, FIXTURE_NOW, FIXTURE_ROWS,
} from '@/lib/sales/statement.fixture'

/**
 * The survey table under every choice of columns (David, 2026-09-27). What
 * must hold whatever is ticked: every row spans exactly the columns the table
 * declares, so no subset can push past the page or leave a hole; the
 * "Responses" spanner covers only the response columns that print; and a total
 * never sits under a column that is not there.
 *
 * ── 2026-09-29: COLLECTED IS GONE, NOT OFF ─────────────────────────────────
 * This file used to drive a third response column. David: "lets actually
 * remove 'collected' from all views from now … a client doesnt need to know
 * that and i dont want to risk a sales person sending it." It had been merely
 * off by default since 2026-09-28; it is now deleted from PRINT_COLUMNS, so
 * there is no tick, no `cols=` token and no saved preference that can produce
 * it.
 *
 * Every assertion below that DESCRIBED the column has been inverted rather
 * than dropped, because each was protecting a real shape and the new shape
 * still needs protecting: the spanner that once covered three columns now
 * covers two, the subtotal that once carried an always-empty filler cell now
 * carries none, and the header row that once had a third word now has two.
 * The last describe block is new and is the point of the change: it proves the
 * column cannot come back by any route that reaches this component — the
 * system default, a saved default, a current `cols=` link, a retired `cols=`
 * link that literally says the word, or the prop itself.
 */
const TODAY = todayET(FIXTURE_NOW)
const never = new Set(FIXTURE_NEVER_RECORDED)
const rows = FIXTURE_ROWS.map(p => ({ ...p, client_id: FIXTURE_CLIENT.id })) as StatementRow[]
const ALL = PRINT_COLUMNS.map(c => c.id)
const HEAD: Partial<Record<PrintColumnId, string>> = { target: 'Target', final: 'Final' }
/** The columns that sit under the "Responses" spanner. Two, since 2026-09-29. */
const RESPONSES: PrintColumnId[] = ['target', 'final']

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

  // WAS "three-column Responses spanner" with head2 ['Target','Final',
  // 'Collected'] and eight colgroup cols. Inverted on 2026-09-29: the third
  // response column was removed, so the spanner covers two and the table is
  // one column narrower. The invariant this protects is unchanged — the
  // spanner's colspan equals the number of response columns that print, and
  // the header rows and the body agree on the width.
  it('prints every column under a two-column Responses spanner', () => {
    expect(t.cols).toBe(7)
    expect(t.head1).toEqual(['Ref.', 'Study and audience', 'Requested by', 'Status', 'Responses', 'Credits'])
    expect(t.head2).toEqual(['Target', 'Final'])
    expect(t.spanner?.getAttribute('colspan')).toBe('2')
    expect(t.headWidths).toEqual([7, 7])
    expect(new Set(t.bodyWidths)).toEqual(new Set([7]))
  })

  it('totals Target and Final by group, and credits', () => {
    const d = ledgerTotals(delivered)
    const row = t.sub('Total delivered') as Element
    const cells = [...row.children].map(t.text)
    // Label, Target, Final, Credits — FOUR cells, not five.
    //
    // WAS: cells.slice(1, 4) === [target, final, ''] — the empty string was the
    // Collected cell, which was a numeric column that was never totalled and so
    // always printed blank. On 2026-09-29 the column went, and with it the only
    // figure cell on the page that was structurally guaranteed to be empty. The
    // assertion is inverted to say exactly that: no subtotal cell is blank any
    // more, so a blank one in future means a total went missing rather than a
    // filler column being filler.
    expect(cells).toHaveLength(4)
    expect(cells.slice(1, 3)).toEqual([n0(d.target), n0(d.final)])
    expect(cells).not.toContain('')
    expect(cells[0]).toContain('Target and Final: the 10 studies with both.')
    expect(t.text(t.total as Element)).toContain('Total credits drawn')
  })
})

describe('the ledger, every optional column off', () => {
  const t = render([])

  it('is the reference and the study, in one header row, with no spanner', () => {
    expect(t.cols).toBe(2)
    expect(t.headRows).toBe(1)
    expect(t.head1).toEqual(['Ref.', 'Study and audience'])
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

  // WAS "narrows the spanner to Final and Collected", colspan 2, head2
  // ['Final','Collected']. INVERTED 2026-09-29: with Collected gone, turning
  // Target off leaves ONE response column, and one is not a group — the spanner
  // disappears and takes the second header row with it. This is now the same
  // rule the "one response column" block below states, reached from the other
  // direction (by unticking rather than by ticking), which is worth keeping:
  // Target is the only tick a salesperson can use to get here.
  it('drops the spanner entirely, leaving Final to carry its own header', () => {
    expect(t.cols).toBe(6)
    expect(t.spanner).toBeNull()
    expect(t.headRows).toBe(1)
    expect(t.head2).toBeNull()
    expect(t.head1).toEqual(['Ref.', 'Study and audience', 'Requested by', 'Status', 'Final', 'Credits'])
    expect(t.html).not.toContain('Responses')
    expect(t.headWidths).toEqual([6])
    expect(new Set(t.bodyWidths)).toEqual(new Set([6]))
  })

  it('has no Target subtotal, and says what the Final total is over', () => {
    const d = ledgerTotals(delivered)
    const cells = [...(t.sub('Total delivered') as Element).children].map(t.text)
    // Label, Final, Credits: no cell holds the target total. WAS four cells —
    // the fourth was the Collected filler (2026-09-29).
    expect(cells).toHaveLength(3)
    expect(cells[1]).toBe(n0(d.final))
    expect(cells).not.toContain(n0(d.target))
    expect(cells[0]).toContain('Final: the 10 studies with both a target and a final count.')
    expect(cells[0]).not.toContain('Target and Final')
    const progress = [...(t.sub('Total in progress') as Element).children].map(t.text)
    expect(progress).toHaveLength(3)
    expect(progress).not.toContain(n0(ledgerTotals(inProgress).targetAll))
  })

  it('prints no Target cell on any row', () => {
    for (const tr of t.table.querySelectorAll('tbody tr:not(.st-grp):not(.st-sub):not(.st-total)')) {
      expect(tr.children).toHaveLength(6)
    }
  })
})

describe('the ledger, one response column', () => {
  // Measured in headless Chrome at print width: "Responses" needs 54px and the
  // response columns are 45–51px, so a spanner over one of them pushed the
  // table 3–9px past the paper. It now prints the column's own header instead.
  //
  // The loop used to run over target | final | collected. It runs over the two
  // that remain (2026-09-29); the third case is not lost coverage, because
  // there is no third response column to be alone with.
  for (const only of RESPONSES) {
    it(`prints ${HEAD[only]} in one header row, with no spanner`, () => {
      const t = render(ALL.filter(id => !RESPONSES.includes(id) || id === only))
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
  // 2^6 subsets, on the grouped statement and the ungrouped internal list.
  // (Was 2^7 until the Collected column was removed on 2026-09-29.)
  const subsets: PrintColumnId[][] = []
  for (let m = 0; m < 1 << ALL.length; m++) subsets.push(ALL.filter((_, i) => m & (1 << i)))

  it('always spans exactly its declared columns, with the spanner over only the response columns that print', () => {
    for (const cols of subsets) {
      for (const mode of [{ grouped: true, accountCol: false }, { grouped: false, accountCol: true }]) {
        const t = render(cols, mode)
        const shown = cols.filter(id => id !== 'account' || mode.accountCol)
        const responses = shown.filter(id => RESPONSES.includes(id))
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
        if (!shown.includes('target') && !shown.includes('final')) expect(t.html, where).not.toContain('studies with both')
        // 2026-09-29: not one of the 128 documents this loop renders says the
        // word, whatever is ticked. This is the cheapest place to catch the
        // column growing back, because it covers every combination there is.
        expect(t.html, where).not.toMatch(/collected/i)
      }
    }
  }, 120_000)
})

/**
 * ── THE COLUMN CANNOT COME BACK (2026-09-29) ───────────────────────────────
 *
 * The point of the removal was not "off by default". David asked for the risk
 * to be gone: "i dont want to risk a sales person sending it". Off-by-default
 * leaves a tick; a tick can be ticked, by a hurried salesperson or by a link
 * somebody forwards. So these tests do not check that Collected is off. They
 * walk every route by which a column reaches this component and show that none
 * of them can produce it — and, where a document is rendered, that the word
 * "Collected" is not on the page at all.
 *
 * The routes, in the order printColumns.ts resolves them: the link, then the
 * saved default, then the system default; plus the `columns` prop itself,
 * which is what every one of them finally becomes.
 */
describe('Collected cannot come back', () => {
  const DOC = 'statement' as const
  /** The prop the page computes from a choice — the whole pipeline, not a guess. */
  const columnsFrom = (cols: string | null, stored: string | null) =>
    ledgerColumns(printsOf(resolveChoice(parseUrlChoice(DOC, cols, null), parseStoredChoice(stored, DOC)), DOC))

  it('is not a column anybody can be offered', () => {
    // The definition list is the source of every tick, every `cols=` token this
    // module will honour, and ALL_COLUMNS inside Ledger itself. Nothing names
    // it, so there is nothing to turn on.
    expect(PRINT_COLUMNS.map(c => c.id)).not.toContain('collected')
    expect(ALL).toEqual(['account', 'requested', 'status', 'target', 'final', 'credits'])
    // WAS: SYSTEM_DEFAULT.colsOff === ['collected'] — the one-day state where
    // the column existed and was defaulted off. It is empty again because
    // everything that exists now prints, which is what makes the deletion
    // total rather than a default somebody can argue with.
    expect(SYSTEM_DEFAULT.colsOff).toEqual([])
  })

  it('prints nothing named Collected when nobody has chosen anything', () => {
    const t = render(columnsFrom(null, null))
    expect(columnsFrom(null, null)).toEqual(['requested', 'status', 'target', 'final', 'credits'])
    expect(t.head1.concat(t.head2 ?? [])).not.toContain('Collected')
    expect(t.html).not.toMatch(/collected/i)
    // The system default is still a full document: this is not passing because
    // the table came out empty.
    expect(t.cols).toBe(7)
    expect(t.table.querySelectorAll('td.st-ref').length).toBe(rows.length)
  })

  it('ignores a saved default that names Collected, and one that omits it', () => {
    // A stored choice is a list of what is OFF, so the dangerous v2 value is
    // the one that does NOT mention Collected — under the old model that meant
    // "print it". Both shapes now resolve to the same document.
    const naming = columnsFrom(null, JSON.stringify({ colsOff: ['collected'], sectionsOff: [] }))
    const silent = columnsFrom(null, JSON.stringify({ colsOff: [], sectionsOff: [] }))
    expect(naming).toEqual(silent)
    expect(naming).not.toContain('collected')
    for (const c of [naming, silent]) expect(render(c).html).not.toMatch(/collected/i)
  })

  it('ignores a current link that names Collected, in either direction', () => {
    // "-collected" (turn it off) and a list that leaves it out (leave it on)
    // are the same document, because there is nothing for either to act on.
    const off = columnsFrom('-collected', null)
    const on = columnsFrom('-requested', null)
    expect(off).toEqual(['requested', 'status', 'target', 'final', 'credits'])
    expect(on).not.toContain('collected')
    for (const c of [off, on]) expect(render(c).html).not.toMatch(/collected/i)
  })

  it('maps a retired link that literally says "collected" onto Final', () => {
    // The retired `cols=` values listed what was ON, and the old single
    // "Collected" column showed the FINAL count once a survey was delivered.
    // The token therefore still has to be honoured — as Final — or a bookmarked
    // export loses the column it was printing. Honouring the literal word would
    // be the one route that puts the removed column back, so this test pins
    // both halves: Final prints, Collected does not exist.
    const cols = columnsFrom('collected', null)
    expect(cols).toEqual(['status', 'final'])
    const t = render(cols)
    expect(t.head1).toContain('Final')
    expect(t.head1).not.toContain('Collected')
    expect(t.spanner).toBeNull()
    expect(t.html).not.toMatch(/collected/i)
    // And the same token alongside Target still gives two response columns and
    // a spanner — Final, not a third column.
    const pair = columnsFrom('collected,target', null)
    expect(pair).toEqual(['status', 'target', 'final'])
    expect(render(pair).head2).toEqual(['Target', 'Final'])
  })

  it('drops the id even when it is forced straight into the component', () => {
    // The last line of defence: Ledger filters `columns` through its own
    // ALL_COLUMNS, so an id from a stale caller, a hand-written test or a
    // future regression in the choice pipeline cannot reach the table.
    const forced = render(['collected'] as unknown as PrintColumnId[])
    expect(forced.cols).toBe(2)
    expect(forced.headRows).toBe(1)
    expect(forced.head1).toEqual(['Ref.', 'Study and audience'])
    expect(forced.html).not.toMatch(/collected/i)
    // Smuggled in beside the real columns, it changes nothing at all.
    const smuggled = render([...ALL, 'collected'] as unknown as PrintColumnId[])
    expect(smuggled.html).toBe(render(ALL).html)
  })
})
