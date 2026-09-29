import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { renderToStaticMarkup } from 'react-dom/server'
import { AccountPrint } from '../AccountPrint'
import { SurveyListPrint, type ListRow } from '../SurveyListPrint'
import { filterByRange, rangeFor } from '@/lib/sales/dateRange'
import { todayET, type StatementRow } from '@/lib/sales/statement'
import {
  parseStoredChoice, parseUrlChoice, PRINT_COLUMNS, PRINT_SECTIONS, PRINTS_ALL, resolveChoice, SYSTEM_DEFAULT,
  type PrintColumnId, type PrintSectionId, type UrlChoice,
} from '@/lib/sales/printColumns'
import { unexplainedMarks } from './Notes'
import {
  FIXTURE_CLIENT, FIXTURE_NEVER_RECORDED, FIXTURE_NOW, FIXTURE_ROWS, FIXTURE_TERMS,
} from '@/lib/sales/statement.fixture'

// next/font is a compile-time transform that vitest does not run. The class
// names and the family string are all the documents read from it.
vi.mock('./fonts', () => ({
  serif: { variable: 'font-st-serif', style: { fontFamily: '"Source Serif 4"' } },
  sans: { variable: 'font-st-sans', style: { fontFamily: '"Source Sans 3"' } },
}))

/**
 * The two client documents, rendered from the anonymised fixture account.
 *
 * These are the properties that must hold on the PAPER, whatever the parts do
 * individually: no dollar figure reaches a sales document, no internal tool
 * name prints, the margin-box strings survive React unescaped, and the figures
 * the statement is built around are on the page.
 *
 * With STATEMENT_RENDER_DIR set, it also writes each document as a standalone
 * HTML page there, so it can be printed in headless Chrome and looked at.
 */
const TODAY = todayET(FIXTURE_NOW)
const CONTACT = { name: 'Account Manager', email: 'account.manager@example.com' }
const OUT = process.env.STATEMENT_RENDER_DIR

function statement(opts: { displayName?: string | null; printChoice?: UrlChoice } = {}) {
  return renderToStaticMarkup(
    <AccountPrint
      client={FIXTURE_CLIENT}
      displayName={opts.displayName === undefined ? 'The Fixture Group' : opts.displayName}
      contact={CONTACT}
      preparedBy="Account Manager"
      rows={FIXTURE_ROWS}
      allRows={FIXTURE_ROWS}
      undated={0}
      notDelivered={0}
      basis="delivered"
      range={{ from: null, to: null }}
      terms={FIXTURE_TERMS}
      today={TODAY}
      generatedAt={FIXTURE_NOW.toISOString()}
      neverRecordedIds={FIXTURE_NEVER_RECORDED}
      printChoice={opts.printChoice}
    />,
  )
}

function quarterList(mode: 'client' | 'internal', printChoice?: UrlChoice) {
  const range = rangeFor('qtd', TODAY)
  const delivered = FIXTURE_ROWS.filter(r => r.board_column === 'Delivery')
  const r = filterByRange(delivered, 'delivered', range)
  const rows = r.rows.map(p => ({ ...p, client_id: FIXTURE_CLIENT.id })) as ListRow[]
  return renderToStaticMarkup(
    <SurveyListPrint
      rows={rows}
      totalBeforeDates={delivered.length}
      undated={r.undated}
      notDelivered={r.notDelivered}
      basis="delivered"
      range={range}
      bucket="delivered"
      stages={[]}
      search=""
      mode={mode}
      account={mode === 'client' ? { id: FIXTURE_CLIENT.id, name: FIXTURE_CLIENT.name, displayName: 'The Fixture Group', own: true } : null}
      selectedCount={mode === 'client' ? 1 : 0}
      selectedNames={[]}
      accountNameById={{ [FIXTURE_CLIENT.id]: FIXTURE_CLIENT.name }}
      bookOwner="Account Manager"
      contact={mode === 'client' ? CONTACT : null}
      terms={mode === 'client' ? FIXTURE_TERMS : []}
      preparedBy="Account Manager"
      today={TODAY}
      generatedAt={FIXTURE_NOW.toISOString()}
      neverRecordedIds={FIXTURE_NEVER_RECORDED}
      printChoice={printChoice}
    />,
  )
}

/** An Active list where the only surveys that have drawn are unpriced — BofA's
 *  shape on 2026-09-27: two in field with no price, one priced in design. */
