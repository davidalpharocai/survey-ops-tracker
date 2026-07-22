import { describe, it, expect } from 'vitest'
import {
  deriveEvents,
  bucketByDate,
  splitDay,
  DEFAULT_FILTERS,
  MAX_CHIPS_PER_DAY,
  type CalendarProject,
  type CalendarReminder,
  type CalendarFilterState,
  type CalendarEvent,
} from './events'

// Far-future dates keep urgency deterministic and out of the way — these tests
// exercise derivation/filtering, not the overdue/soon tint.
const D = {
  due: '2099-03-10',
  deliver: '2099-03-20',
  launch: '2099-03-01',
  rerun: '2099-06-01',
}

function project(overrides: Partial<CalendarProject> = {}): CalendarProject {
  return {
    id: 'p1',
    project_name: 'Q3 Tracker',
    client: 'Acme',
    project_type: 'PS',
    phase: 'Active',
    status: 'Open',
    board_column: 'Fielding',
    priority: 'normal',
    longitudinal: false,
    due_date: null,
    deliver_date: null,
    launch_date: null,
    rerun_date: null,
    captain: { id: 'cap1' },
    co_captain_ids: [],
    ...overrides,
  }
}

function filters(overrides: Partial<CalendarFilterState> = {}): CalendarFilterState {
  return {
    ...DEFAULT_FILTERS,
    ...overrides,
    types: { ...DEFAULT_FILTERS.types, ...(overrides.types ?? {}) },
    statusScope: { ...DEFAULT_FILTERS.statusScope, ...(overrides.statusScope ?? {}) },
  }
}

const typesOf = (events: CalendarEvent[]) => events.map(e => e.type).sort()

describe('deriveEvents — date → event mapping', () => {
  it('a project with all four dates yields four correctly-typed events', () => {
    const p = project({
      longitudinal: true,
      due_date: D.due,
      deliver_date: D.deliver,
      launch_date: D.launch,
      rerun_date: D.rerun,
    })
    const events = deriveEvents([p], [], filters())
    expect(events).toHaveLength(4)
    expect(typesOf(events)).toEqual(['deliver', 'due', 'launch', 'rerun'])
    // Each event points back at the project.
    expect(events.every(e => e.projectId === 'p1')).toBe(true)
  })

  it('rerun event appears only when longitudinal AND rerun_date set', () => {
    // rerun_date set but not longitudinal → no rerun event
    const notLong = deriveEvents([project({ rerun_date: D.rerun })], [], filters())
    expect(notLong.some(e => e.type === 'rerun')).toBe(false)

    // longitudinal but no rerun_date → no rerun event
    const noDate = deriveEvents([project({ longitudinal: true })], [], filters())
    expect(noDate.some(e => e.type === 'rerun')).toBe(false)

    // both → one rerun event
    const both = deriveEvents(
      [project({ longitudinal: true, rerun_date: D.rerun })],
      [],
      filters()
    )
    expect(both.filter(e => e.type === 'rerun')).toHaveLength(1)
  })

  it('a delivered project drops the overdue tint on its due/deliver chips', () => {
    const past = '2000-01-01'
    // Delivered = board_column 'Delivery' but status still 'Open' — the chips
    // still render, but with no red/overdue urgency (the work is done).
    const delivered = deriveEvents(
      [project({ board_column: 'Delivery', due_date: past, deliver_date: past })],
      [],
      filters()
    )
    expect(delivered.length).toBeGreaterThan(0)
    expect(delivered.every(e => e.urgency === null)).toBe(true)
    // A non-delivered open project with the same past date IS overdue.
    const active = deriveEvents([project({ board_column: 'Fielding', due_date: past })], [], filters())
    expect(active.find(e => e.type === 'due')?.urgency).toBe('overdue')
  })

  it("includes the caller's reminders as reminder events", () => {
    const reminders: CalendarReminder[] = [
      { id: 'r1', text: 'Chase Acme legal', due_date: D.due, project_id: 'p1' },
      { id: 'r2', text: 'Personal note', due_date: D.deliver, project_id: null },
    ]
    const events = deriveEvents([], reminders, filters())
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('reminder')
    expect(events.find(e => e.id === 'reminder:r2')?.projectId).toBeNull()
  })
})

