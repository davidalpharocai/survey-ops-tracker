import { describe, it, expect } from 'vitest'
import {
  activityFigures, clearedCollection, clientStage, clientStageName, creditCell, cssString, describeRangeForClient,
  deliveredOn, documentTitle, drawnFigure, drawnLine, drawnText, drawnUnpricedPhrase, finalText, fmtDay, fmtDayLong,
  footerText, ledgerTotals, NBSP, preSendChecks, printedName, responseCells, sortForStatement, splitTitle,
  statementFigures, statusWhen, timeET, todayET,
  type StatementRow,
} from './statement'
import { currentTerm, rollUp, type Term } from './credits'
import { PRINTS_ALL, printsOf, type Prints } from './printColumns'
import { filterByRange, rangeFor } from './dateRange'
import {
  FIXTURE_CLIENT, FIXTURE_NEVER_RECORDED, FIXTURE_NOW, FIXTURE_ROWS, FIXTURE_TERMS,
} from './statement.fixture'

/**
 * The fixture is one real account's rows, anonymised, as they stood at 2:43 pm
 * ET on 24 September 2026. Every expected figure below is what the approved
 * design printed for that account; if one moves, the printed statement moved.
 */
const TODAY = todayET(FIXTURE_NOW)
const rows = FIXTURE_ROWS
const never = new Set(FIXTURE_NEVER_RECORDED)
const byCode = (code: string) => rows.find(r => r.project_code === code) as StatementRow