function unpricedActiveList() {
  const pick = (code: string) => FIXTURE_ROWS.find(r => r.project_code === code)!
  const rows = [
    { ...pick('PR00466'), credits: null },
    { ...pick('PR00257'), credits: null, n_actual: null },
    { ...pick('PR00479'), credits: 100 },
  ].map(p => ({ ...p, client_id: FIXTURE_CLIENT.id })) as ListRow[]
  return renderToStaticMarkup(
    <SurveyListPrint
      rows={rows}
      totalBeforeDates={rows.length}
      undated={0}
      notDelivered={0}
      basis="delivered"
      range={{ from: null, to: null }}
      bucket="active"
      stages={[]}
      search=""
      mode="client"
      account={{ id: FIXTURE_CLIENT.id, name: FIXTURE_CLIENT.name, displayName: 'The Fixture Group', own: true }}
      selectedCount={1}
      selectedNames={[]}
      accountNameById={{ [FIXTURE_CLIENT.id]: FIXTURE_CLIENT.name }}
      bookOwner="Account Manager"
      contact={CONTACT}
      terms={FIXTURE_TERMS}
      preparedBy="Account Manager"
      today={TODAY}
      generatedAt={FIXTURE_NOW.toISOString()}
      neverRecordedIds={[]}
    />,
  )
}

/** A standalone page around the markup, shaped like the sales shell, for Chrome. */
function page(title: string, body: string, appCss: string): string {
  const logo = 'file:///' + path.resolve(__dirname, '../../../public/alpharoc-logo-navy.png').replace(/\\/g, '/')
  return `<!doctype html><html lang="en" class="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=block" rel="stylesheet">
<style>${appCss}</style></head>
<body class="min-h-full flex flex-col bg-background"><div class="min-h-screen bg-background text-foreground">
<nav data-print="hide" class="sticky top-0 z-40 border-b border-border bg-card/95"><div class="mx-auto flex max-w-6xl items-center gap-1 px-6 py-2 text-sm font-bold">AlphaROC (app nav, hidden in print)</div></nav>
<main class="mx-auto max-w-6xl p-6">${body.split('/alpharoc-logo-navy.png').join(logo)}</main></div></body></html>`
}