describe('deriveEvents — status scope', () => {
  const dated = { due_date: D.due }

  it('open-only default excludes Closed, Hold, and Scoping', () => {
    const projects = [
      project({ id: 'open', status: 'Open', phase: 'Active', ...dated }),
      project({ id: 'closed', status: 'Closed', phase: 'Active', ...dated }),
      project({ id: 'hold', status: 'Hold', phase: 'Active', ...dated }),
      project({ id: 'scoping', status: 'Open', phase: 'Scoping', ...dated }),
    ]
    const events = deriveEvents(projects, [], filters())
    expect(events).toHaveLength(1)
    expect(events[0].projectId).toBe('open')
  })

  it('opt-in toggles widen the scope', () => {
    const projects = [
      project({ id: 'open', status: 'Open', phase: 'Active', ...dated }),
      project({ id: 'closed', status: 'Closed', phase: 'Active', ...dated }),
      project({ id: 'hold', status: 'Hold', phase: 'Active', ...dated }),
      project({ id: 'scoping', status: 'Open', phase: 'Scoping', ...dated }),
    ]
    const events = deriveEvents(
      projects,
      [],
      filters({ statusScope: { includeHold: true, includeClosed: true, includeScoping: true } })
    )
    expect(events.map(e => e.projectId).sort()).toEqual(['closed', 'hold', 'open', 'scoping'])
  })
})

describe('deriveEvents — narrowing filters', () => {
  const base = { due_date: D.due }
  const projects = [
    project({ id: 'a', client: 'Acme', project_type: 'PS', priority: 'urgent', captain: { id: 'cap1' }, ...base }),
    project({ id: 'b', client: 'Beta', project_type: 'B2B', priority: 'normal', captain: { id: 'cap2' }, co_captain_ids: ['cap1'], ...base }),
    project({ id: 'c', client: 'Acme - West', project_type: 'Rerun', priority: 'high', captain: { id: 'cap3' }, ...base }),
  ]

  it('project type narrows', () => {
    const events = deriveEvents(projects, [], filters({ projectType: 'B2B' }))
    expect(events.map(e => e.projectId)).toEqual(['b'])
  })

  it('captain narrows (including co-captains)', () => {
    const events = deriveEvents(projects, [], filters({ captainId: 'cap1' }))
    expect(events.map(e => e.projectId).sort()).toEqual(['a', 'b'])
  })

  it('just-mine narrows to the current member', () => {
    const events = deriveEvents(projects, [], filters({ justMine: true }), 'cap3')
    expect(events.map(e => e.projectId)).toEqual(['c'])
  })

  it('client narrows by firm (ignores the " - suffix")', () => {
    const events = deriveEvents(projects, [], filters({ client: 'Acme' }))
    expect(events.map(e => e.projectId).sort()).toEqual(['a', 'c'])
  })

  it('priority-only keeps high/urgent', () => {
    const events = deriveEvents(projects, [], filters({ priorityOnly: true }))
    expect(events.map(e => e.projectId).sort()).toEqual(['a', 'c'])
  })

  it('legend toggle hides a whole event type', () => {
    const p = project({ due_date: D.due, launch_date: D.launch })
    const events = deriveEvents([p], [], filters({ types: { launch: false } }))
    expect(typesOf(events)).toEqual(['due'])
  })

  it('reminders ignore the project filters but obey their own toggle', () => {
    const reminders: CalendarReminder[] = [
      { id: 'r1', text: 'Note', due_date: D.due, project_id: null },
    ]
    // A restrictive project filter still keeps the reminder.
    const kept = deriveEvents([], reminders, filters({ projectType: 'B2B', justMine: true }), 'nobody')
    expect(kept).toHaveLength(1)
    // Turning off the reminder legend removes it.
    const hidden = deriveEvents([], reminders, filters({ types: { reminder: false } }))
    expect(hidden).toHaveLength(0)
  })
})

describe('bucketByDate + splitDay overflow', () => {
  it('buckets events by YYYY-MM-DD', () => {
    const p = project({ longitudinal: true, due_date: D.due, deliver_date: D.deliver, rerun_date: D.rerun })
    const byDate = bucketByDate(deriveEvents([p], [], filters()))
    expect(Object.keys(byDate).sort()).toEqual([D.due, D.deliver, D.rerun].sort())
    expect(byDate[D.due]).toHaveLength(1)
  })

  it('a day with more than 3 events collapses into "＋N more"', () => {
    const day = '2099-03-10'
    const events: CalendarEvent[] = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      type: 'due',
      date: day,
      title: `t${i}`,
      projectId: `p${i}`,
      projectName: `p${i}`,
      client: 'c',
      urgency: null,
    }))
    const byDate = bucketByDate(events)
    const { shown, overflow } = splitDay(byDate[day])
    expect(byDate[day]).toHaveLength(5)
    expect(overflow).toBeGreaterThan(0)
    expect(overflow).toBe(5 - (MAX_CHIPS_PER_DAY - 1))
    expect(shown).toHaveLength(MAX_CHIPS_PER_DAY - 1)
    expect(`＋${overflow} more`).toBe('＋3 more')
  })

  it('three or fewer events show no overflow', () => {
    const day = '2099-03-10'
    const events: CalendarEvent[] = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`,
      type: 'due',
      date: day,
      title: `t${i}`,
      projectId: `p${i}`,
      projectName: `p${i}`,
      client: 'c',
      urgency: null,
    }))
    const { shown, overflow } = splitDay(events)
    expect(overflow).toBe(0)
    expect(shown).toHaveLength(3)
  })
})