describe('the fixture account, end to end', () => {
  it('stands on 24 September 2026, 2:43 pm ET', () => {
    expect(TODAY).toBe('2026-09-24')
    expect(timeET(FIXTURE_NOW)).toBe('2:43 pm ET')
  })

  it('contract: at least 410 drawn of 375 — 109%, 35 over, day 179 of 364, 49% of the term', () => {
    const F = statementFigures({ rows, terms: FIXTURE_TERMS, today: TODAY })
    expect(F.term?.id).toBe('term-2026')
    expect(F.c.used).toBe(410)
    expect(F.c.total).toBe(375)
    expect(Math.round(F.c.pct as number)).toBe(109)
    expect(F.c.remaining).toBe(-35)
    expect(F.c.unpricedDrawn).toBe(2)
    expect(F.c.unpricedUndrawn).toBe(0)
    expect(F.c.isFloor).toBe(true)
    expect(F.dayOf).toBe(179)
    expect(F.termDays).toBe(364)
    expect(Math.round(F.elapsedPct as number)).toBe(49)
    expect(F.captions.aside).toBe('Renews 29 Mar 2027 · day 179 of 364')
    expect(F.captions.pct).toBe('At least 109% of the 375 allowed.')
    expect(F.captions.unpriced).toBe(`2${NBSP}delivered surveys are not yet priced`)
    expect(F.balance).toEqual({
      label: 'Balance', qualifier: null, figure: '(35)', caption: 'At least 35 credits beyond the allowance.',
    })
    // The meter's scale leaves room for the overage rather than clamping it.
    expect(F.meter!.usedPos).toBeGreaterThan(F.meter!.allowPos)
    expect(F.meter!.usedPos).toBeCloseTo(100 / 1.1, 5)
  })

  it('delivered: 928 final against 895 targeted, over the 10 surveys with both; 8 met, 2 short', () => {
    const t = ledgerTotals(rows)
    expect(t.pairedN).toBe(10)
    expect(t.final).toBe(928)
    expect(t.target).toBe(895)
    expect(t.met).toBe(8)
    expect(t.below).toBe(2)
  })

  it('subtotals: in progress 79; delivered at least 331', () => {
    const progress = ledgerTotals(rows.filter(p => clientStage(p).group === 'progress'))
    const delivered = ledgerTotals(rows.filter(p => clientStage(p).group === 'delivered'))
    expect(progress.used).toBe(79)
    expect(progress.isFloor).toBe(false)
    expect(progress.targetAll).toBe(325)
    expect(delivered.used).toBe(331)
    expect(delivered.isFloor).toBe(true)
  })

  it('this quarter, delivered basis: 10 rows, at least 316, 4 not delivered, 1 undated', () => {
    const r = filterByRange(rows, 'delivered', rangeFor('qtd', TODAY))
    expect(r.rows).toHaveLength(10)
    expect(r.notDelivered).toBe(4)
    expect(r.undated).toBe(1)
    // PR00257 is in field and due inside the quarter; it must not leak in.
    expect(r.rows.map(x => x.project_code)).not.toContain('PR00257')
    const A = activityFigures(r.rows, rangeFor('qtd', TODAY))
    expect(A.t.used).toBe(316)
    expect(A.t.isFloor).toBe(true)
    expect(A.periodLine).toBe('At least 316 credits drawn by the surveys listed below. 2 of them are not yet priced.')
    expect(describeRangeForClient('delivered', rangeFor('qtd', TODAY))).toBe('Delivered 1 Jul – 24 Sep 2026')
  })

  it('PR00358 was delivered on 24 August — Eastern Time, not the UTC 25th', () => {
    expect(deliveredOn(byCode('PR00358'))).toBe('2026-08-24')
    expect(statusWhen(byCode('PR00358'), TODAY)).toBe('24 Aug 2026')
  })

  it('PR00257 reads "was due 23 Sep 2026", and its mid-field count is not a Final', () => {
    const p = byCode('PR00257')
    expect(statusWhen(p, TODAY)).toBe('was due 23 Sep 2026')
    const cells = responseCells(p, never.has(p.id))
    expect(finalText(cells.final)).toBe('—')
    expect(cells.collected).toBe(22)
    expect(cells.target).toBe('50')
  })

  it('PR00151 prints Final "not recorded", never an estimate from its 481 collected', () => {
    const p = byCode('PR00151')
    const cells = responseCells(p, never.has(p.id))
    expect(cells.final.kind).toBe('not-recorded')
    expect(finalText(cells.final)).toBe('not recorded')
    expect(cells.collected).toBe(481)
    expect(statusWhen(p, TODAY)).toBe('date not recorded')
  })

  it('has 8 items to settle before sending', () => {
    const term = currentTerm(FIXTURE_TERMS, TODAY)
    const checks = preSendChecks({
      rows, terms: FIXTURE_TERMS, term, today: TODAY, nameSet: true, internalName: FIXTURE_CLIENT.name,
      doc: 'statement', mode: 'client',
    })
    expect(checks.map(c => c.id.replace(/-p-\d+$/, ''))).toEqual([
      'unpriced-drawn', 'before-term', 'late-delivery', 'no-dates', 'past-due', 'mid-final', 'no-term', 'term-term-dup',
    ])
    const byId = (id: string) => checks.find(c => c.id.startsWith(id))!
    expect(byId('unpriced-drawn').text).toContain('“at least 410”')
    expect(byId('before-term').text).toBe('were due 27 Mar 2026, 3 days before the 2026 Contract began, yet are attached to it. Confirm the contract.')
    expect(byId('late-delivery').text).toContain('delivery on 10 Sep and 8 Sep, more than 5 months after their due date')
    // The what-if: without the dateless priced survey the contract reads 395 of 375.
    expect(byId('no-dates').text).toBe('has no dates, no target and no final count, but its 15 credits count toward the contract. Without it: 395 of 375 (105%, 20 over).')
    expect(byId('past-due').text).toContain('is in field and was due 23 Sep 2026')
    expect(byId('mid-final').lead).toBe('PR00257')
    expect(byId('no-term').lead).toBe('PR00478 and PR00479')
    expect(byId('term-term-dup').text).toBe('A second contract, “2026 - 2027 Contract”, has no dates and no allowance, so it is ignored. Remove it if it duplicates the 2026 Contract.')
  })

  it('adds the name item when no client-facing name is set', () => {
    const term = currentTerm(FIXTURE_TERMS, TODAY)
    const checks = preSendChecks({
      rows, terms: FIXTURE_TERMS, term, today: TODAY, nameSet: false, internalName: FIXTURE_CLIENT.name,
      doc: 'statement', mode: 'client',
    })
    expect(checks).toHaveLength(9)
    expect(checks[8].text).toContain('its internal label, “Fixture Capital”')
  })

  it('sorts in progress by due date, then delivered newest first, undated last', () => {
    expect(sortForStatement(rows).map(p => (p.project_code as string).slice(-3))).toEqual([
      '257', '466', '478', '479', '433', '390', '382', '075', '054', '396', '378', '376', '358', '261', '151',
    ])
  })

  it('credit cells: unpriced in words, drawn with no mark when on the contract in force', () => {
    expect(creditCell(byCode('PR00075'), 'term-2026')).toEqual({ kind: 'unpriced' })
    expect(creditCell(byCode('PR00466'), 'term-2026')).toEqual({ kind: 'drawn', credits: 66, offTerm: false })
    expect(creditCell(byCode('PR00466'), 'term-other')).toEqual({ kind: 'drawn', credits: 66, offTerm: true })
  })

  it('names the unpriced surveys that make the figure a minimum by where they are', () => {
    expect(drawnUnpricedPhrase(rows)).toBe(`2${NBSP}delivered surveys`)
    expect(drawnUnpricedPhrase([{ ...byCode('PR00466'), credits: null }])).toBe(`1${NBSP}survey already in field`)
  })

  it('shows Collected as a dash, not 0, for surveys not yet in field', () => {
    const p = byCode('PR00478')
    expect(responseCells(p, true).collected).toBeNull()
    expect(responseCells(p, false).collected).toBeNull()
    expect(responseCells(byCode('PR00075'), true).collected).toBe(120)
  })

  it('the whole-account activity reads "11 of 15; 2 in field and 2 in design"', () => {
    const A = activityFigures(rows, null)
    expect(A.total).toBe(15)
    expect(A.delivered).toBe(11)
    expect(A.others).toEqual(['2 in field', '2 in design'])
    expect(A.periodLine).toBeNull()
  })

  it('the survey list for this quarter has 3 items to settle', () => {
    const r = filterByRange(rows, 'delivered', rangeFor('qtd', TODAY))
    const term = currentTerm(FIXTURE_TERMS, TODAY)
    const checks = preSendChecks({
      rows: r.rows, terms: FIXTURE_TERMS, term, today: TODAY, nameSet: true, internalName: FIXTURE_CLIENT.name,
      doc: 'list', mode: 'client',
    })
    expect(checks.map(c => c.id)).toEqual(['unpriced-drawn', 'before-term', 'late-delivery'])
    expect(checks[0].text).toContain('listed and not priced, so the list says “at least 316”')
  })
})