describe('the printed documents', () => {
  const docs = { statement: statement(), list: quarterList('client'), internal: quarterList('internal') }

  it('never carries a dollar figure', () => {
    for (const html of Object.values(docs)) expect(html).not.toMatch(/\$\s?\d/)
  })

  it('never prints an internal tool or stage name', () => {
    for (const html of Object.values(docs)) {
      expect(html).not.toMatch(/EdWin|Doc Programming|Survey Programming|Data QA|Fielding</)
    }
  })

  it('writes the page-footer strings unescaped, so Chrome can read them', () => {
    expect(docs.statement).toContain('content:"AlphaROC  ·  Confidential  ·  Prepared for The Fixture Group"')
    expect(docs.statement).not.toContain('content:&quot;')
    expect(docs.internal).toContain('content:"AlphaROC  ·  Internal  ·  covers 1 account, not for sending to a client"')
  })

  it('prints the statement figures', () => {
    const h = docs.statement
    expect(h).toContain('The Fixture Group')
    expect(h).toContain('Survey Activity Statement')
    expect(h).toContain('>at least</span>410')
    expect(h).toContain('(35)')
    expect(h).toContain('At least 35 credits beyond the allowance.')
    expect(h).toContain('Renews 29 Mar 2027 · day 179 of 364')
    expect(h).toContain('>928<')
    expect(h).toContain('was due 23')
    expect(h).toContain('not recorded')
    expect(h).toContain('Not yet priced')
    // Final column is only for delivered work: the mid-field count of 7 must
    // not print as a final.
    expect(h).not.toMatch(/st-final[^>]*>7</)
  })

  it('prints the list as one account, and internal mode without "Prepared for"', () => {
    expect(docs.list).toContain('Prepared for')
    expect(docs.list).toContain('>at least</span>316')
    expect(docs.internal).not.toContain('>Prepared for<')
    expect(docs.internal).toContain('Internal · covers 1 account · not for sending to a client')
    expect(docs.internal).toContain('>Account</th>')
  })

  it('never prints "at least 0": a list whose only drawn surveys are unpriced says "Not yet priced"', () => {
    const h = unpricedActiveList()
    // The strip headline, the ledger total, the strip caption and note 1.
    expect(h).not.toMatch(/at least<\/span>0\b/)
    expect(h).not.toMatch(/at least 0\b/i)
    expect(h).toContain('>Not yet priced<')
    expect(h).toContain('The credits drawn by the surveys listed below are not known yet:')
    expect(h).toContain('so the credits drawn by this list are not known yet.')
    expect(h).toContain('Not known yet: 2')
  })

  it('reads the notes across then down, and keeps the last row with the sign-off', () => {
    const h = docs.statement
    // Notes 1–2 in the first list, 3–4 with the sign-off in one unbreakable block.
    const end = h.slice(h.indexOf('class="st-notes-end"'))
    expect(end).toMatch(/^class="st-notes-end"><ol start="3"><li><i>3<\/i>/)
    expect(end.indexOf('st-sign')).toBeGreaterThan(end.indexOf('<i>4</i>'))
    expect(h).not.toContain('grid-template-rows')
  })

  it('falls back to the internal name, and asks for the real one, when none is saved', () => {
    const h = statement({ displayName: null })
    expect(h).toContain('content:"AlphaROC  ·  Confidential  ·  Prepared for Fixture Capital"')
    expect(h).toContain('No client-facing name is saved')
  })

  it.runIf(!!OUT)('writes the documents for the print check', () => {
    const dir = OUT as string
    fs.mkdirSync(dir, { recursive: true })
    const cssFile = process.env.STATEMENT_APP_CSS
    const appCss = cssFile && fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8') : ''
    const ST = 'The Fixture Group - Survey Activity Statement - 2026-09-24'
    const LI = 'The Fixture Group - Survey List - 2026-09-24'
    const IN = 'Survey List - Internal - 2026-09-24'
    fs.writeFileSync(path.join(dir, 'statement.html'), page(ST, docs.statement, appCss))
    fs.writeFileSync(path.join(dir, 'list.html'), page(LI, docs.list, appCss))
    fs.writeFileSync(path.join(dir, 'list-internal.html'), page(IN, docs.internal, appCss))
    // A reduced choice of each, to look at.
    fs.writeFileSync(path.join(dir, 'statement-reduced.html'), page(ST, statement({ printChoice: REDUCED.statement }), appCss))
    fs.writeFileSync(path.join(dir, 'list-reduced.html'), page(LI, quarterList('client', REDUCED.list), appCss))
    fs.writeFileSync(path.join(dir, 'list-internal-reduced.html'), page(IN, quarterList('internal', REDUCED.internal), appCss))
    expect(fs.existsSync(path.join(dir, 'statement.html'))).toBe(true)

    // STATEMENT_SUBSETS: every column subset (all sections on), every section
    // subset (all columns on) and the bare minimum, for the page-width and
    // page-break sweep in headless Chrome.
    if (process.env.STATEMENT_SUBSETS) {
      const sub = path.join(dir, 'subsets')
      fs.mkdirSync(sub, { recursive: true })
      const subsets = <T,>(xs: T[]) => Array.from({ length: 1 << xs.length }, (_, m) => xs.filter((_, i) => m & (1 << i)))
      const colIds = (doc: 'statement' | 'list') => PRINT_COLUMNS.filter(c => c.docs.includes(doc)).map(c => c.id)
      const secIds = (doc: 'statement' | 'list') => PRINT_SECTIONS.filter(c => c.docs.includes(doc)).map(c => c.id)
      const name = (off: string[]) => off.length ? off.join('.') : 'all'
      const write = (file: string, html: string, title: string) => fs.writeFileSync(path.join(sub, file), page(title, html, appCss))
      for (const off of subsets(colIds('statement'))) {
        write(`st-c-${name(off)}.html`, statement({ printChoice: { colsOff: off } }), ST)
      }
      for (const off of subsets(secIds('statement'))) {
        write(`st-s-${name(off)}.html`, statement({ printChoice: { sectionsOff: off } }), ST)
      }
      for (const off of subsets(colIds('list'))) {
        write(`li-c-${name(off)}.html`, quarterList('internal', { colsOff: off }), IN)
        if (!off.includes('account')) write(`lc-c-${name(off)}.html`, quarterList('client', { colsOff: off }), LI)
      }
      for (const off of subsets(secIds('list'))) {
        write(`lc-s-${name(off)}.html`, quarterList('client', { sectionsOff: off }), LI)
      }
      write('st-none.html', statement({ printChoice: { colsOff: colIds('statement'), sectionsOff: secIds('statement') } }), ST)
      write('li-none.html', quarterList('internal', { colsOff: colIds('list'), sectionsOff: secIds('list') }), IN)
    }
  }, 300_000)
})

