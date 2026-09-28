import { describe, it, expect, beforeEach } from 'vitest'
import {
  CHECKS, DEFAULT_SCOPE, LEGACY_IMPORT_CUTOFF, checkById, checksFailedBy, inScope,
  isLegacyImport, isRerunWave, isScoping, reached, resultsByGroup, runCleanup, toolIds,
  type CheckResult, type CleanupInput, type CleanupRow, type CleanupSource,
  CLEANUP_PROJECT_COLUMNS, CLEANUP_PROJECT_SELECT, demoAccountIds, withoutDemoAccounts,
} from './cleanup'
import {
  buildCleanupAllCsv, buildCleanupCsv, buildCleanupSummaryCsv, cleanupCsvFilename,
  cleanupCsvHeaders, cleanupCsvNotes, currentHeader,
} from './cleanupCsv'
import { cleanSurvey, fieldFacts, placeholderShell, resetFixtureSeq } from './fixtures'

const TODAY = '2026-09-28'

beforeEach(resetFixtureSeq)

function run(projects: CleanupRow[], extra: Partial<CleanupInput> = {}) {
  return runCleanup({ projects, today: TODAY, ...extra })
}

function result(projects: CleanupRow[], id: string, extra: Partial<CleanupInput> = {}): CheckResult {
  const res = run(projects, extra).results.find(r => r.check.id === id)
  if (!res) throw new Error(`no such check: ${id}`)
  return res
}

/** Every check that fired on these rows, actionable rows and waves together. */
function fired(projects: CleanupRow[], extra: Partial<CleanupInput> = {}): string[] {
  return run(projects, extra).results
    .filter(r => r.available && r.count + r.waveCount > 0)
    .map(r => r.check.id)
    .sort()
}

/* ────────────────────────────────────────────────────────────────────────── */

describe('the check list itself', () => {
  it('has unique ids', () => {
    expect(new Set(CHECKS.map(c => c.id)).size).toBe(CHECKS.length)
  })

  it('gives every check a label, a one-line help, a reason to care, and either a field or a remedy', () => {
    for (const c of CHECKS) {
      expect(c.label.length, c.id).toBeGreaterThan(0)
      expect(c.help.length, c.id).toBeGreaterThan(10)
      expect(c.why.length, c.id).toBeGreaterThan(20)
      // A check with nothing to type MUST say what to do instead, or the tile
      // states a problem and offers no way to clear it.
      if (c.fields.length === 0) expect(c.remedy?.length ?? 0, c.id).toBeGreaterThan(20)
      for (const f of c.fields) {
        expect(f.column, c.id).toMatch(/^[a-z_.]+$/)
        expect(f.entry.length, `${c.id}.${f.column}`).toBeGreaterThan(0)
      }
    }
  })

  it('names no money column anywhere — and offers no cell to type a figure into', () => {
    const columns = CHECKS.flatMap(c => c.fields.map(f => f.column))
    expect(columns.filter(c => /budget|price|margin|cost|cpi|revenue/.test(c))).toEqual([])
    // `actual_spend` is NOT a column on any worksheet. The check that is about
    // it carries no field at all: an editable column headed `actual_spend`
    // would go out in a file and come back hand-written into a
    // trigger-maintained money column, on the one dashboard built with no money
    // on it. What to do instead is said in words.
    expect(columns).not.toContain('actual_spend')
    const spend = checkById('spend_not_recomputed')!
    expect(spend.fields).toEqual([])
    expect(spend.remedy).toContain('Nothing to type')
  })

  it('finds a check by id and returns null for an unknown one', () => {
    expect(checkById('no_due_date')?.label).toBe('No due date')
    expect(checkById('nope')).toBeNull()
  })
})

describe('a survey with nothing wrong with it', () => {
  it('fires no check at all', () => {
    const report = run([cleanSurvey()])
    expect(fired([cleanSurvey()])).toEqual([])
    expect(report.clean).toBe(true)
    expect(report.surveysNeedingWork).toBe(0)
    expect(report.inScope).toBe(1)
  })

  it('still counts as scanned and in scope', () => {
    const report = run([cleanSurvey()])
    expect(report.scanned).toBe(1)
    expect(report.excludedLegacy).toBe(0)
    expect(report.waves).toBe(0)
  })
})

/* ── EVERY CHECK FIRES WHEN IT SHOULD ───────────────────────────────────── */

