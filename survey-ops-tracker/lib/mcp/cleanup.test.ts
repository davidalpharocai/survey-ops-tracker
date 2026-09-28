import { describe, it, expect, beforeEach } from 'vitest'
import { formatCleanup, resolveCheck } from './cleanup'
import {
  runCleanup, CHECKS, GROUP_ORDER,
  type CleanupInput, type CleanupRow,
} from '@/lib/admin/cleanup'
import { cleanSurvey, fieldFacts, resetFixtureSeq } from '@/lib/admin/fixtures'

/**
 * The connector half of the cleanup dashboard.
 *
 * What is worth testing here is NOT the check rules — those are
 * lib/admin/cleanup.test.ts's job, and having them tested twice in two places
 * is exactly the duplication this tool was built to avoid. What is worth
 * testing is the two things this file adds on top of them:
 *
 *   1. A BLOCKED READ IS NOT A ZERO. If a table did not load, the tile comes
 *      back `measured:false` with `surveys: null`, `clean` is false, and
 *      drilling in refuses outright. A count of 0 would read to the model as
 *      "that one is clean", which is the single most damaging thing this tool
 *      could say, because the whole feature exists to drive tiles to zero.
 *   2. NO MONEY LEAVES. Every figure on this dashboard is a count of missing
 *      fields; not one is an amount.
 */

const TODAY = '2026-09-28'

const report = (over: Partial<CleanupInput> & { projects: CleanupRow[] }) =>
  runCleanup({ today: TODAY, ...over })

beforeEach(resetFixtureSeq)

describe('resolveCheck', () => {
  it('resolves every check in the model by its id — there is no second list here', () => {
    // The point of the tool reading CHECKS directly: a check added, renamed or
    // removed in lib/admin needs no edit in lib/mcp. If this ever fails, some
    // copy of the rules has grown somewhere.
    for (const c of CHECKS) expect((resolveCheck(c.id) as { id?: string })?.id, c.id).toBe(c.id)
    expect(CHECKS.length).toBeGreaterThanOrEqual(25)
  })

  it('accepts the id written the way a person types it', () => {
    for (const ref of ['no captain', 'No-Captain', 'NO_CAPTAIN', '  no_captain  ']) {
      expect((resolveCheck(ref) as { id?: string })?.id, ref).toBe('no_captain')
    }
  })

  it('accepts words from the tile label', () => {
    expect((resolveCheck('Salesperson not on the list') as { id?: string })?.id).toBe('unknown_salesperson')
  })

  it('reports ambiguity instead of picking one', () => {
    // "date" matches five tiles. Choosing the first would answer a question
    // nobody asked, with a number that looks authoritative.
    const r = resolveCheck('date') as { ambiguous: { id: string }[] }
    expect(r.ambiguous.length).toBeGreaterThan(1)
  })

  it('returns null for something that matches nothing', () => {
    expect(resolveCheck('no unicorn')).toBeNull()
    expect(resolveCheck('   ')).toBeNull()
  })
})

describe('a failed read is not a clean database', () => {
  const blocked = () => report({ projects: [cleanSurvey()], blocked: ['contacts'] })

  it('reports a blocked tile as unmeasured with null counts, never 0', () => {
    const out = formatCleanup(blocked()) as {
      clean: boolean
      groups: { checks: { check_id: string; measured: boolean; surveys: number | null; note?: string }[] }[]
    }
    const tile = out.groups.flatMap(g => g.checks).find(c => c.check_id === 'flag_occam_not_onboarded')!
    expect(tile.measured).toBe(false)
    expect(tile.surveys).toBeNull()
    expect(tile.surveys).not.toBe(0)
    expect(tile.note).toContain('NOT be measured')
    // And the headline must not claim the database is clean while a read failed.
    expect(out.clean).toBe(false)
  })

  it('names the source that did not load, in words', () => {
    const out = formatCleanup(blocked()) as { blocked: string[]; summary: string }
    expect(out.blocked).toEqual(['client contacts'])
    expect(out.summary).toContain('client contacts')
  })

  it('refuses to drill into a blocked check rather than returning an empty list', () => {
    // An empty `surveys: []` is how a tool tells a model "nothing wrong here".
    const out = formatCleanup(blocked(), { check: 'flag_occam_not_onboarded' }) as {
      error?: string; measured?: boolean; surveys?: unknown[]; count?: number
    }
    expect(out.error).toContain('could NOT be measured')
    expect(out.measured).toBe(false)
    expect(out.surveys).toBeUndefined()
    expect(out.count).toBeUndefined()
  })

  it('still measures every check that does not depend on the blocked source', () => {
    const out = formatCleanup(blocked()) as { tiles_measured: number; tiles_total: number }
    expect(out.tiles_total).toBe(CHECKS.length)
    expect(out.tiles_measured).toBe(CHECKS.length - 1)
  })

  it('says every tile is at zero only when everything was actually measured', () => {
    const out = formatCleanup(report({ projects: [cleanSurvey()] })) as { clean: boolean; summary: string }
    expect(out.clean).toBe(true)
    expect(out.summary).toContain('Every tile is at zero')
  })
})