/** The reduced choices rendered for the print check.
 *
 *  Each of these listed 'collected' until 2026-09-29, when the column was
 *  removed outright. They are not shorter by accident: the point of rendering
 *  them is to look at a REDUCED page in Chrome, so each one still turns off
 *  enough to change the table's shape (the statement keeps both response
 *  columns and its spanner, the internal list keeps one and loses it). */
const REDUCED: Record<'statement' | 'list' | 'internal', UrlChoice> = {
  statement: { colsOff: ['requested'], sectionsOff: ['activity'] },
  list: { colsOff: ['requested', 'target'], sectionsOff: ['notes'] },
  internal: { colsOff: ['requested', 'final'], sectionsOff: ['activity'] },
}

describe('what prints (David, 2026-09-27)', () => {
  const all = statement()
  const noTarget = statement({ printChoice: { colsOff: ['target'] } })

  it('prints everything it has by default, and has nothing called Collected', () => {
    for (const h of [all, quarterList('client')]) {
      for (const head of ['Ref.', 'Survey and audience', 'Requested by', 'Status', 'Responses', 'Target', 'Final', 'Credits']) {
        expect(h).toContain(`>${head}</th>`)
      }
      // WAS: "Still tickable — see printColumns." On 2026-09-28 the column was
      // merely off by default, so this line protected a DEFAULT. David closed
      // that gap on 2026-09-29 — "lets actually remove 'collected' from all
      // views from now … i dont want to risk a sales person sending it" — so it
      // now protects an ABSENCE: no header on the paper, and no tick in the
      // panel above it either, which is why the check is the bare word.
      expect(h).not.toContain('>Collected</th>')
      expect(h).not.toContain('Collected')
    }
    expect(all).toContain('aria-label="Notes"')
    expect(all).toContain('>Contract summary')
    // WAS "… everything prints except Collected." The exception is gone with
    // the column: the sentence a salesperson reads has to match the page.
    expect(all).toContain('Using the system default: everything prints.')
    expect(quarterList('internal')).toContain('>Account</th>')
  })

  it('heads the note “The final count”, and does not define a column it is not printing', () => {
    expect(all).toContain('The final count.')
    expect(all).not.toContain('Final and collected.')
    // The sentence that sent the reader looking for a figure that is not there.
    expect(all).not.toContain('shows its collection so far')
  })

  // The cost of the choice, said on the last screen before the document goes
  // out. Every survey before quality review prints a dash in Final, so a
  // statement sent mid-engagement can carry nothing but targets.
  //
  // INVERTED 2026-09-29. This test used to check that the warning ENDED in an
  // offer — "Tick Collected to show what they have gathered in field so far" —
  // and that taking the offer silenced it. With the column removed there is no
  // tick to offer and no choice that fills those rows in, so what it protects
  // now is the opposite: the disclosure states the count and the dash, names no
  // action, and cannot be silenced by ticking anything. A note that names an
  // impossible fix is worse than a bare fact, because the reader hunts the
  // panel for a tick that is not there.
  it('tells the sender which surveys print no response figure, and offers no fix that does not exist', () => {
    // The COUNT is what makes this a warning rather than a caption, so match
    // the counted phrasing rather than the bare sentence.
    const warning = /(One survey|[0-9]+ surveys) prints? no response figure/
    expect(all).toMatch(warning)
    expect(all).toContain('They show a dash.')
    expect(all).not.toContain('Tick Collected')
    expect(all).toContain('Note, does not stop printing:')
    // Turning nothing off IS the system default, so the warning is the same one
    // — there is no longer a second response column for it to point at.
    expect(statement({ printChoice: { colsOff: [] } })).toMatch(warning)
    // The only thing that silences it is printing no response column at all,
    // which is choiceNotes' own condition: with Target and Final both off the
    // page states no responses, so there is nothing left to disclose.
    expect(statement({ printChoice: { colsOff: ['target', 'final'] } })).not.toMatch(warning)
  })

  it('warns when Final prints without Target, without adding an item to check', () => {
    expect(noTarget).toContain('Final prints without Target, so the client cannot check the final count against what they bought.')
    expect(noTarget).toContain('Note, does not stop printing:')
    expect(all).not.toContain('Final prints without Target')
    // The count that decides whether the dialog opens by itself is unchanged.
    const count = (h: string) => h.match(/because (\d+) items? needs? checking/)?.[1]
    expect(count(noTarget)).toBe(count(all))
    expect(count(all)).toBeDefined()
  })

  it('leaves out a column, its header and its total together', () => {
    expect(noTarget).not.toContain('>Target</th>')
    // WAS: /colspan="2" scope="colgroup" class="st-span">Responses/ — with
    // Target off, Final and Collected were the two response columns left, so
    // the spanner still had two to cover. Collected was removed on 2026-09-29
    // and Final is now alone under Responses, so it heads itself (the spanner
    // rule is pinned by the next test). What this test is for is unchanged:
    // the header and the total leave with the column.
    expect(noTarget).toContain('>Final</th>')
    expect(noTarget).not.toContain('scope="colgroup"')
    expect(noTarget).not.toContain('Target and Final: the')
    // The subtotal note names only the column that is printing.
    expect(noTarget).toContain('Final: the')
  })

  it('drops the Responses spanner once one response column is left to cover', () => {
    // Measured in Chrome: "Responses" is wider than any one response column,
    // and a header that does not fit pushed the table past the paper.
    // Since 2026-09-29 there are two response columns, not three, so unticking
    // ONE of them reaches this case; it used to take two.
    const h = statement({ printChoice: { colsOff: ['final'] } })
    expect(h).toContain('>Target</th>')
    // No spanner, so no second header row: the one column heads itself.
    expect(h).not.toContain('scope="colgroup"')
    expect(h).not.toContain('class="st-span"')
    expect(all).toContain('scope="colgroup"')
  })

  it('drops the sections, and every footnote mark that pointed into the notes', () => {
    const h = statement({ printChoice: { sectionsOff: ['contract', 'activity', 'notes'] } })
    expect(h).not.toContain('aria-label="Notes"')
    expect(h).not.toContain('class="st-summary')
    expect(h).not.toContain('class="st-fn"')
    // The sign-off is who to call, not a note: it still prints.
    expect(h).toContain('Prepared by AlphaROC for The Fixture Group.')
    expect(h).toContain('st-sign-only')
    // The page would say "at least", and nothing on it explains that now.
    expect(h).toContain('The notes are off')
    // One panel: it takes the row on its own.
    expect(statement({ printChoice: { sectionsOff: ['contract'] } })).toContain('st-summary st-summary-one')
  })

  it('explains a mark only while the column that prints it does', () => {
    // The status key belongs to the Status column's marks.
    expect(all).toContain('aria-label="Status key"')
    expect(statement({ printChoice: { colsOff: ['status'] } })).not.toContain('aria-label="Status key"')
    // The ▼ is printed only in the Final column. With Final off there is no
    // final count to report at all, so the sentence that carried it is gone
    // with the mark, and the note no longer explains either.
    expect(all).toContain('aria-label="below target"')
    expect(all).toContain('marks a final count below target')
    for (const h of [statement({ printChoice: { colsOff: ['final'] } }), quarterList('client', { colsOff: ['final'] })]) {
      expect(h).not.toContain('fell short')
      expect(h).not.toContain('aria-label="below target"')
      expect(h).not.toContain('marks a final count below target')
    }
  })

  it('renumbers the notes to what still prints', () => {
    // Credits and the contract panel off: "Not yet priced" and "When credits
    // are drawn" have nothing left to explain.
    const h = statement({ printChoice: { colsOff: ['credits'], sectionsOff: ['contract'] } })
    expect(h).not.toContain('Not yet priced.')
    expect(h).not.toContain('When credits are drawn.')
    // WAS '<i>1</i><b>Final and collected.</b>'. The note branched on the
    // Collected column and headed itself after whichever counts it was
    // defining; with the column removed on 2026-09-29 there is one version and
    // one title. The renumbering is what this test protects, and it still is:
    // note 1 is whatever is left once the credit notes drop out.
    expect(h).toContain('<i>1</i><b>The final count.</b>')
  })

  // WAS 'keeps an old export link working', asserting that a legacy choice
  // printed BOTH '>Final</th>' and '>Collected</th>' — the retired `collected`
  // token mapped to both columns until 2026-09-28. INVERTED 2026-09-29: the
  // token still has to be honoured, because the old single "Collected" column
  // showed the FINAL count once a survey was delivered and a bookmarked export
  // must keep printing what it printed. Honouring the literal WORD is the one
  // route that could put the removed column back on a client document, so this
  // now builds the choice from the retired token itself rather than typing the
  // result by hand, and pins both halves.
  it('keeps an old export link working without reviving the column it names', () => {
    const choice = parseUrlChoice('statement', 'collected,credits', null)
    expect(choice).toEqual({ colsOff: ['requested', 'target'], legacy: true })
    const h = statement({ printChoice: choice })
    expect(h).toContain('>Final</th>')
    expect(h).toContain('>Credits</th>')
    expect(h).not.toContain('>Target</th>')
    expect(h).not.toContain('Collected')
  })

  it('never carries a dollar figure, whatever is ticked', () => {
    for (const h of [
      noTarget,
      statement({ printChoice: REDUCED.statement }),
      quarterList('client', REDUCED.list),
      quarterList('internal', REDUCED.internal),
      statement({ printChoice: { colsOff: [] as PrintColumnId[], sectionsOff: [] as PrintSectionId[] } }),
    ]) expect(h).not.toMatch(/\$\s?\d/)
  })

  it('keeps the file name and the footer', () => {
    const h = statement({ printChoice: REDUCED.statement })
    expect(h).toContain('content:"AlphaROC  ·  Confidential  ·  Prepared for The Fixture Group"')
    expect(h).toContain('content:"Survey Activity Statement  ·  24 September 2026  ·  Page " counter(page)')
  })
})