describe('client stage names', () => {
  const at = (board_column: string, status = 'Open', phase = 'Active') => clientStage({ board_column, status, phase })

  it('renames every pipeline stage; the internal tool never prints', () => {
    expect(at('Submitted')).toEqual({ label: 'Received', glyph: 'open', group: 'progress' })
    expect(at('Doc Programming').label).toBe('In design')
    expect(at('Survey Programming').label).toBe('In programming')
    expect(at('EdWin QA').label).toBe('In testing')
    expect(at('Fielding')).toEqual({ label: 'In field', glyph: 'half', group: 'progress' })
    expect(at('Data QA')).toEqual({ label: 'In quality review', glyph: 'half', group: 'progress' })
  })

  it('reads the lifecycle first, as the sales tiles do', () => {
    expect(at('Delivery', 'Closed')).toEqual({ label: 'Delivered', glyph: 'full', group: 'delivered' })
    expect(at('Fielding', 'Hold')).toEqual({ label: 'On hold', glyph: 'hold', group: 'stopped' })
    expect(at('Fielding', 'Cancelled').label).toBe('Cancelled')
    expect(at('Submitted', 'Closed')).toEqual({ label: 'Closed', glyph: 'cancel', group: 'stopped' })
    expect(at('Submitted', 'Open', 'Scoping')).toEqual({ label: 'Being scoped', glyph: 'open', group: 'progress' })
  })

  it('translates a stage FILTER chip too, so "EdWin QA" cannot reach the page that way', () => {
    expect(clientStageName('EdWin QA')).toBe('In testing')
    expect(clientStageName('Archived')).toBe('Closed')
    expect(clientStageName('Awaiting Approval')).toBe('Being scoped')
  })
})