describe('the rerun split survives to the connector', () => {
  // David asked for "70 surveys, plus 48 rerun waves not yet picked up" — the
  // headline is the actionable number and the waves are visible beside it.
  const withWaves = () =>
    report({
      projects: [
        cleanSurvey({ captain_id: null }),
        cleanSurvey({ captain_id: null, series_id: 'sr-1', rerun_number: 3 }),
        cleanSurvey({ captain_id: null, series_id: 'sr-1', rerun_number: 4 }),
      ],
    })

  it('counts waves separately on the tile', () => {
    const out = formatCleanup(withWaves()) as {
      groups: { checks: { check_id: string; surveys: number | null; rerun_waves: number | null }[] }[]
    }
    const tile = out.groups.flatMap(g => g.checks).find(c => c.check_id === 'no_captain')!
    expect(tile.surveys).toBe(1)
    expect(tile.rerun_waves).toBe(2)
  })

  it('keeps waves out of the drill-down list, and says how to see them', () => {
    const out = formatCleanup(withWaves(), { check: 'no_captain' }) as {
      count: number; wave_count: number; surveys: { rerun_wave: boolean }[]; summary: string
    }
    expect(out.count).toBe(1)
    expect(out.wave_count).toBe(2)
    expect(out.surveys).toHaveLength(1)
    expect(out.surveys.every(s => s.rerun_wave === false)).toBe(true)
    expect(out.summary).toContain('plus 2 rerun wave(s) not yet picked up')
    expect(out.summary).toContain('include_waves:true')
  })

  it('lists the waves when asked, flagged as waves', () => {
    const out = formatCleanup(withWaves(), { check: 'no_captain', include_waves: true }) as {
      surveys: { rerun_wave: boolean }[]
    }
    expect(out.surveys).toHaveLength(3)
    expect(out.surveys.filter(s => s.rerun_wave)).toHaveLength(2)
  })
})

describe('drilling into one check', () => {
  const missing = () => report({ projects: [cleanSurvey({ due_date: null }), cleanSurvey()] })

  it('returns the failing surveys with their project codes and what the field holds today', () => {
    const out = formatCleanup(missing(), { check: 'no_due_date' }) as {
      count: number
      surveys: { project_code: string; current: Record<string, unknown> }[]
      check: { fields_to_fill: { column: string; entry: string }[] }
    }
    expect(out.count).toBe(1)
    expect(out.surveys[0].project_code).toBe('PR00001')
    // The current value, so an edit is visibly an edit — and the column named
    // exactly as the database spells it, so nothing has to be guessed when the
    // answer comes back.
    expect(out.surveys[0].current).toEqual({ due_date: null })
    expect(out.check.fields_to_fill[0].column).toBe('due_date')
  })

  it('caps the preview list but never the worksheet', () => {
    const many = report({ projects: Array.from({ length: 8 }, () => cleanSurvey({ due_date: null })) })
    const out = formatCleanup(many, { check: 'no_due_date', limit: 3, csv: true }) as {
      count: number; surveys: unknown[]; truncated: boolean; csv: string; csv_rows: number
    }
    expect(out.count).toBe(8)
    expect(out.surveys).toHaveLength(3)
    expect(out.truncated).toBe(true)
    // A worksheet that silently dropped rows would be edited and handed back as
    // if it were the whole set, and the missing surveys would look fixed.
    expect(out.csv_rows).toBe(8)
    expect(out.csv.trim().split('\r\n')).toHaveLength(9) // header + 8
  })

  it('hands back the same worksheet the dashboard exports, headed with real column names', () => {
    const out = formatCleanup(missing(), { check: 'no_due_date', csv: true }) as {
      csv: string; csv_filename: string
    }
    const [header] = out.csv.split('\r\n')
    expect(header).toContain('project_code')
    expect(header).toContain('due_date (current)')
    expect(header).toContain('due_date')
    expect(out.csv_filename).toBe('socc-cleanup-no-due-date-2026-09-28.csv')
  })

  it('lists the real checks when asked for one that does not exist', () => {
    const out = formatCleanup(missing(), { check: 'no_unicorn' }) as {
      error: string; available_checks: { id: string }[]
    }
    expect(out.error).toContain('no_unicorn')
    expect(out.available_checks).toHaveLength(CHECKS.length)
  })

  it('asks which one rather than guessing when the reference is ambiguous', () => {
    const out = formatCleanup(missing(), { check: 'date' }) as { candidates: { id: string }[] }
    expect(out.candidates.length).toBeGreaterThan(1)
  })
})