/** Every optional part of a statement, for the "nothing prints" case.
 *  Five columns since 2026-09-29, not six: Collected is not an optional part,
 *  it is not a part. */
const ALL_COLS_ST: PrintColumnId[] = ['requested', 'status', 'target', 'final', 'credits']
const ALL_SECTIONS_ST: PrintSectionId[] = ['contract', 'activity', 'notes']

/**
 * Review finding, 2026-09-28: unticking a column took it out of the table and
 * its totals but left the SAME figure in the summary above, in the largest type
 * on the page — "104% of the 895 targeted" with Target off. A choice that only
 * reaches the table is not a choice.
 */
describe('a figure follows its own column, summary included', () => {
  it('states no target, and no percentage of one, once Target is off', () => {
    for (const h of [
      statement({ printChoice: { colsOff: ['target'] } }),
      quarterList('client', { colsOff: ['target'] }),
      // Every response column off — which is two of them, not three, since
      // 2026-09-29.
      statement({ printChoice: { colsOff: ['target', 'final'] } }),
    ]) {
      expect(h).not.toContain('targeted')
      expect(h).not.toContain('104%')
      expect(h).not.toContain('the 895')
    }
    // With it on, both documents still say it.
    expect(statement()).toContain('104% of the 895 targeted')
    expect(quarterList('client')).toContain('targeted')
  })

  it('keeps the final count, and says what it is measured over, with Target off', () => {
    const h = statement({ printChoice: { colsOff: ['target'] } })
    expect(h).toContain('Across the 10 delivered surveys with both a target and a final count.')
    // "met or beat it" has no "it" left to point at.
    expect(h).toContain('met or beat target')
    expect(h).not.toContain('met or beat it')
  })

  it('drops the final-responses figure entirely once Final is off', () => {
    for (const h of [
      statement({ printChoice: { colsOff: ['final'] } }),
      quarterList('client', { colsOff: ['final'] }),
    ]) {
      expect(h).not.toContain('Final responses')
      expect(h).not.toContain('>928<')
    }
    expect(statement()).toContain('Final responses')
  })

  it('counts the stages out only while the Status column prints', () => {
    const off = statement({ printChoice: { colsOff: ['status'] } })
    expect(statement()).toContain('; 2 in field and 2 in design')
    expect(statement()).toMatch(/surveys · 2 in field, 2 in design/)
    expect(off).not.toContain('; 2 in field and 2 in design')
    expect(off).not.toMatch(/surveys · \d+ in field/)
    // The group heading itself stays: it is the table's own structure.
    expect(off).toContain('<b>In progress</b>')
  })

  it('takes the credits drawn out of the list strip with the Credits column', () => {
    const h = quarterList('client', { colsOff: ['credits'] })
    expect(h).not.toContain('Credits drawn')
    // Two tiles left, so the strip is a two-column grid, not three.
    expect(h).toContain('class="st-strip st-strip-2"')
    expect(quarterList('client')).toContain('Credits drawn')
  })

  it('says so when the contract summary keeps the credits the column dropped', () => {
    const h = statement({ printChoice: { colsOff: ['credits'] } })
    expect(h).toContain('the contract summary still shows the credits drawn against the allowance')
    expect(h).toContain('>at least</span>410')
    // Both off: no credit figure anywhere, and nothing to warn about.
    const none = statement({ printChoice: { colsOff: ['credits'], sectionsOff: ['contract'] } })
    expect(none).not.toContain('the contract summary still shows')
    expect(none).not.toContain('>at least</span>410')
  })
})

