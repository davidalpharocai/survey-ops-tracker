import { describe, it, expect } from 'vitest'
import {
  SECTION_TABLE,
  SCOPING_STAGES,
  boardSectionOf,
  partitionBoard,
  boardExportRows,
  boardExportHelp,
  laneCounts,
  collapsedLaneText,
  laneStageOf,
  scopingLaneOrder,
  fieldActivityOf,
  NO_FIELD_ROWS,
  type BoardSection,
} from './sections'

// The database enums, spelled out by hand. SECTION_TABLE is typed over the
// generated enums, so tsc already refuses a missing combination; this list makes
// the runtime test fail too if the table and the enums ever part company.
const STATUSES = ['Open', 'Hold', 'Closed', 'Cancelled'] as const
const PHASES = ['Scoping', 'Active'] as const

type Row = { id: string; phase: string | null; status: string | null }
const row = (id: string, phase: string | null, status: string | null): Row => ({ id, phase, status })

/** Which of the four lists a single row landed in — asserting it is exactly one. */
function landedIn(r: Row): BoardSection | 'unsorted' {
  const parts = partitionBoard([r])
  const hits = (
    [
      ['scoping', parts.scoping.length],
      ['pipeline', parts.pipeline.length],
      ['archived', parts.archived.length],
      ['unsorted', parts.unsorted.length],
    ] as const
  ).filter(([, n]) => n > 0)
  expect(hits).toHaveLength(1)
  expect(hits[0][1]).toBe(1)
  return hits[0][0]
}

describe('boardSectionOf — every phase × status lands in exactly one section', () => {
  it('covers the whole grid, with a reason for each cell', () => {
    expect(Object.keys(SECTION_TABLE).sort()).toEqual([...STATUSES].sort())
    for (const status of STATUSES) {
      expect(Object.keys(SECTION_TABLE[status]).sort()).toEqual([...PHASES].sort())
      for (const phase of PHASES) {
        const where = landedIn(row('x', phase, status))
        expect(where).not.toBe('unsorted')
        expect(SECTION_TABLE[status][phase].why.length).toBeGreaterThan(10)
      }
    }
  })

  it('puts the grid where the board has always put it, plus the two gaps', () => {
    const expected: Record<string, BoardSection> = {
      'Scoping|Open': 'scoping',
      'Scoping|Hold': 'scoping', // the gap: nine surveys on 24 Sep
      'Scoping|Closed': 'archived', // the second gap: "Archive project" on a scoping deal
      'Scoping|Cancelled': 'archived',
      'Active|Open': 'pipeline',
      'Active|Hold': 'pipeline',
      'Active|Closed': 'archived',
      'Active|Cancelled': 'archived',
    }
    for (const [key, section] of Object.entries(expected)) {
      const [phase, status] = key.split('|')
      expect(boardSectionOf({ phase, status }).section, key).toBe(section)
    }
  })

  it('the audit’s held scoping deals now render in the Scoping lane', () => {
    const held = ['PR00002', 'PR00004', 'PR00023', 'PR00026', 'PR00033', 'PR00247', 'PR00286', 'PR00377']
      .map(code => row(code, 'Scoping', 'Hold'))
    const parts = partitionBoard(held)
    expect(parts.scoping.map(p => p.id)).toEqual(held.map(p => p.id))
    expect(parts.pipeline).toHaveLength(0)
    expect(parts.archived).toHaveLength(0)
    expect(parts.unsorted).toHaveLength(0)
  })

  it('never drops a row it does not recognise: unknown or missing values are unsorted, with the reason', () => {
    const odd = [
      row('a', 'Scoping', 'Paused'),
      row('b', 'Delivered', 'Open'),
      row('c', null, 'Open'),
      row('d', 'Active', null),
      row('e', null, null),
      // A key that exists on every object must not be mistaken for a status.
      row('f', 'Active', 'toString'),
      row('g', 'constructor', 'Open'),
    ]
    for (const r of odd) expect(landedIn(r), r.id).toBe('unsorted')
    const parts = partitionBoard(odd)
    expect(parts.unsorted.map(u => u.project.id)).toEqual(odd.map(r => r.id))
    expect(parts.unsorted[0].why).toContain('"Paused"')
    expect(parts.unsorted[1].why).toContain('"Delivered"')
    expect(parts.unsorted[2].why).toBe('It has no phase.')
    expect(parts.unsorted[3].why).toBe('It has no status.')
  })
})