describe('each check fires on exactly the survey it is about', () => {
  const cases: [string, Partial<CleanupRow>, Partial<CleanupInput>?][] = [
    ['no_salesperson', { salesperson: null }],
    ['unknown_salesperson', { salesperson: 'Jenna' }],
    ['no_captain', { captain_id: null }],
    ['no_client_account', { client_id: null }],
    ['no_requested_by', { requested_by_contact_id: null, requested_by_name: null }],
    ['no_due_date', { due_date: null }],
    ['no_submitted_date', { submitted_date: null }],
    ['no_launch_date', { launch_date: null }],
    ['no_deliver_date', { deliver_date: null, delivered_at: null }],
    ['deliver_date_only_stamped', { deliver_date: null }],
    ['no_project_type', { project_type: null }],
    ['no_survey_tool_id', { survey_tool_id: null }],
    ['repeated_survey_tool_id', { survey_tool_id: 'A1, A1' }],
    ['no_n_target', { n_target: null, n_target_max: null }],
    ['delivered_no_n_actual', { n_actual: null }],
    ['fielded_no_completes', { n_collected: 0 }],
    ['closed_never_delivered', { board_column: 'Data QA', status: 'Closed' }],
    ['delivered_before_submitted', { submitted_date: '2026-08-19' }],
    ['launched_before_submitted', { launch_date: '2026-07-30' }],
    ['flag_longitudinal_contradicted', { rerun_date: '2026-12-01', longitudinal: false }],
    ['flag_longitudinal_unsupported', { longitudinal: true }],
  ]

  for (const [id, over, extra] of cases) {
    it(id, () => {
      const row = cleanSurvey(over)
      const res = result([row], id, extra)
      expect(res.available).toBe(true)
      expect(res.count + res.waveCount, `${id} did not fire`).toBe(1)
    })
  }

  it('fielding_before_stage: blast rows on a survey still in Doc Programming', () => {
    const row = cleanSurvey({ board_column: 'Doc Programming', status: 'Open', n_collected: 0, deliver_date: null, delivered_at: null, n_actual: null })
    const fielding = new Map([[row.id, fieldFacts({ blasts: 2 })]])
    expect(result([row], 'fielding_before_stage', { fielding }).count).toBe(1)
  })

  it('spend_not_recomputed: child rows add up to something and the stored total is zero', () => {
    const row = cleanSurvey()
    const fielding = new Map([[row.id, fieldFacts({ suppliers: 3, recordsSpend: true, spendIsZero: true })]])
    expect(result([row], 'spend_not_recomputed', { fielding }).count).toBe(1)
  })

  it('spend_not_recomputed: silent when the stored total is not zero', () => {
    const row = cleanSurvey()
    const fielding = new Map([[row.id, fieldFacts({ suppliers: 3, recordsSpend: true, spendIsZero: false })]])
    expect(result([row], 'spend_not_recomputed', { fielding }).count).toBe(0)
  })

  it('spend_not_recomputed: silent when the child rows themselves add up to nothing', () => {
    // Three of the live surveys have child rows and a zero total; on two of them
    // the rows are zero too, which is consistent rather than broken.
    const row = cleanSurvey()
    const fielding = new Map([[row.id, fieldFacts({ costs: 1, recordsSpend: false, spendIsZero: true })]])
    expect(result([row], 'spend_not_recomputed', { fielding }).applies).toBe(0)
  })

  it('shared_survey_tool_id: fires on BOTH surveys that claim the id', () => {
    const a = cleanSurvey({ survey_tool_id: 'SHARED_ONE' })
    const b = cleanSurvey({ survey_tool_id: 'SHARED_ONE, OTHER' })
    const res = result([a, b], 'shared_survey_tool_id')
    expect(res.count).toBe(2)
    expect(res.rows.map(r => r.project_code)).toEqual([a.project_code, b.project_code])
  })

  it('shared_survey_tool_id: a collision with an OUT-OF-SCOPE legacy survey still fires', () => {
    // The collision is real whether or not the other row is on the dashboard.
    const legacy = cleanSurvey({ survey_tool_id: 'SHARED_ONE', created_at: '2026-06-10T08:00:00Z' })
    const recent = cleanSurvey({ survey_tool_id: 'SHARED_ONE' })
    const res = result([legacy, recent], 'shared_survey_tool_id')
    expect(res.count).toBe(1)
    expect(res.rows[0].id).toBe(recent.id)
  })

  it('flag_occam_not_onboarded: an Occam delivery to a contact never invited', () => {
    const row = cleanSurvey({ occam: true })
    const contacts = new Map([['ct-eric', false]])
    expect(result([row], 'flag_occam_not_onboarded', { contacts }).count).toBe(1)
  })

  it('flag_occam_not_onboarded: silent once the contact is marked invited', () => {
    const row = cleanSurvey({ occam: true })
    const contacts = new Map([['ct-eric', true]])
    expect(result([row], 'flag_occam_not_onboarded', { contacts }).count).toBe(0)
  })

  it('flag_occam_not_onboarded: does not accuse a NON-Occam survey whose contact was invited elsewhere', () => {
    // 47 live surveys look like this. They are correct: the invite was earned by
    // a different study.
    const row = cleanSurvey({ occam: false })
    const contacts = new Map([['ct-eric', true]])
    expect(result([row], 'flag_occam_not_onboarded', { contacts }).applies).toBe(0)
  })

  it('flag_occam_not_onboarded: counts an Occam delivery with NO contact at all', () => {
    // 4 live surveys are Occam, delivered, and carry either no contact id or one
    // that is not in client_contacts. They used to fall out of `applies`
    // entirely — the strongest version of the gap, reported nowhere.
    const none = cleanSurvey({ occam: true, requested_by_contact_id: null, requested_by_name: null })
    const dangling = cleanSurvey({ occam: true, requested_by_contact_id: 'ct-gone' })
    const contacts = new Map([['ct-eric', true]])
    const res = result([none, dangling], 'flag_occam_not_onboarded', { contacts })
    expect(res.applies).toBe(2)
    expect(res.count).toBe(2)
  })
})