describe('dates and words', () => {
  it('uses a fixed month table ("Sep", never ICU\'s "Sept")', () => {
    expect(fmtDay('2026-09-24')).toBe('24 Sep 2026')
    expect(fmtDayLong('2026-09-24')).toBe('24 September 2026')
  })

  it('writes the time as "9:05 am ET", in New York', () => {
    expect(timeET(new Date('2026-09-24T13:05:00Z'))).toBe('9:05 am ET')
    expect(timeET(new Date('2026-12-01T17:30:00Z'))).toBe('12:30 pm ET')
  })

  it('states a range the client way, dropping the start year only when it repeats', () => {
    expect(describeRangeForClient('delivered', { from: '2025-11-01', to: '2026-02-28' })).toBe('Delivered 1 Nov 2025 – 28 Feb 2026')
    expect(describeRangeForClient('submitted', { from: '2026-01-01', to: null })).toBe('Submitted from 1 Jan 2026')
    expect(describeRangeForClient('launched', { from: null, to: null })).toBe('All dates')
  })

  it('splits title from audience on the FIRST " - " and glues "(Part A)"', () => {
    expect(splitTitle('Study Kappa (Part A) - Audience Kappa')).toEqual([`Study Kappa (Part${NBSP}A)`, 'Audience Kappa'])
    expect(splitTitle('A - B - C')).toEqual(['A', 'B - C'])
    expect(splitTitle('Study Lima')).toEqual(['Study Lima', null])
  })
})

describe('statementFigures, every branch', () => {
  const TERM: Term = { id: 't', name: '2026 Contract', credits_total: 500, starts_on: '2026-03-30', renews_on: '2027-03-29' }
  const row = (o: Partial<StatementRow>): StatementRow => ({
    id: Math.random().toString(36).slice(2), project_code: 'PR1', project_name: 'S', board_column: 'Delivery',
    status: 'Closed', phase: 'Active', n_target: 10, n_target_max: null, n_collected: 10, n_actual: 10,
    credits: 10, term_id: 't', deliver_date: '2026-06-01', delivered_at: null, ...o,
  })

  it('no contract in force: no meter, no balance, and it says why', () => {
    const F = statementFigures({ rows: [row({ term_id: null })], terms: [], today: TODAY })
    expect(F.term).toBeNull()
    expect(F.meter).toBeNull()
    expect(F.balance).toBeNull()
    expect(F.captions.heading).toBe('No contract in force')
    expect(F.captions.noBalance).toContain('no allowance or balance')
    expect(F.c.used).toBe(10)
  })

  it('an allowance that is missing or zero: no meter, no balance', () => {
    for (const credits_total of [null, 0]) {
      const F = statementFigures({ rows: [row({})], terms: [{ ...TERM, credits_total }], today: TODAY })
      expect(F.meter).toBeNull()
      expect(F.balance).toBeNull()
      expect(F.captions.noBalance).toContain('no credit allowance recorded')
    }
  })

  it('under the allowance and exact: "Remaining 490"', () => {
    const F = statementFigures({ rows: [row({})], terms: [TERM], today: TODAY })
    expect(F.balance).toEqual({ label: 'Remaining', qualifier: null, figure: '490', caption: '490 of the 500 credits left to draw.' })
    expect(F.captions.pct).toBe('2% of the 500 allowed.')
  })

  it('under the allowance with a minimum: "at most"', () => {
    const F = statementFigures({ rows: [row({}), row({ credits: null })], terms: [TERM], today: TODAY })
    expect(F.balance).toEqual({ label: 'Remaining', qualifier: 'at most', figure: '490', caption: 'At most 490 of the 500 credits left to draw.' })
  })

  it('nothing priced has drawn but something unpriced has: "Not yet priced", never "at least 0"', () => {
    const F = statementFigures({ rows: [row({ credits: null })], terms: [TERM], today: TODAY })
    expect(F.notPriced).toBe(true)
    expect(F.meter).toBeNull()
    expect(F.captions.pct).toBeNull()
    expect(F.balance?.qualifier).toBe('at most')
  })

  it('carries the committed clause for priced surveys that have not fielded', () => {
    const F = statementFigures({
      rows: [row({}), row({ board_column: 'Doc Programming', status: 'Open', credits: 60, n_collected: 0, n_actual: null })],
      terms: [TERM], today: TODAY,
    })
    expect(F.c.used).toBe(10)
    expect(F.c.committed).toBe(60)
    expect(F.captions.committed).toBe('A further 60 credits are priced on 1 survey that has not fielded yet, so it is committed but not drawn.')
  })

  it('a term with no renewal date has a day count but no elapsed track', () => {
    const F = statementFigures({ rows: [row({})], terms: [{ ...TERM, renews_on: null }], today: TODAY })
    expect(F.captions.aside).toBe('From 30 Mar 2026 · no renewal date')
    expect(F.meter?.termPos).toBeNull()
  })
})