describe('the Scoping lane’s stage — a scoping deal whose stage is no column', () => {
  // The enum has a fifth value the lane has no column for. The AI quick edit
  // offers it, so an open deal can carry it; it must be listed, not drawn nowhere.
  const staged = (id: string, status: string, scoping_stage: string | null, phase = 'Scoping') => ({
    id,
    phase,
    status,
    scoping_stage,
  })

  it('laneStageOf: no stage is New Inquiry, the four columns are themselves, anything else has no column', () => {
    expect(laneStageOf({ scoping_stage: null })).toBe('New Inquiry')
    expect(laneStageOf({})).toBe('New Inquiry')
    for (const s of SCOPING_STAGES) expect(laneStageOf({ scoping_stage: s })).toBe(s)
    expect(laneStageOf({ scoping_stage: 'Closed' })).toBeNull()
    expect(laneStageOf({ scoping_stage: 'Won' })).toBeNull()
    expect(SCOPING_STAGES).toEqual(['New Inquiry', 'Proposal Sent', 'Pricing Discussion', 'Awaiting Approval'])
  })

  it('an open or held scoping deal at stage Closed is unsorted, with a reason that says what to do', () => {
    for (const status of ['Open', 'Hold']) {
      const v = boardSectionOf(staged('x', status, 'Closed'))
      expect(v.section, status).toBe('unsorted')
      expect(v.why).toContain('"Closed"')
      expect(v.why).toContain('Pick a stage')
    }
  })

  it('the stage only matters inside the lane: archived and pipeline rows ignore a stale stage', () => {
    // 273 delivered rows still read "New Inquiry" (27 Sep); a pipeline row demoted
    // and re-promoted can carry anything. None of it moves them.
    expect(boardSectionOf(staged('a', 'Closed', 'Closed')).section).toBe('archived')
    expect(boardSectionOf(staged('b', 'Cancelled', 'Closed')).section).toBe('archived')
    expect(boardSectionOf(staged('c', 'Open', 'Closed', 'Active')).section).toBe('pipeline')
    expect(boardSectionOf(staged('d', 'Hold', 'Closed', 'Active')).section).toBe('pipeline')
  })

  it('every row the lane receives has a column, and the stage-Closed deal is exported with the unsorted rows', () => {
    const rows = [
      staged('open-null', 'Open', null),
      staged('open-new', 'Open', 'New Inquiry'),
      staged('held-await', 'Hold', 'Awaiting Approval'),
      staged('open-closed', 'Open', 'Closed'),
      staged('held-closed', 'Hold', 'Closed'),
    ]
    const parts = partitionBoard(rows)
    expect(parts.scoping.map(r => r.id)).toEqual(['open-null', 'open-new', 'held-await'])
    for (const r of parts.scoping) expect(laneStageOf(r)).not.toBeNull()
    // What the lane draws, column by column, adds up to what it was given.
    const drawn = SCOPING_STAGES.flatMap(s => parts.scoping.filter(r => laneStageOf(r) === s))
    expect(drawn).toHaveLength(parts.scoping.length)
    expect(parts.unsorted.map(u => u.project.id)).toEqual(['open-closed', 'held-closed'])
    expect(boardExportRows(parts, 'full').map(r => r.id)).toContain('open-closed')
    expect(boardExportRows(parts, 'operations').map(r => r.id)).toEqual(['open-closed', 'held-closed'])
  })
})

describe('laneCounts and collapsedLaneText — holds are counted apart, never in the lane’s number', () => {
  const s = (status: string) => ({ status })

  it('splits the 27 Sep lane: 14 open and 8 on hold, not 22', () => {
    const lane = [...Array(14).fill(0).map(() => s('Open')), ...Array(8).fill(0).map(() => s('Hold'))]
    expect(laneCounts(lane)).toEqual({ open: 14, held: 8 })
    expect(collapsedLaneText(laneCounts(lane))).toBe('14 open · 8 on hold hidden — click to expand')
  })

  it('says only what is there', () => {
    expect(collapsedLaneText({ open: 3, held: 0 })).toBe('3 open hidden — click to expand')
    expect(collapsedLaneText({ open: 0, held: 2 })).toBe('2 on hold hidden — click to expand')
    expect(collapsedLaneText({ open: 0, held: 0 })).toBe('collapsed')
    expect(collapsedLaneText({ open: 1350, held: 1 })).toBe('1,350 open · 1 on hold hidden — click to expand')
    expect(laneCounts([])).toEqual({ open: 0, held: 0 })
  })
})