/* ── EVERY CHECK STAYS SILENT WHEN THE FIELD IS LEGITIMATELY EMPTY ──────── */

describe('checks stay silent where the field is legitimately empty', () => {
  /** A deal still being scoped: pre-sale, not committed work. */
  const scopingDeal = (over: Partial<CleanupRow> = {}) => cleanSurvey({
    phase: 'Scoping', status: 'Open', board_column: 'Submitted', scoping_stage: 'Proposal Sent',
    submitted_date: null, launch_date: null, due_date: null, deliver_date: null, delivered_at: null,
    n_target: null, n_target_max: null, n_collected: 0, n_actual: null,
    survey_tool_id: null,
    ...over,
  })

  it('a scoping deal is not asked for a due date, an N target or a submitted date', () => {
    const row = scopingDeal()
    expect(isScoping(row)).toBe(true)
    const ids = fired([row])
    expect(ids).not.toContain('no_due_date')
    expect(ids).not.toContain('no_n_target')
    expect(ids).not.toContain('no_submitted_date')
  })

  it('a scoping deal fires nothing on its own', () => {
    expect(fired([scopingDeal()])).toEqual([])
  })

  it('…but IS still asked for a salesperson and a captain — a deal being priced has both', () => {
    expect(fired([scopingDeal({ salesperson: null })])).toContain('no_salesperson')
    expect(fired([scopingDeal({ captain_id: null, captain_name: null })])).toContain('no_captain')
  })

  it('a survey still in Doc Programming is not asked for a launch date', () => {
    const row = cleanSurvey({
      board_column: 'Doc Programming', status: 'Open',
      launch_date: null, deliver_date: null, delivered_at: null, n_collected: 0, n_actual: null,
    })
    expect(fired([row])).not.toContain('no_launch_date')
  })

  it('…but IS asked for one once it has responses, even if the board says otherwise', () => {
    const row = cleanSurvey({
      board_column: 'Doc Programming', status: 'Open',
      launch_date: null, deliver_date: null, delivered_at: null, n_collected: 40, n_actual: null,
    })
    expect(fired([row])).toContain('no_launch_date')
  })

  it('…and IS asked for one once blast or panel rows exist', () => {
    const row = cleanSurvey({
      board_column: 'Fielding', status: 'Open',
      launch_date: null, deliver_date: null, delivered_at: null, n_collected: 0, n_actual: null,
    })
    const fielding = new Map([[row.id, fieldFacts({ launches: 1 })]])
    expect(fired([row], { fielding })).toContain('no_launch_date')
  })

  it('a survey that never reached Delivery is not asked for a delivery date or a final N', () => {
    const row = cleanSurvey({
      board_column: 'Fielding', status: 'Open',
      deliver_date: null, delivered_at: null, n_actual: null,
    })
    const ids = fired([row])
    expect(ids).not.toContain('no_deliver_date')
    expect(ids).not.toContain('deliver_date_only_stamped')
    expect(ids).not.toContain('delivered_no_n_actual')
  })

  it('a survey before EdWin QA is not asked for a survey tool ID', () => {
    const row = cleanSurvey({
      board_column: 'Survey Programming', status: 'Open', survey_tool_id: null,
      deliver_date: null, delivered_at: null, n_actual: null, n_collected: 0, launch_date: null,
    })
    expect(fired([row])).not.toContain('no_survey_tool_id')
  })

  it('a repeat wave is not asked for a submitted date — a wave is spawned, not submitted', () => {
    const row = cleanSurvey({ series_id: 'sr-1', rerun_number: 3, longitudinal: true, submitted_date: null })
    expect(fired([row])).not.toContain('no_submitted_date')
  })

  it('a blank salesperson is reported once, as missing — not also as unrecognised', () => {
    const ids = fired([cleanSurvey({ salesperson: null })])
    expect(ids).toContain('no_salesperson')
    expect(ids).not.toContain('unknown_salesperson')
  })

  it('a survey before Fielding is not accused of having collected nothing', () => {
    const row = cleanSurvey({
      board_column: 'EdWin QA', status: 'Open', n_collected: 0,
      deliver_date: null, delivered_at: null, n_actual: null, launch_date: null,
    })
    expect(fired([row])).not.toContain('fielded_no_completes')
  })

  it('the flag checks say nothing about a survey with no flags set at all', () => {
    // All three flag columns default to FALSE and are never null, so "nobody has
    // reviewed this" cannot be told apart from "reviewed, and it has none". 246
    // of the 433 live surveys look like this row. A bare "no tags" tile could
    // never reach zero, which is why there isn't one.
    const row = cleanSurvey({ longitudinal: false, row_level_data: false, occam: false })
    const ids = fired([row], { contacts: new Map([['ct-eric', false]]) })
    expect(ids.filter(i => i.startsWith('flag_'))).toEqual([])
  })

  it('a single-ID row is not accused of repeating itself', () => {
    expect(result([cleanSurvey({ survey_tool_id: 'ONLY' })], 'repeated_survey_tool_id').applies).toBe(0)
  })

  it('a cancelled survey never reaches the model — the loader drops it', () => {
    // Stated as a test so the contract is written down somewhere: a cancelled
    // survey is not a data gap, and demanding a launch date for one would put
    // permanently-unfixable rows on a dashboard whose point is reaching zero.
    const report = run([])
    expect(report.scanned).toBe(0)
    expect(report.clean).toBe(true)
  })
})

