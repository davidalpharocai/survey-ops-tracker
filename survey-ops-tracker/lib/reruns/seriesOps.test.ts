import { describe, it, expect } from 'vitest'
import {
  cadenceToMonths,
  pickSeriesUpdatePatch,
  SeriesOpError,
  familySeriesConflicts,
  familySeriesConflictError,
  promotionFamilyConflict,
  type Admin,
  type FamilyMemberRow,
} from './seriesOps'

// The DB-touching operations in seriesOps.ts are exercised end-to-end through
// the series route + MCP tools; here we cover the PURE decision pieces (the
// non-trivial logic), since renumber/inherit already have coverage in
// series.test.ts.

describe('cadenceToMonths', () => {
  it('maps the cadence keywords to month counts', () => {
    expect(cadenceToMonths('monthly')).toBe(1)
    expect(cadenceToMonths('quarterly')).toBe(3)
    expect(cadenceToMonths('semiannual')).toBe(6)
    expect(cadenceToMonths('yearly')).toBe(12)
  })
  it('maps adhoc to null (no fixed cadence)', () => {
    expect(cadenceToMonths('adhoc')).toBeNull()
  })
})

describe('pickSeriesUpdatePatch', () => {
  it('keeps only whitelisted fields and drops the rest', () => {
    const res = pickSeriesUpdatePatch({
      cadence_months: 3,
      owner_email: 'sree@alpharoc.ai',
      // not on the whitelist — must be dropped. in_service and paused are the
      // lifecycle, which only pause/end/resume/reactivate may move, because each
      // carries consequences (cancelling pending waves, re-anchoring the
      // cadence) that a field edit would skip.
      in_service: false,
      paused: true,
      id: 'hax',
    })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.patch).toEqual({ cadence_months: 3, owner_email: 'sree@alpharoc.ai' })
    expect('in_service' in res.patch).toBe(false)
    expect('paused' in res.patch).toBe(false)
    expect('id' in res.patch).toBe(false)
  })

  /**
   * ── THE THREE FREE-TEXT FIELDS (2026-09-29) ───────────────────────────────
   *
   * David asked for "two text fields. 1) Rerun/Series Guidance, and 2) Notes".
   * `notes` and `data_qa_note` were already on the table AND already on this
   * whitelist — they were simply never DISPLAYED on the record, which from the
   * outside looks exactly like not existing. `guidance` is the genuinely new
   * one (migration 129).
   *
   * Clearing is the part worth pinning: null has to survive the patch. A
   * whitelist that dropped nulls would make "clear the guidance" quietly mean
   * "change nothing", and the person would be left staring at text they thought
   * they had deleted.
   */
  it('carries guidance, notes and the data/QA note, including clearing them', () => {
    const res = pickSeriesUpdatePatch({ guidance: 'Field Mon-Thu only.', notes: 'Paused over the holidays.' })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.patch).toEqual({ guidance: 'Field Mon-Thu only.', notes: 'Paused over the holidays.' })

    const cleared = pickSeriesUpdatePatch({ guidance: null, notes: null, data_qa_note: null })
    expect('error' in cleared).toBe(false)
    if ('error' in cleared) return
    expect(cleared.patch).toEqual({ guidance: null, notes: null, data_qa_note: null })
    // Present-and-null, not absent: `key in patch` is what makes the write
    // actually clear the column rather than leave it as it was.
    expect('guidance' in cleared.patch).toBe(true)
  })

  it('accepts next_wave_no, which the series record now edits', () => {
    const res = pickSeriesUpdatePatch({ next_wave_no: 4 })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.patch.next_wave_no).toBe(4)
  })

  it('rejects a next wave number that is not a whole number of 1 or more', () => {
    for (const bad of [0, -1, 2.5, null, 'three']) {
      expect('error' in pickSeriesUpdatePatch({ next_wave_no: bad })).toBe(true)
    }
  })

  it('turns a cleared date field into null rather than passing the empty string on', () => {
    // An emptied <input type="date"> sends ''. A date column rejects it, so
    // without this the only way to clear an anchor would be SQL.
    for (const key of ['anchor_date', 'resume_anchor', 'next_due_override']) {
      const res = pickSeriesUpdatePatch({ [key]: '' })
      expect('error' in res).toBe(false)
      if ('error' in res) return
      expect((res.patch as Record<string, unknown>)[key]).toBeNull()
    }
  })

  it('rejects a date that is not a date', () => {
    expect('error' in pickSeriesUpdatePatch({ next_due_override: '15 October' })).toBe(true)
    expect('error' in pickSeriesUpdatePatch({ anchor_date: '2026-13-45x' })).toBe(true)
  })

  it('accepts a real date for each of the three date fields', () => {
    const res = pickSeriesUpdatePatch({
      anchor_date: '2026-05-01',
      resume_anchor: '2026-06-01',
      next_due_override: '2026-10-15',
    })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.patch.next_due_override).toBe('2026-10-15')
    expect(res.patch.anchor_date).toBe('2026-05-01')
  })

  it('accepts a valid base_type', () => {
    const res = pickSeriesUpdatePatch({ base_type: 'PS' })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.patch.base_type).toBe('PS')
  })

  it('rejects an invalid base_type', () => {
    const res = pickSeriesUpdatePatch({ base_type: 'Rerun' })
    expect('error' in res).toBe(true)
  })

  it('returns an empty patch when nothing whitelisted was passed', () => {
    const res = pickSeriesUpdatePatch({ foo: 1, bar: 2 })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(Object.keys(res.patch)).toHaveLength(0)
  })
})