/**
 * Review findings, 2026-09-28: the page and the checklist each quoted something
 * the chosen document no longer says.
 */
describe('nothing quotes a figure the chosen document leaves out', () => {
  it('note 1 stops at the credits drawn when the contract summary is off', () => {
    const h = statement({ printChoice: { sectionsOff: ['contract'] } })
    expect(h).toContain('so at least 410 credits have been drawn.')
    // No allowance prints, so there is nothing to read a balance against.
    expect(h).not.toContain('beyond the allowance')
    expect(statement()).toContain('and the balance is at least 35 beyond the allowance')
  })

  it('warns that the notes are off for every mark, not only for a credit figure', () => {
    // The fixture's Final column carries an italic "not recorded", whose only
    // explanation is the "Final and collected" note.
    const both = statement({ printChoice: { sectionsOff: ['notes'] } })
    expect(both).toContain('nothing on the page explains why a figure says “at least” or “Not yet priced” '
      + 'or why a response says “not recorded”.')
    // Credits and the contract panel off too: nothing says "at least" any more,
    // and the mark left over is the one that used to raise no warning at all.
    const h = statement({ printChoice: { colsOff: ['credits'], sectionsOff: ['contract', 'notes'] } })
    expect(h).toContain('nothing on the page explains why a response says “not recorded”.')
    expect(h).not.toContain('at least” or “Not yet priced')
    // With the Final column off, the mark is gone and so is the warning.
    expect(statement({ printChoice: { colsOff: ['credits', 'final'], sectionsOff: ['contract', 'notes'] } }))
      .not.toContain('The notes are off')
  })

  it('counts an estimate as unexplained too', () => {
    const qa = (o: Partial<StatementRow>): StatementRow => ({
      id: 'qa', project_code: 'PR9', project_name: 'Study Zulu - Audience', board_column: 'Data QA', status: 'Open',
      phase: 'Active', n_target: 1000, n_target_max: null, n_collected: 900, n_actual: null, credits: 10,
      deliver_date: '2026-10-01', delivered_at: null, ...o,
    })
    const args = { rows: [qa({})], neverRecorded: new Set<string>(), notes: [] }
    expect(unexplainedMarks({ ...args, prints: PRINTS_ALL })).toEqual(['estimate'])
    // The ≈ is printed only in the Final column.
    expect(unexplainedMarks({ ...args, prints: { ...PRINTS_ALL, final: false } })).toEqual([])
  })

  it('the checklist does not send anyone to fix a date or a figure that is not printing', () => {
    const none = statement({ printChoice: { colsOff: ALL_COLS_ST, sectionsOff: ALL_SECTIONS_ST } })
    expect(none).not.toContain('The statement prints those dates')
    expect(none).not.toContain('prints “was due')
    expect(none).not.toContain('will say “at least 410”')
    // The items are still there, minus the sentence about the page.
    expect(none).toContain('Price them and the credits drawn are exact.')
    expect(none).toContain('is in field and was due 23 Sep 2026. Update the due date if it has moved.')
    // With only Status off, the credit sentence stays and the dates go.
    const noStatus = statement({ printChoice: { colsOff: ['status'] } })
    expect(noStatus).toContain('will say “at least 410”')
    expect(noStatus).not.toContain('The statement prints those dates')
    expect(statement()).toContain('The statement prints those dates')
  })
})