/* ── SCOPE ──────────────────────────────────────────────────────────────── */

describe('the legacy-import scope', () => {
  const legacyTimestamp = cleanSurvey({ created_at: '2026-06-10T23:59:59Z', due_date: null })
  const sameDayMidnight = cleanSurvey({ created_at: '2026-06-10T00:00:00Z', due_date: null })
  const nextDay = cleanSurvey({ created_at: '2026-06-11T00:00:00Z', due_date: null })

  it('excludes the import day itself — compared as a DATE, not as a raw timestamp', () => {
    // A string compare against the bare cutoff ('2026-06-10T23:59:59Z' >
    // '2026-06-10') silently readmits the whole 176-row import batch.
    expect(LEGACY_IMPORT_CUTOFF).toBe('2026-06-10')
    expect(isLegacyImport(legacyTimestamp)).toBe(true)
    expect(isLegacyImport(sameDayMidnight)).toBe(true)
    expect(isLegacyImport(nextDay)).toBe(false)
  })

  it('is off by default, and the report says how many rows it removed', () => {
    expect(DEFAULT_SCOPE.includeLegacyImport).toBe(false)
    const report = run([legacyTimestamp, sameDayMidnight, nextDay])
    expect(report.scanned).toBe(3)
    expect(report.inScope).toBe(1)
    expect(report.excludedLegacy).toBe(2)
    expect(report.results.find(r => r.check.id === 'no_due_date')!.count).toBe(1)
  })

  it('shows the whole book when it is turned on', () => {
    const report = run([legacyTimestamp, sameDayMidnight, nextDay], {
      scope: { includeLegacyImport: true },
    })
    expect(report.inScope).toBe(3)
    expect(report.excludedLegacy).toBe(0)
    expect(report.results.find(r => r.check.id === 'no_due_date')!.count).toBe(3)
  })

  it('treats a row with no created_at as legacy rather than putting it in the headline', () => {
    expect(isLegacyImport({ created_at: null })).toBe(true)
    expect(inScope({ created_at: null }, DEFAULT_SCOPE)).toBe(false)
    expect(inScope({ created_at: null }, { includeLegacyImport: true })).toBe(true)
  })
})