describe('SeriesOpError', () => {
  it('carries an HTTP status (defaults to 400)', () => {
    expect(new SeriesOpError('bad').status).toBe(400)
    expect(new SeriesOpError('missing', 404).status).toBe(404)
    expect(new SeriesOpError('x') instanceof Error).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// the duplicate-series trap: promoting a legacy CHILD whose siblings are
// already in a first-class series used to mint a SECOND series and re-point
// those siblings into it (PR00207 / PR00341, series 36329d48).
// ---------------------------------------------------------------------------

describe('familySeriesConflicts', () => {
  const fam = (rows: Array<[string, string | null]>): FamilyMemberRow[] =>
    rows.map(([code, series_id]) => ({ id: `id-${code}`, project_code: code, project_name: code, series_id }))

  it('flags a member already in another series', () => {
    const out = familySeriesConflicts(fam([['PR00207', null], ['PR00341', 'series-A']]), null)
    expect(out.map((c) => c.project_code)).toEqual(['PR00341'])
  })

  it('flags nothing when the whole family is unattached (a safe promotion)', () => {
    expect(familySeriesConflicts(fam([['PR00207', null], ['PR00341', null]]), null)).toHaveLength(0)
  })

  it('does NOT flag members already in the series being swept into — attach is idempotent', () => {
    const out = familySeriesConflicts(fam([['PR00341', 'series-A'], ['PR00010', 'series-B']]), 'series-A')
    expect(out.map((c) => c.project_code)).toEqual(['PR00010'])
  })
})

describe('familySeriesConflictError', () => {
  it('names the blockers, agrees in number, and carries 409', () => {
    const one = familySeriesConflictError(
      'add PR00010',
      [{ project_code: 'PR00341', project_name: 'x' }],
      'Remove it from that series first.'
    )
    expect(one.status).toBe(409)
    expect(one.message).toBe(
      "Can't add PR00010: PR00341 is linked to it and already in a different series. Remove it from that series first."
    )
    const many = familySeriesConflictError(
      'add PR00010',
      [
        { project_code: 'PR00341', project_name: 'x' },
        { project_code: 'PR00207', project_name: 'y' },
      ],
      'Remove them from that series first.'
    )
    expect(many.message).toContain('PR00341, PR00207 are linked to it')
  })

  it('falls back to the project name when there is no PR code', () => {
    const e = familySeriesConflictError('add X', [{ project_code: null, project_name: 'Unnamed wave' }], 'Fix it.')
    expect(e.message).toContain('Unnamed wave is linked to it')
  })
})

// A fake admin is enough here because promotionFamilyConflict is read-only and
// takes its client as a parameter: `.from(table)` returns a chainable builder
// that resolves to a fixed row set (filters are SQL and aren't exercised — the
// assertion is on the DECISION, not on the query).
function fakeAdmin(rows: Record<string, Record<string, unknown>[]>): Admin {
  return {
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'or', 'is', 'in', 'eq', 'order', 'limit', 'maybeSingle', 'single']) b[m] = () => b
      ;(b as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: rows[table] ?? [], error: null })
      return b
    },
  } as unknown as Admin
}