/**
 * ── THE COLUMN CANNOT COME BACK (2026-09-29) ───────────────────────────────
 *
 * David did not ask for a safer default; he asked for the risk to be gone:
 * "lets actually remove 'collected' from all views from now … a client doesnt
 * need to know that and i dont want to risk a sales person sending it."
 * Off-by-default leaves a tick, and a tick gets ticked — by a salesperson in a
 * hurry, by a link somebody forwards, or by a default saved on the one day the
 * column existed and defaulted on.
 *
 * So these are not "Collected is off" tests. Each one walks a route by which a
 * choice reaches a FINISHED DOCUMENT — the link, a saved default, a retired
 * link, a choice forced in by hand — and shows the rendered page does not carry
 * the word at all. A document is the right place to make that check: it is the
 * artefact that leaves the building.
 *
 * THE WORD IS CHECKED CAPITALISED. Lowercase "collected" is still correct
 * English about the pre-QA field count, and the screen-only checklist above the
 * paper still uses it ("has a final count of 7 entered while it is still in
 * field (22 collected)") — an internal instruction to fix a record, in a box
 * marked Not printed, and the reason the count is still kept at all.
 * "Collected" capitalised is the column head, the tick and the note title, and
 * none of those may exist anywhere in the markup.
 */
describe('Collected cannot come back', () => {
  /** What usePrintChoice's mount effect computes from a value in this browser's
   *  storage — the saved-default route, end to end. */
  const fromSaved = (raw: string): UrlChoice => resolveChoice({}, parseStoredChoice(raw, 'statement'))

  /** All three documents under one choice. */
  const docsFor = (c?: UrlChoice) => ({
    statement: statement({ printChoice: c }),
    list: quarterList('client', c),
    internal: quarterList('internal', c),
  })

  it('is not on offer, and is on no document, when nobody has chosen anything', () => {
    // The definition list is the source of every tick, every `cols=` token that
    // is honoured, and the ledger's own column order. Nothing names it, so
    // there is nothing to turn on.
    expect(PRINT_COLUMNS.map(c => c.id)).not.toContain('collected')
    // WAS ['collected'] for one day (2026-09-28), when the column existed and
    // was defaulted off. Empty again is the whole point: there is nothing left
    // to default off, so the deletion is not a setting anyone can argue with.
    expect(SYSTEM_DEFAULT.colsOff).toEqual([])
    for (const [where, h] of Object.entries(docsFor())) {
      expect(h, where).not.toContain('Collected')
      // Not passing because the page came out empty: it is a full document.
      expect(h, where).toContain('>Final</th>')
      expect(h, where).toContain('>Credits</th>')
    }
  })

  it('ignores a link that names it, in either direction', () => {
    // "cols=-collected" asks for it OFF and a link that simply leaves it out
    // asks for it ON. Neither has anything to act on: "-collected" is not a
    // known id, so it is dropped rather than turning some other column off.
    const off = parseUrlChoice('statement', '-collected', null)
    const on = parseUrlChoice('statement', '-requested', null)
    expect(off).toEqual({ colsOff: [] })
    expect(statement({ printChoice: off })).toBe(statement())
    expect(on.colsOff).toEqual(['requested'])
    for (const h of [statement({ printChoice: off }), statement({ printChoice: on })]) {
      expect(h).not.toContain('Collected')
    }
  })

  it('ignores a default saved while the column still existed', () => {
    // A stored choice is a list of what is OFF, so the DANGEROUS value is the
    // one that does not name Collected: under the old model that meant "print
    // it", and it is what every v1 value looked like. Both shapes now resolve
    // to the same page, which is what makes the storage key's version bump a
    // belt rather than the only thing holding the column back.
    const naming = fromSaved(JSON.stringify({ colsOff: ['collected'], sectionsOff: [] }))
    const silent = fromSaved(JSON.stringify({ colsOff: [], sectionsOff: [] }))
    expect(naming).toEqual(silent)
    expect(statement({ printChoice: naming })).toBe(statement({ printChoice: silent }))
    for (const c of [naming, silent]) expect(statement({ printChoice: c })).not.toContain('Collected')
  })

  it('cannot be forced in by hand, on any of the three documents', () => {
    // The last route: a choice that names the id outright, as a stale caller or
    // a regression in the pipeline would produce. It changes nothing, because
    // there is no column definition for the documents to draw.
    const forced = { colsOff: ['collected'] as unknown as PrintColumnId[], sectionsOff: [] as PrintSectionId[] }
    expect(statement({ printChoice: forced })).toBe(statement())
    for (const [where, h] of Object.entries(docsFor(forced))) expect(h, where).not.toContain('Collected')
  })
})