/* ── THE RERUN SPLIT ────────────────────────────────────────────────────── */

describe('the rerun-wave split', () => {
  const wave = () => cleanSurvey({ series_id: 'sr-1', rerun_number: 4, longitudinal: true, salesperson: null })
  const fresh = () => cleanSurvey({ salesperson: null })

  it('keeps waves out of the headline number and counts them beside it', () => {
    const res = result([fresh(), wave(), wave()], 'no_salesperson')
    expect(res.count).toBe(1)
    expect(res.waveCount).toBe(2)
    expect(res.applies).toBe(3)
    expect(res.rows).toHaveLength(1)
    expect(res.waves).toHaveLength(2)
  })

  it('recognises all three shapes of a repeat wave', () => {
    expect(isRerunWave(cleanSurvey({ series_id: 'sr-1' }))).toBe(true)
    expect(isRerunWave(cleanSurvey({ rerun_number: 2 }))).toBe(true)
    expect(isRerunWave(cleanSurvey({ project_type: 'Rerun' }))).toBe(true)
    // rerun_number DEFAULTS TO 1 on every row — the whole book is not a rerun.
    expect(isRerunWave(cleanSurvey({ rerun_number: 1 }))).toBe(false)
    expect(isRerunWave(cleanSurvey())).toBe(false)
  })

  it('counts a survey failing several checks once in surveysNeedingWork, and never counts a wave', () => {
    const bad = cleanSurvey({ salesperson: null, captain_id: null, due_date: null })
    const badWave = cleanSurvey({ series_id: 'sr-2', rerun_number: 2, longitudinal: true, salesperson: null, captain_id: null })
    const report = run([bad, badWave])
    expect(report.surveysNeedingWork).toBe(1)
    expect(report.waves).toBe(1)
    expect(report.clean).toBe(false)
  })

  it('lists every check one survey fails', () => {
    const bad = cleanSurvey({ salesperson: null, due_date: null })
    const failed = checksFailedBy(run([bad]), bad.id).map(c => c.id).sort()
    expect(failed).toEqual(['no_due_date', 'no_salesperson'])
  })

  it('orders rows by project code, so the same export twice is the same file twice', () => {
    const a = cleanSurvey({ project_code: 'PR00300', salesperson: null })
    const b = cleanSurvey({ project_code: 'PR00100', salesperson: null })
    const c = cleanSurvey({ project_code: null, salesperson: null })
    expect(result([a, b, c], 'no_salesperson').rows.map(r => r.project_code))
      .toEqual(['PR00100', 'PR00300', null])
  })
})

/* ── A FAILED READ IS NOT ZERO ──────────────────────────────────────────── */

describe('a blocked source', () => {
  const blocked: CleanupSource[] = ['blasts']

  it('reports its checks as unavailable, not as zero', () => {
    const res = result([cleanSurvey()], 'fielding_before_stage', { blocked })
    expect(res.available).toBe(false)
    expect(res.blockedBy).toEqual(['blasts'])
    expect(res.count).toBe(0)
    expect(res.applies).toBe(0)
  })

  it('stops the report claiming the book is clean', () => {
    const report = run([cleanSurvey()], { blocked })
    expect(report.clean).toBe(false)
    expect(report.blocked).toEqual(['blasts'])
  })

  it('leaves the checks that do not depend on it alone', () => {
    const res = result([cleanSurvey({ due_date: null })], 'no_due_date', { blocked })
    expect(res.available).toBe(true)
    expect(res.count).toBe(1)
  })

  it('sorts unavailable checks to the top of their group', () => {
    const group = resultsByGroup(run([cleanSurvey()], { blocked }), 'consistency')
    expect(group[0].available).toBe(false)
  })
})

/* ── SMALL HELPERS THAT CARRY REAL WEIGHT ───────────────────────────────── */