describe('promotionFamilyConflict', () => {
  const PROMOTED = { id: 'p207', project_code: 'PR00207', project_name: 'National Hingevoter', series_id: null }

  it('refuses when a linked sibling is already in a series, and names it + the series', async () => {
    const admin = fakeAdmin({
      survey_projects: [
        { id: 'p207', project_code: 'PR00207', project_name: 'National Hingevoter', series_id: null },
        { id: 'p341', project_code: 'PR00341', project_name: 'National Hingevoter - Wave 1', series_id: 'sA' },
      ],
      rerun_series: [{ id: 'sA', survey_name: 'National Hingevoter' }],
    })
    const conflict = await promotionFamilyConflict(admin, { ...PROMOTED, rerun_series_id: 'p341' })
    expect(conflict).not.toBeNull()
    expect(conflict!.error.status).toBe(409)
    expect(conflict!.codes).toEqual(['PR00341'])
    expect(conflict!.seriesIds).toEqual(['sA'])
    // The message has to carry what is blocked, what blocks it, and the series
    // that block sits in — all three, by name.
    expect(conflict!.error.message).toContain("Can't put PR00207 into rerun service")
    expect(conflict!.error.message).toContain('PR00341 is linked to it')
    expect(conflict!.error.message).toContain('(National Hingevoter)')

    // And it must offer BOTH remedies rather than prescribing one. The guard
    // only knows a rerun LINK exists, never that the two surveys are the same
    // study — and sometimes the link is itself the mistake. Live case:
    // PR00197 "SWK - Construction" is blocked by PR00232 "SWK - Consumer -
    // Wave 2" being linked to it, so "add it to that series instead" would file
    // a Construction study as a wave of the Consumer one. Naming a single tool
    // here is what made that advice look authoritative, so this asserts the
    // conditional framing survives.
    expect(conflict!.error.message).toContain('really is part of that same study')
    expect(conflict!.error.message).toMatch(/if it is NOT/i)
    expect(conflict!.error.message).toContain('unlink PR00341 from PR00207')
    // The prose is read by a person; the tool name belongs in the connector's
    // structured `options`, not in a sentence.
    expect(conflict!.error.message).not.toContain('add_survey_to_series')
  })

  it('allows the promotion when nothing in the family has a series', async () => {
    const admin = fakeAdmin({
      survey_projects: [
        { id: 'p207', project_code: 'PR00207', project_name: 'x', series_id: null },
        { id: 'p341', project_code: 'PR00341', project_name: 'y', series_id: null },
      ],
    })
    expect(await promotionFamilyConflict(admin, { ...PROMOTED, rerun_series_id: 'p341' })).toBeNull()
  })

  it('refuses re-promoting a project already in a series, without the "linked to it" phrasing', async () => {
    const admin = fakeAdmin({ survey_projects: [] })
    const conflict = await promotionFamilyConflict(admin, { ...PROMOTED, series_id: 'sA' })
    expect(conflict!.error.status).toBe(409)
    expect(conflict!.seriesIds).toEqual(['sA'])
    expect(conflict!.error.message).toBe(
      'PR00207 is already in a rerun series. Work with the series it is in, or remove it from that one first.'
    )
  })

  it('uses the pre-read family when one is passed, so the set checked is the set swept', async () => {
    // Empty DB rows on purpose: if the passed members were ignored and the query
    // used instead, this would wrongly come back clean.
    const admin = fakeAdmin({ survey_projects: [], rerun_series: [] })
    const conflict = await promotionFamilyConflict(admin, PROMOTED, [
      { id: 'p341', project_code: 'PR00341', project_name: 'y', series_id: 'sA' },
    ])
    expect(conflict!.codes).toEqual(['PR00341'])
    // No rerun_series row → the label falls back to the raw id.
    expect(conflict!.error.message).toContain('(sA)')
  })
})