describe('the estimate cell', () => {
  const inQA = (o: Partial<StatementRow>): StatementRow => ({
    id: 'e', project_code: 'PR2', project_name: 'S', board_column: 'Data QA', status: 'Open', phase: 'Active',
    n_target: 75, n_target_max: null, n_collected: 80, n_actual: null, credits: 10, deliver_date: null,
    delivered_at: null, ...o,
  })

  it('shows an estimate only while quality review runs, from the measured band', () => {
    const c = responseCells(inQA({}), false)
    expect(c.final.kind).toBe('estimate')
    expect(finalText(c.final)).toBe(`≈${NBSP}76`)
  })

  it('never estimates a survey with no target, or one still in field', () => {
    expect(responseCells(inQA({ n_target: null }), false).final.kind).toBe('none')
    expect(responseCells(inQA({ board_column: 'Fielding' }), false).final.kind).toBe('none')
  })

  it('marks a delivered final below target', () => {
    const c = responseCells(inQA({ board_column: 'Delivery', status: 'Closed', n_actual: 70 }), false)
    expect(c.final).toEqual({ kind: 'final', value: 70, below: true })
  })

  it('prints a sold range as "a–b"', () => {
    expect(responseCells(inQA({ n_target: 1350, n_target_max: 1600 }), false).target).toBe('1,350–1,600')
  })
})

describe('the page footer and the filename', () => {
  it('says Confidential and the client name in client mode', () => {
    expect(footerText({ doc: 'statement', mode: 'client', name: 'Fixture Capital', accounts: 1, today: TODAY })).toEqual({
      left: 'AlphaROC  ·  Confidential  ·  Prepared for Fixture Capital',
      right: 'Survey Activity Statement  ·  24 September 2026  ·  Page ',
    })
  })

  it('never says "Prepared for" in internal mode', () => {
    const f = footerText({ doc: 'list', mode: 'internal', name: 'Fixture Capital', accounts: 3, today: TODAY })
    expect(f.left).toBe('AlphaROC  ·  Internal  ·  covers 3 accounts, not for sending to a client')
    expect(f.left).not.toContain('Prepared for')
    expect(documentTitle({ doc: 'list', mode: 'internal', name: 'x', today: TODAY })).toBe('Survey List - Internal - 2026-09-24')
    expect(documentTitle({ doc: 'statement', mode: 'client', name: 'Fixture Capital', today: TODAY }))
      .toBe('Fixture Capital - Survey Activity Statement - 2026-09-24')
  })

  it('escapes a typed name before it goes into a CSS string', () => {
    const bs = String.fromCharCode(92)
    expect(cssString('A "B" C')).toBe(`"A ${bs}"B${bs}" C"`)
    expect(cssString(`a${bs}b`)).toBe(`"a${bs}${bs}b"`)
    expect(cssString('x\ny')).toBe('"x y"')
    expect(cssString('</style>')).toBe(`"${bs}3C /style>"`)
  })
})

describe('printedName', () => {
  it('pre-fills from the saved display name, else the internal one', () => {
    expect(printedName('', 'The Fixture Group', 'Fixture Capital')).toEqual({ name: 'The Fixture Group', set: true })
    expect(printedName('', null, 'Fixture Capital')).toEqual({ name: 'Fixture Capital', set: false })
  })

  it('counts a typed name as set, but not the internal label left as it is', () => {
    expect(printedName('The Fixture Group', null, 'Fixture Capital')).toEqual({ name: 'The Fixture Group', set: true })
    expect(printedName('Fixture Capital', null, 'Fixture Capital')).toEqual({ name: 'Fixture Capital', set: false })
  })
})