describe('helpers', () => {
  it('splits a comma-separated survey_tool_id and never exact-matches it', () => {
    expect(toolIds({ survey_tool_id: 'A, B ,C' })).toEqual(['A', 'B', 'C'])
    expect(toolIds({ survey_tool_id: null })).toEqual([])
    expect(toolIds({ survey_tool_id: '  ' })).toEqual([])
  })

  it('knows how far along the pipeline a survey is', () => {
    expect(reached({ board_column: 'Delivery' }, 'Fielding')).toBe(true)
    expect(reached({ board_column: 'Doc Programming' }, 'Fielding')).toBe(false)
    expect(reached({ board_column: null }, 'Submitted')).toBe(false)
    // An internal-project board column is not on the survey pipeline at all.
    expect(reached({ board_column: 'In Progress' }, 'Submitted')).toBe(false)
  })

  it('only excuses a deal that is really still pre-sale', () => {
    expect(isScoping({ phase: 'Scoping', status: 'Open', board_column: 'Submitted' })).toBe(true)
    // Marked Scoping while it is being fielded: not an excuse.
    expect(isScoping({ phase: 'Scoping', status: 'Open', board_column: 'Fielding' })).toBe(false)
    expect(isScoping({ phase: 'Scoping', status: 'Closed', board_column: 'Submitted' })).toBe(false)
    expect(isScoping({ phase: 'Active', status: 'Open', board_column: 'Submitted' })).toBe(false)
  })
})

/* ── THE CSV ────────────────────────────────────────────────────────────── */