describe('boardExportHelp — the Export tooltip says what the file really holds', () => {
  const rows = [
    row('s1', 'Scoping', 'Open'),
    row('s2', 'Scoping', 'Hold'),
    row('p1', 'Active', 'Open'),
    row('a1', 'Active', 'Closed'),
    row('a2', 'Active', 'Closed'),
  ]

  it('Full View: the count, the three sections, and that no filter narrows it', () => {
    const help = boardExportHelp(partitionBoard(rows), 'full')
    expect(help).toBe(
      'Downloads a CSV of 5 projects: everything in Scoping, the Operations Pipeline and Archived. ' +
        'The pipeline filters (captain, search and the rest) and the Delivered window do not narrow it.'
    )
    expect(help).not.toContain('currently shown')
  })

  it('Operations: the pipeline only, and says Archived is left out', () => {
    expect(boardExportHelp(partitionBoard(rows), 'operations')).toBe(
      'Downloads a CSV of 1 project: everything in the Operations Pipeline (Archived is not in this view’s file). ' +
        'The pipeline filters (captain, search and the rest) do not narrow it.'
    )
  })

  it('counts and names the unsorted rows, and its count always equals the file', () => {
    const parts = partitionBoard([...rows, row('m1', 'Active', 'Paused'), row('m2', null, 'Open')])
    for (const mode of ['full', 'operations'] as const) {
      const help = boardExportHelp(parts, mode)
      expect(help).toContain('It also holds the 2 studies listed above that fit no section.')
      expect(help).toContain(`Downloads a CSV of ${boardExportRows(parts, mode).length} projects`)
    }
  })
})

describe('partitionBoard', () => {
  it('keeps every row exactly once, in input order within each section', () => {
    const rows: Row[] = []
    let i = 0
    for (const status of [...STATUSES, 'Weird', null])
      for (const phase of [...PHASES, 'Odd', null]) rows.push(row(`r${i++}`, phase, status))
    const parts = partitionBoard(rows)
    const all = [
      ...parts.scoping,
      ...parts.pipeline,
      ...parts.archived,
      ...parts.unsorted.map(u => u.project),
    ].map(r => r.id)
    expect(all.sort()).toEqual(rows.map(r => r.id).sort())
    expect(new Set(all).size).toBe(rows.length)
    const order = (list: Row[]) => list.map(r => rows.indexOf(r))
    for (const list of [parts.scoping, parts.pipeline, parts.archived]) {
      expect(order(list)).toEqual([...order(list)].sort((a, b) => a - b))
    }
  })
})

describe('boardExportRows — the CSV carries what the view shows', () => {
  const rows = [
    row('scopeOpen', 'Scoping', 'Open'),
    row('scopeHold', 'Scoping', 'Hold'),
    row('pipeOpen', 'Active', 'Open'),
    row('pipeHold', 'Active', 'Hold'),
    row('archived', 'Active', 'Closed'),
    row('scopeArchived', 'Scoping', 'Closed'),
    row('cancelled', 'Scoping', 'Cancelled'),
    row('mystery', 'Active', 'Paused'),
  ]
  const parts = partitionBoard(rows)

  it('Full View writes every row once, in page order, held scoping deals included', () => {
    const ids = boardExportRows(parts, 'full').map(r => r.id)
    expect(ids).toEqual(['scopeOpen', 'scopeHold', 'pipeOpen', 'pipeHold', 'archived', 'scopeArchived', 'cancelled', 'mystery'])
  })

  it('Operations view writes the pipeline, plus anything no section claims', () => {
    expect(boardExportRows(parts, 'operations').map(r => r.id)).toEqual(['pipeOpen', 'pipeHold', 'mystery'])
  })

  it('the old three filters lost the held scoping deal; the classifier does not', () => {
    const oldScoping = rows.filter(p => p.phase === 'Scoping' && p.status === 'Open')
    const oldPipeline = rows.filter(p => p.phase === 'Active' && (p.status === 'Open' || p.status === 'Hold'))
    const oldArchived = rows.filter(p => (p.phase === 'Active' && p.status === 'Closed') || p.status === 'Cancelled')
    const oldIds = new Set([...oldScoping, ...oldPipeline, ...oldArchived].map(r => r.id))
    expect(oldIds.has('scopeHold')).toBe(false)
    expect(oldIds.has('scopeArchived')).toBe(false)
    const newIds = new Set(boardExportRows(parts, 'full').map(r => r.id))
    expect(newIds.has('scopeHold')).toBe(true)
    expect(newIds.has('scopeArchived')).toBe(true)
  })
})

