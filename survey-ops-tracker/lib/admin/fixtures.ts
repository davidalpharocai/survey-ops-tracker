/**
 * Fixtures for the cleanup model.
 *
 * `cleanSurvey()` is a survey with NOTHING wrong with it: every check either
 * passes on it or does not apply. Every test then states only the one thing it
 * is about ("no due date", "delivered with no final N"), which is what makes it
 * possible to assert the other twenty-odd checks stay silent — the hard half of
 * testing this dashboard, and the half that decides whether people trust it.
 *
 * Not a test file: the drill-down UI and the connector both want a realistic
 * row to render against without reaching for production.
 */

import type { CleanupRow, FieldFacts } from './cleanup'

let seq = 0

/** A complete, consistent, delivered PS survey created after the legacy import. */
export function cleanSurvey(over: Partial<CleanupRow> = {}): CleanupRow {
  seq += 1
  const n = String(seq).padStart(5, '0')
  return {
    id: `id-${n}`,
    project_code: `PR${n}`,
    project_name: `Study ${n}`,
    client: 'Holocene Advisors',
    client_id: 'cl-holocene',
    captain_id: 'tm-sree',
    captain_name: 'Sree',
    salesperson: 'Alex Pinsky',
    requested_by_contact_id: 'ct-eric',
    requested_by_name: 'Eric Albert',
    project_type: 'PS',
    phase: 'Active',
    status: 'Closed',
    board_column: 'Delivery',
    scoping_stage: null,
    submitted_date: '2026-08-01',
    launch_date: '2026-08-05',
    due_date: '2026-08-20',
    deliver_date: '2026-08-18',
    delivered_at: '2026-08-18T12:00:00Z',
    rerun_date: null,
    n_target: 500,
    n_target_max: null,
    n_collected: 520,
    n_actual: 500,
    survey_tool_id: `SOCC_STUDY_${n}`,
    longitudinal: false,
    row_level_data: false,
    occam: false,
    series_id: null,
    rerun_number: 1,
    is_placeholder: false,
    created_at: '2026-08-01T09:00:00Z',
    ...over,
  }
}

/** An empty placeholder shell, as scripts/backfill-placeholders.mjs inserts one:
 *  the flag set and every field it would be judged on left null on purpose. */
export function placeholderShell(over: Partial<CleanupRow> = {}): CleanupRow {
  return cleanSurvey({
    is_placeholder: true,
    series_id: 'sr-shell', rerun_number: 4,
    board_column: 'Delivery', status: 'Closed',
    captain_id: null, captain_name: null, salesperson: null, project_type: null,
    requested_by_contact_id: null, requested_by_name: null,
    submitted_date: null, launch_date: null, due_date: null,
    deliver_date: null, delivered_at: null,
    n_target: null, n_target_max: null, n_collected: null, n_actual: null,
    survey_tool_id: null, longitudinal: false,
    ...over,
  })
}

/** Reset the code counter so a test that asserts on `PR00001` is order-independent. */
export function resetFixtureSeq(): void {
  seq = 0
}

export function fieldFacts(over: Partial<FieldFacts> = {}): FieldFacts {
  return { blasts: 0, suppliers: 0, launches: 0, costs: 0, recordsSpend: false, spendIsZero: true, ...over }
}