describe('the cleanup CSV', () => {
  it('leads with project_code and heads the editable column with the real database field', () => {
    const check = checkById('no_due_date')!
    expect(cleanupCsvHeaders(check)).toEqual([
      'project_code', 'project_name', 'client', 'stage', 'status', 'rerun_wave', 'requested_by',
      'due_date (current)', 'due_date',
    ])
    expect(currentHeader('due_date')).toBe('due_date (current)')
  })

  it('writes the current value and leaves the new-value cell empty', () => {
    const row = cleanSurvey({ project_code: 'PR00042', due_date: null })
    const csv = buildCleanupCsv(result([row], 'no_due_date'))
    const [header, line] = csv.split('\r\n')
    expect(header.endsWith('due_date (current),due_date')).toBe(true)
    expect(line.startsWith('PR00042,')).toBe(true)
    // …,<current>,<blank>  — a blank means "leave alone", never "clear it".
    expect(line.endsWith(',,')).toBe(true)
  })

  it('carries every field of a multi-field check', () => {
    const check = checkById('closed_never_delivered')!
    expect(cleanupCsvHeaders(check).slice(-4))
      .toEqual(['board_column (current)', 'board_column', 'status (current)', 'status'])
  })

  it('defuses a cell a spreadsheet would run as a formula', () => {
    const row = cleanSurvey({ project_name: '=HYPERLINK("http://x","click")', due_date: null })
    const csv = buildCleanupCsv(result([row], 'no_due_date'))
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).not.toMatch(/,=HYPERLINK/)
  })

  it('quotes a value containing a comma rather than splitting the row', () => {
    const row = cleanSurvey({ client: 'Holocene, Advisors', due_date: null })
    const csv = buildCleanupCsv(result([row], 'no_due_date'))
    expect(csv).toContain('"Holocene, Advisors"')
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('leaves repeat waves out unless they are asked for', () => {
    const fresh = cleanSurvey({ project_code: 'PR00100', salesperson: null })
    const wave = cleanSurvey({ project_code: 'PR00200', series_id: 'sr-1', rerun_number: 2, longitudinal: true, salesperson: null })
    const res = result([fresh, wave], 'no_salesperson')
    expect(buildCleanupCsv(res).split('\r\n')).toHaveLength(2)
    const withWaves = buildCleanupCsv(res, { includeWaves: true })
    expect(withWaves.split('\r\n')).toHaveLength(3)
    expect(withWaves).toContain('PR00200')
    expect(withWaves).toContain('Yes') // rerun_wave
  })

  it('says what to type into each editable column, headed as the file heads it', () => {
    // `captain_id` stores a uuid and a person types a name, so the header says
    // so — a returned "Sree" is visibly a name to resolve, not a value to write.
    expect(cleanupCsvNotes(checkById('no_captain')!)).toEqual([
      { column: 'captain_id (by name)', entry: "the captain's initials or full name (Claude resolves it to the team member)" },
    ])
    expect(cleanupCsvHeaders(checkById('no_captain')!).slice(-2))
      .toEqual(['captain_id (current)', 'captain_id (by name)'])
    expect(cleanupCsvHeaders(checkById('no_client_account')!).slice(-2))
      .toEqual(['client_id (current)', 'client_id (by name)'])
  })

  it('carries a read-only field as a value to copy FROM, with no cell to type into', () => {
    // "Copy the stamp across" is not a worksheet if the stamp is not in it.
    const check = checkById('deliver_date_only_stamped')!
    expect(cleanupCsvHeaders(check).slice(-3))
      .toEqual(['delivered_at (current)', 'deliver_date (current)', 'deliver_date'])
    expect(cleanupCsvNotes(check).map(n => n.column)).toEqual(['deliver_date'])
    const row = cleanSurvey({ deliver_date: null, delivered_at: '2026-08-18T12:00:00Z' })
    const csv = buildCleanupCsv(result([row], 'deliver_date_only_stamped'))
    expect(csv.split('\r\n')[1]).toContain('2026-08-18T12:00:00Z')
  })

  it('offers no column at all where nothing is typed to clear the check', () => {
    for (const id of ['spend_not_recomputed', 'empty_placeholder_wave']) {
      const check = checkById(id)!
      expect(cleanupCsvHeaders(check), id).toEqual([
        'project_code', 'project_name', 'client', 'stage', 'status', 'rerun_wave', 'requested_by',
      ])
      expect(cleanupCsvNotes(check), id).toEqual([])
    }
  })

  it('names the check and the date in the filename', () => {
    expect(cleanupCsvFilename(checkById('no_due_date')!, TODAY))
      .toBe('socc-cleanup-no-due-date-2026-09-28.csv')
  })

  it('summary: one row per check, with blanks (never zeros) where the read failed', () => {
    const report = run([cleanSurvey({ due_date: null })], { blocked: ['blasts'] })
    const lines = buildCleanupSummaryCsv(report).split('\r\n')
    expect(lines).toHaveLength(CHECKS.length + 1)
    expect(lines[0]).toBe('check_id,check,group,severity,surveys,rerun_waves,applies_to,measured,blocked_by,what_to_do,why')
    const blocked = lines.find(l => l.startsWith('fielding_before_stage,'))!
    expect(blocked).toContain(',,,,no,blasts,')
    const due = lines.find(l => l.startsWith('no_due_date,'))!
    expect(due).toContain(',1,0,1,yes,,')
    // The file says what to do even where there is no column to type into.
    expect(lines.find(l => l.startsWith('spend_not_recomputed,'))!).toContain('Nothing to type')
  })

  it('all-failures: one row per survey, worst first, listing every check it fails', () => {
    const worst = cleanSurvey({ project_code: 'PR00010', salesperson: null, captain_id: null, due_date: null })
    const one = cleanSurvey({ project_code: 'PR00020', due_date: null })
    const csv = buildCleanupAllCsv(run([worst, one]))
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('project_code,project_name,client,stage,status,rerun_wave,requested_by,problems,checks_failed')
    expect(lines[1].startsWith('PR00010,')).toBe(true)
    expect(lines[1]).toContain('3,')
    expect(lines[2].startsWith('PR00020,')).toBe(true)
  })

  it('all-failures: skips a blocked check entirely rather than implying it passed', () => {
    const row = cleanSurvey()
    const fielding = new Map([[row.id, fieldFacts({ blasts: 1 })]])
    const csv = buildCleanupAllCsv(run([row], { fielding, blocked: ['blasts'] }))
    expect(csv.split('\r\n')).toHaveLength(1) // header only
  })
})

/* ── THE MEASURED SHAPE OF THE REAL BOOK ────────────────────────────────── */

describe('the awkward real-world rows', () => {
  it('a delivered survey with only the machine stamp is the LOW tile, not the high one', () => {
    // 70 delivered surveys have no deliver_date; 28 of them carry delivered_at.
    // Splitting them is what makes both numbers reachable.
    const stamped = cleanSurvey({ deliver_date: null })
    const neither = cleanSurvey({ deliver_date: null, delivered_at: null })
    expect(fired([stamped])).toEqual(['deliver_date_only_stamped'])
    expect(fired([neither])).toEqual(['no_deliver_date'])
  })

  it('an empty rerun placeholder fires ONE check — the one it can actually clear', () => {
    // The 20 shells were INSERTED with these fields null (migration 075,
    // scripts/backfill-placeholders.mjs). They failed ten tiles permanently, so
    // `clean` could never be true however much data anyone entered. They answer
    // to one tile now, and a person clears it by deleting or reconciling the
    // shell rather than inventing a captain for a wave that never ran.
    const report = run([placeholderShell()])
    for (const res of report.results) expect(res.count, res.check.id).toBe(0)
    expect(report.surveysNeedingWork).toBe(0)
    expect(report.results.filter(r => r.waveCount > 0).map(r => r.check.id))
      .toEqual(['empty_placeholder_wave'])
  })

  it('a placeholder that HOLDS data is real work and is checked like anything else', () => {
    // PR00352 and PR00344 carry real money. The flag on them is a data error to
    // clear, not a class — lib/finance/lifecycle.ts draws the line the same way.
    const shell = placeholderShell({ id: 'ph-data', n_collected: 400, n_actual: 380 })
    const ids = fired([shell])
    expect(ids).not.toContain('empty_placeholder_wave')
    expect(ids).toContain('no_captain')
    expect(ids).toContain('no_salesperson')
  })

  it('a placeholder is NOT excused while a child read is blocked — we cannot know it is empty', () => {
    const res = result([placeholderShell()], 'no_captain', { blocked: ['blasts'] })
    expect(res.waveCount).toBe(1)
    // …and the tile that is about the shells cannot be measured at all.
    expect(result([placeholderShell()], 'empty_placeholder_wave', { blocked: ['blasts'] }).available)
      .toBe(false)
  })

  it('a survey scoped as a range is not accused of having no N target', () => {
    expect(fired([cleanSurvey({ n_target: null, n_target_max: 750 })])).not.toContain('no_n_target')
  })

  it('a survey with only an internal target is not accused of having no N target either', () => {
    // The VALUE never reaches the model: `n_internal_target` is restricted from
    // the sales tier, so the loader reads it server-side and hands over the ids.
    const row = cleanSurvey({ n_target: null })
    expect(fired([row], { internalTargets: [row.id] })).not.toContain('no_n_target')
    expect(fired([row])).toContain('no_n_target')
  })

  it('never selects the restricted internal-target column into the browser payload', () => {
    expect(CLEANUP_PROJECT_COLUMNS).not.toContain('n_internal_target')
    expect(CLEANUP_PROJECT_SELECT).not.toContain('n_internal_target')
  })
})

/* ── THE LOADER CONTRACT ────────────────────────────────────────────────── */

describe('the column list a loader selects', () => {
  it('covers every field a check reads and names no money column', () => {
    const cols = new Set<string>(CLEANUP_PROJECT_COLUMNS)
    // Everything on the row except captain_name, which comes from the join.
    for (const key of Object.keys(cleanSurvey()) as (keyof CleanupRow)[]) {
      if (key === 'captain_name') continue
      expect(cols.has(key), `${key} missing from CLEANUP_PROJECT_COLUMNS`).toBe(true)
    }
    for (const money of ['budget', 'actual_spend', 'credits', 'n_actual_panel', 'n_actual_blast']) {
      expect(cols.has(money), `${money} must not be selected`).toBe(false)
    }
  })

  it('drops the demo accounts for every loader, from one rule', () => {
    // The page filtered them and the connector did not: 434 rows against 433,
    // and every check that one demo survey failed read one higher in the
    // assistant than on the tile. One helper, called by both.
    const demo = demoAccountIds([
      { id: 'cl-real', is_demo: false },
      { id: 'cl-demo', is_demo: true },
      { id: 'cl-unset', is_demo: null },
    ])
    expect([...demo]).toEqual(['cl-demo'])
    const rows = [
      cleanSurvey({ id: 'real', client_id: 'cl-real' }),
      cleanSurvey({ id: 'demo', client_id: 'cl-demo' }),
      // No account at all: kept, because that is exactly what one tile is for.
      cleanSurvey({ id: 'orphan', client_id: null }),
    ]
    expect(withoutDemoAccounts(rows, demo).map(r => r.id)).toEqual(['real', 'orphan'])
  })

  it('builds a select string with the captain join on the end', () => {
    expect(CLEANUP_PROJECT_SELECT.startsWith('id, project_code,')).toBe(true)
    expect(CLEANUP_PROJECT_SELECT.endsWith('captain:team_members(id, name, initials)')).toBe(true)
  })
})