describe('scopingLaneOrder', () => {
  type Card = { id: string; status: string; sort_order: number | null; created_at: string; deliver_date: string | null; due_date: string | null }
  const card = (id: string, status: string, deliver: string | null, sort: number | null = 1000): Card => ({
    id, status, sort_order: sort, created_at: '2026-09-01T00:00:00Z', deliver_date: deliver, due_date: null,
  })

  it('sinks held deals to the bottom in either sort mode', () => {
    const cards = [card('held-soon', 'Hold', '2026-09-28'), card('open-later', 'Open', '2026-12-01'), card('open-soon', 'Open', '2026-10-01')]
    expect([...cards].sort(scopingLaneOrder<Card>('due')).map(c => c.id)).toEqual(['open-soon', 'open-later', 'held-soon'])
    const manual = [card('held-first', 'Hold', null, 100), card('open-second', 'Open', null, 200)]
    expect([...manual].sort(scopingLaneOrder<Card>('manual')).map(c => c.id)).toEqual(['open-second', 'held-first'])
  })

  it('orders held deals among themselves by the normal scoping order', () => {
    const cards = [card('h-late', 'Hold', '2026-12-01'), card('h-soon', 'Hold', '2026-10-01')]
    expect([...cards].sort(scopingLaneOrder<Card>('due')).map(c => c.id)).toEqual(['h-soon', 'h-late'])
  })
})

describe('fieldActivityOf — a survey still in Scoping that has started fielding', () => {
  it('flags the PR00443 shape: 17 blasts and 23 responses while phase says Scoping', () => {
    const a = fieldActivityOf({ phase: 'Scoping', n_collected: 23, n_actual: null }, { blasts: 17, panel: 0, sendCosts: 0 })
    expect(a).not.toBeNull()
    expect(a!.blasts).toBe(17)
    expect(a!.responses).toBe(23)
    expect(a!.summary).toBe('17 blasts logged and 23 responses collected')
  })

  it('says nothing for a Scoping deal with no trace of fielding', () => {
    expect(fieldActivityOf({ phase: 'Scoping', n_collected: 0, n_actual: null })).toBeNull()
    expect(fieldActivityOf({ phase: 'Scoping', n_collected: null }, NO_FIELD_ROWS)).toBeNull()
  })

  it('says nothing once the survey has left Scoping, whatever rows it has', () => {
    expect(fieldActivityOf({ phase: 'Active', n_collected: 500 }, { blasts: 3, panel: 2, sendCosts: 1 })).toBeNull()
  })

  it('flags a held scoping deal too — the phase is what is stale, not the status', () => {
    // The status is not an input at all: a paused deal that has fielded is just as mislabelled.
    expect(fieldActivityOf({ phase: 'Scoping', n_collected: 0 }, { blasts: 0, panel: 1, sendCosts: 0 })!.summary).toBe('1 panel supplier set up')
  })

  it('names every kind of evidence, singular and plural, with thousands separators', () => {
    const a = fieldActivityOf({ phase: 'Scoping', n_collected: 1350 }, { blasts: 1, panel: 2, sendCosts: 1 })
    expect(a!.summary).toBe('1 blast logged, 2 panel suppliers set up, 1 send fee recorded and 1,350 responses collected')
  })

  it('falls back to the final N when only that is recorded', () => {
    const a = fieldActivityOf({ phase: 'Scoping', n_collected: 0, n_actual: 40 })
    expect(a!.responses).toBe(40)
    expect(a!.summary).toBe('a final N of 40 recorded')
  })

  it('treats a final N of 0 and negative or junk counts as no evidence', () => {
    expect(fieldActivityOf({ phase: 'Scoping', n_collected: -5, n_actual: 0 }, { blasts: -1, panel: 0, sendCosts: 0 })).toBeNull()
    expect(fieldActivityOf({ phase: 'Scoping', n_collected: Number.NaN })).toBeNull()
  })
})