describe('the list in internal mode', () => {
  it('says it is internal, and asks nothing about the client name', () => {
    const checks = preSendChecks({
      rows: [], terms: [], term: null, today: TODAY, nameSet: false, doc: 'list', mode: 'internal', accounts: 3,
    })
    expect(checks.map(c => c.id)).toEqual(['internal'])
    expect(checks[0].text).toContain('covers 3 accounts, so it prints marked Internal')
  })
})

/**
 * Review findings, 2026-09-27, each from a live row: a Collected or Final cell
 * that printed a number the data does not support, and "at least 0".
 */
describe('Collected and Final never print a default as a count', () => {
  const del = (o: Partial<StatementRow>): StatementRow => ({
    id: 'd', project_code: 'PR3', project_name: 'S', board_column: 'Delivery', status: 'Closed', phase: 'Active',
    n_target: 1000, n_target_max: null, n_collected: 0, n_actual: 1279, credits: 10, deliver_date: '2026-09-01',
    delivered_at: null, ...o,
  })

  it('a never-recorded 0 is a dash even when a final count exists (PR00389: Final 1,279, Collected "0")', () => {
    const c = responseCells(del({}), true)
    expect(c.final).toEqual({ kind: 'final', value: 1279, below: false })
    expect(c.collected).toBeNull()
  })

  it('a 0 beside a final count is a dash even when it WAS recorded — it was cleared (PR00257: Final 20, Collected 0)', () => {
    const p = del({ n_target: 50, n_actual: 20, n_collected: 0 })
    expect(clearedCollection(p)).toBe(true)
    expect(responseCells(p, false).collected).toBeNull()
  })

  it('a real collection below the final still prints: it is on record, and the checklist flags it', () => {
    const p = del({ n_target: 300, n_actual: 492, n_collected: 450 })
    expect(clearedCollection(p)).toBe(false)
    expect(responseCells(p, false).collected).toBe(450)
  })

  it('a delivered survey with no final count keeps its recorded collection', () => {
    expect(responseCells(del({ n_actual: null, n_collected: 481 }), false).collected).toBe(481)
  })

  it('no estimate from a collection of 0 (PR00486: "≈ 0 est." against a 1,000 target)', () => {
    const qa = del({ board_column: 'Data QA', status: 'Open', n_actual: null, n_collected: 0 })
    expect(responseCells(qa, false).final).toEqual({ kind: 'none' })
    expect(finalText(responseCells(qa, false).final)).toBe('—')
    // And the moment something is collected, the estimate is back.
    expect(responseCells({ ...qa, n_collected: 900 }, false).final.kind).toBe('estimate')
  })
})

describe('pre-send checks for the response counts', () => {
  const base = (o: Partial<StatementRow>): StatementRow => ({
    id: 'x', project_code: 'PR9', project_name: 'Study Zulu - Audience', board_column: 'Delivery', status: 'Closed',
    phase: 'Active', n_target: 50, n_target_max: null, n_collected: 0, n_actual: 20, credits: 10,
    deliver_date: '2026-09-01', delivered_at: null, ...o,
  })
  const run = (rows: StatementRow[], never?: Set<string>) =>
    preSendChecks({ rows, terms: [], term: null, today: TODAY, nameSet: true, doc: 'statement', mode: 'client', neverRecorded: never })

  it('a cleared collection: "probably cleared when the final was entered"', () => {
    const c = run([base({ id: 'a' })]).find(x => x.id === 'collected-below-final-a')!
    expect(c.lead).toBe('PR9')
    expect(c.text).toBe('shows 20 final but 0 collected. The collected count was probably cleared when the final was entered, so the statement prints a dash under Collected. Correct it before sending.')
  })

  it('a never-entered collection says so, instead of guessing it was cleared', () => {
    const c = run([base({ id: 'a' })], new Set(['a'])).find(x => x.id === 'collected-below-final-a')!
    expect(c.text).toContain('no collected count was ever entered')
  })

  it('a collection below the final: probably out of date', () => {
    const c = run([base({ id: 'a', n_collected: 450, n_actual: 492, n_target: 300 })]).find(x => x.id === 'collected-below-final-a')!
    expect(c.text).toBe('shows 450 collected but 492 final. The final count comes from the responses collected, so the collected count is probably out of date. Correct it before sending.')
  })

  it('quality review with nothing collected', () => {
    const c = run([base({ id: 'q', board_column: 'Data QA', status: 'Open', n_actual: null, n_collected: 0, n_target: 1000 })])
    expect(c.map(x => x.id)).toContain('qa-no-collection-q')
    expect(c.find(x => x.id === 'qa-no-collection-q')!.text).toContain('is in quality review with no responses collected on record')
  })

  it('stays quiet on a healthy delivered survey', () => {
    expect(run([base({ id: 'a', n_collected: 23, n_actual: 20 })]).filter(x => x.id.startsWith('collected-below'))).toEqual([])
  })
})

