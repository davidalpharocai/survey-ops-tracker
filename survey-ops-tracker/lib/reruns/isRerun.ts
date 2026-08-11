export interface RerunDimensionInput {
  series_id?: string | null
  rerun_number?: number | null
  project_type?: string | null
}

/** A project is a "rerun" (a repeat wave) when it belongs to a rerun_series,
 * is a later wave (rerun_number > 1), or is a legacy project_type='Rerun' row.
 * Rerun is a DIMENSION separate from the base type (PS/B2B). */
export function isRerunProject(p: RerunDimensionInput): boolean {
  return !!p.series_id || (p.rerun_number ?? 1) > 1 || p.project_type === 'Rerun'
}