describe('scope', () => {
  const mixed = () =>
    report({
      projects: [
        cleanSurvey({ due_date: null, created_at: '2026-06-10T23:59:59Z' }), // the import day itself
        cleanSurvey({ due_date: null, created_at: '2026-06-11T09:00:00Z' }),
      ],
    })

  it('excludes the legacy sheet import by default and says so', () => {
    const out = formatCleanup(mixed()) as {
      scope: { in_scope: number; excluded_legacy: number; legacy_import_included: boolean }
      summary: string
    }
    expect(out.scope.in_scope).toBe(1)
    expect(out.scope.excluded_legacy).toBe(1)
    expect(out.scope.legacy_import_included).toBe(false)
    // Never a bare count: the sentence says which surveys were counted.
    expect(out.summary).toContain('2026-06-10')
    expect(out.summary).toContain('include_legacy_import:true')
  })

  it('counts the import rows when the caller asks for them', () => {
    const wide = runCleanup({
      today: TODAY,
      scope: { includeLegacyImport: true },
      projects: [
        cleanSurvey({ due_date: null, created_at: '2026-06-10T23:59:59Z' }),
        cleanSurvey({ due_date: null, created_at: '2026-06-11T09:00:00Z' }),
      ],
    })
    const out = formatCleanup(wide, { check: 'no_due_date' }) as { count: number }
    expect(out.count).toBe(2)
  })
})

describe('grouping', () => {
  it('offers exactly the model’s groups, in the model’s order', () => {
    // Two lists of group names that can disagree is the drift this whole
    // feature is built to avoid; the tool's enum is checked against the model's.
    const out = formatCleanup(report({ projects: [cleanSurvey()] })) as { groups: { group: string }[] }
    expect(out.groups.map(g => g.group)).toEqual([...GROUP_ORDER])
  })

  it('narrows to one group, and names the real ones when asked for a fiction', () => {
    const one = formatCleanup(report({ projects: [cleanSurvey()] }), { group: 'ownership' }) as {
      groups: { group: string }[]
    }
    expect(one.groups.map(g => g.group)).toEqual(['ownership'])
    const bad = formatCleanup(report({ projects: [cleanSurvey()] }), { group: 'money' }) as {
      error: string; available_groups: { group: string }[]
    }
    expect(bad.error).toContain('money')
    expect(bad.available_groups).toHaveLength(GROUP_ORDER.length)
  })
})

describe('no money', () => {
  // The one spend-related check takes two BOOLEANS computed server-side and
  // states neither an amount nor a total. If an amount ever reaches this
  // output, it reached it through a change somebody made on purpose, and this
  // is where they find out.
  const spendy = () =>
    report({
      projects: [cleanSurvey({ id: 'p1' })],
      fielding: new Map([['p1', fieldFacts({ costs: 2, recordsSpend: true, spendIsZero: true })]]),
    })

  it('states no amount anywhere in the tiles', () => {
    const json = JSON.stringify(formatCleanup(spendy()))
    expect(json).not.toContain('$')
    expect(json).not.toMatch(/"(budget|price_per_n|actual_spend|margin)":/)
  })

  it('reports the spend check as a completeness problem, with no figure and no column to type in', () => {
    const out = formatCleanup(spendy(), { check: 'spend_not_recomputed' }) as {
      count: number
      surveys: { current: Record<string, unknown> }[]
      check: { fields_to_fill: unknown[]; remedy?: string }
    }
    expect(out.count).toBe(1)
    // Nothing to fill in: the fix is to re-save a cost row, not to type a
    // figure. The answer says so instead of naming a money column.
    expect(out.surveys[0].current).toEqual({})
    expect(out.check.fields_to_fill).toEqual([])
    expect(out.check.remedy).toContain('Nothing to type')
    expect(JSON.stringify(out)).not.toContain('actual_spend')
    expect(JSON.stringify(out)).not.toContain('$')
  })

  it('never returns n_internal_target, the one restricted column the loader reads', () => {
    // The loader reads it server-side and hands the model the IDS that have one,
    // so a survey scoped on an internal-only target is not falsely accused of
    // having no N target — and the number itself never leaves the server.
    const row = cleanSurvey({ n_target: null, n_target_max: null })
    const r = report({ projects: [row], internalTargets: [row.id] })
    const out = formatCleanup(r, { check: 'no_n_target' }) as { count: number }
    expect(out.count).toBe(0) // it has a target, so it is not a gap
    expect(JSON.stringify(formatCleanup(r))).not.toContain('n_internal_target')
    expect(JSON.stringify(formatCleanup(r))).not.toContain('400')
  })

  it('returns only context columns on a survey row', () => {
    const out = formatCleanup(report({ projects: [cleanSurvey({ salesperson: null })] }), {
      check: 'no_salesperson',
    }) as { surveys: Record<string, unknown>[] }
    expect(Object.keys(out.surveys[0]).sort()).toEqual([
      'client', 'current', 'project_code', 'project_name', 'requested_by', 'rerun_wave', 'stage', 'status',
    ])
  })
})

describe('how far from zero', () => {
  it('counts surveys once however many checks they fail', () => {
    const out = formatCleanup(
      report({ projects: [cleanSurvey({ salesperson: null, captain_id: null, due_date: null })] })
    ) as { surveys_needing_work: number; open_items: number; tiles_at_zero: number; tiles_measured: number }
    expect(out.surveys_needing_work).toBe(1)
    // Three tiles are off zero, so there are three fields to fill on one survey.
    expect(out.open_items).toBe(3)
    expect(out.tiles_at_zero).toBe(out.tiles_measured - 3)
  })
})