describe('drawn credits: exact, at least, or not yet priced — never "at least 0"', () => {
  // BofA's Active group, 2026-09-27: two unpriced surveys in field, one priced
  // survey still in design (committed, not drawn).
  const r = (o: Partial<StatementRow>): StatementRow => ({
    id: Math.random().toString(36).slice(2), project_code: 'PR4', project_name: 'S', board_column: 'Fielding',
    status: 'Open', phase: 'Active', n_target: 100, n_target_max: null, n_collected: 30, n_actual: null,
    credits: null, deliver_date: '2026-10-01', delivered_at: null, ...o,
  })
  const active = [
    r({ project_code: 'PR00451' }), r({ project_code: 'PR00392' }),
    r({ project_code: 'PR00438', board_column: 'Doc Programming', n_collected: 0, credits: 100 }),
  ]

  it('drawnFigure has three answers', () => {
    expect(drawnFigure({ used: 410, isFloor: false })).toEqual({ kind: 'exact', value: 410 })
    expect(drawnFigure({ used: 410, isFloor: true })).toEqual({ kind: 'floor', value: 410 })
    expect(drawnFigure({ used: 0, isFloor: true })).toEqual({ kind: 'unknown' })
    expect(drawnFigure({ used: 0, isFloor: false })).toEqual({ kind: 'exact', value: 0 })
    expect(drawnText({ used: 0, isFloor: true })).toBe('Not yet priced')
    expect(drawnText({ used: 410, isFloor: true })).toBe('at least 410')
  })

  it('an all-unpriced in-field list says "not known yet", not "at least 0"', () => {
    const t = ledgerTotals(active)
    expect(t.used).toBe(0)
    expect(t.isFloor).toBe(true)
    const line = drawnLine(t)
    expect(line.head).toBe('The credits drawn by the surveys listed below are not known yet:')
    expect(line.unpriced).toBe('2 of them have drawn credits and are not yet priced')
    const A = activityFigures(active, { from: '2026-07-01', to: '2026-09-30' })
    expect(A.periodLine).toBe('The credits drawn by the surveys listed below are not known yet: 2 of them have drawn credits and are not yet priced.')
    expect(A.periodLine).not.toMatch(/at least 0/i)
  })

  it('the list checklist quotes "Not yet priced", not "at least 0"', () => {
    const checks = preSendChecks({ rows: active, terms: [], term: null, today: TODAY, nameSet: true, doc: 'list', mode: 'client' })
    expect(checks[0].id).toBe('unpriced-drawn')
    expect(checks[0].text).toContain('the list says “Not yet priced” for the credits drawn')
  })

  it('the contract panel agrees: notPriced follows drawnFigure', () => {
    const TERM: Term = { id: 't', name: '2026 Contract', credits_total: 375, starts_on: '2026-03-30', renews_on: '2027-03-29' }
    const F = statementFigures({ rows: active.map(p => ({ ...p, term_id: 't' })), terms: [TERM], today: TODAY })
    expect(F.notPriced).toBe(true)
    expect(drawnFigure(rollUp(active, null)).kind).toBe('unknown')
  })
})

/**
 * Review finding, 2026-09-28: the checklist quoted the document for things the
 * chosen document no longer says — "The statement prints those dates" with the
 * Status column off, "The statement will say “at least 410”" with no credit
 * figure printing anywhere. It is screen-only and cannot put a wrong figure in
 * front of a client, but it sends the reader to fix what is not on the page.
 */
describe('the checklist quotes only what this print carries', () => {
  const term = currentTerm(FIXTURE_TERMS, TODAY)
  const run = (prints?: Prints) => preSendChecks({
    rows, terms: FIXTURE_TERMS, term, today: TODAY, nameSet: true, internalName: FIXTURE_CLIENT.name,
    doc: 'statement', mode: 'client', neverRecorded: never, prints,
  })
  const text = (checks: ReturnType<typeof run>, id: string) => checks.find(c => c.id.startsWith(id))!.text
  const off = (...ids: Parameters<typeof printsOf>[0]['colsOff']) =>
    printsOf({ colsOff: ids, sectionsOff: [] }, 'statement')

  it('says the same as before when everything prints, given or not', () => {
    for (const checks of [run(), run(PRINTS_ALL)]) {
      expect(text(checks, 'unpriced-drawn')).toContain('The statement will say “at least 410” for the credits drawn.')
      expect(text(checks, 'late-delivery')).toContain('The statement prints those dates.')
      expect(text(checks, 'past-due')).toContain('The statement prints “was due 23 Sep 2026”')
    }
  })

  it('drops the dates it would have quoted once the Status column is off', () => {
    const checks = run(off('status'))
    expect(text(checks, 'late-delivery')).toContain('not the day the work went out.')
    expect(text(checks, 'late-delivery')).not.toContain('prints')
    expect(text(checks, 'past-due')).toBe('is in field and was due 23 Sep 2026. Update the due date if it has moved.')
  })

  it('stops quoting the credits drawn when neither the column nor the contract panel prints', () => {
    // The Credits column alone is enough to keep the quotation.
    expect(text(run(printsOf({ colsOff: ['credits'], sectionsOff: [] }, 'statement')), 'unpriced-drawn'))
      .toContain('The statement will say “at least 410”')
    const gone = run(printsOf({ colsOff: ['credits'], sectionsOff: ['contract'] }, 'statement'))
    expect(text(gone, 'unpriced-drawn')).not.toContain('at least 410')
    expect(text(gone, 'unpriced-drawn')).toContain('Price them and the credits drawn are exact.')
  })

  it('drops the Collected dash and the final estimate with their columns', () => {
    const rowsWith: StatementRow[] = [{
      id: 'a', project_code: 'PR9', project_name: 'Study Zulu', board_column: 'Delivery', status: 'Closed',
      phase: 'Active', n_target: 50, n_target_max: null, n_collected: 0, n_actual: 20, credits: 10,
      deliver_date: '2026-09-01', delivered_at: null,
    }, {
      id: 'b', project_code: 'PR8', project_name: 'Study Yankee', board_column: 'Data QA', status: 'Open',
      phase: 'Active', n_target: 50, n_target_max: null, n_collected: 0, n_actual: null, credits: 10,
      deliver_date: '2026-10-01', delivered_at: null,
    }]
    const at = (prints?: Prints) => preSendChecks({
      rows: rowsWith, terms: [], term: null, today: TODAY, nameSet: true, doc: 'statement', mode: 'client', prints,
    })
    expect(text(at(), 'collected-below-final')).toContain('so the statement prints a dash under Collected')
    expect(text(at(), 'qa-no-collection')).toContain('so the statement shows no final estimate for it')
    const none = at(printsOf({ colsOff: ['collected', 'final'], sectionsOff: [] }, 'statement'))
    expect(text(none, 'collected-below-final'))
      .toBe('shows 20 final but 0 collected. The collected count was probably cleared when the final was entered. Correct it before sending.')
    expect(text(none, 'qa-no-collection'))
      .toBe('is in quality review with no responses collected on record. Enter the collected count before sending.')
  })

  it('never changes how many items there are to check', () => {
    const n = run().length
    for (const p of [off('status'), off('credits'), off('collected', 'final'), printsOf({ colsOff: [], sectionsOff: ['contract', 'activity', 'notes'] }, 'statement')]) {
      expect(run(p)).toHaveLength(n)
    }
  })
})
