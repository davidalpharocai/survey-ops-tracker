'use client'

/**
 * The reads This week makes for itself — only what FinanceLoad does not hold.
 *
 *   project_audit          how long each held survey has been on hold
 *   rerun_series           each recurring series' cadence and pause switch
 *   client_term_financials the agreed dollar value of a credit contract
 *   team_members           the captain's name
 *
 * ── THE SAME DISCIPLINE AS THE MAIN LOAD ────────────────────────────────────
 * Every read is paged and ordered (PostgREST truncates silently at 1,000 rows,
 * and a range with no ORDER BY has no stable page boundary), and every hook
 * answers with an `Extra`: loaded, still loading, or Blocked with the table's
 * name. A failed read is never "no holds have an age" or "no series is due" —
 * the model turns Blocked into "Blocked: <table> did not load".
 *
 * rerun_series is read from the TABLE, never from rerun_series_status: that
 * view dates a series from its newest wave, spawned shell or not, so a lapsed
 * series never reads overdue. The due date is computed in lib/finance/thisWeek
 * from the last delivered wave.
 *
 * Each hook memoises what it returns on the query's own state, so the tab's
 * model (and the export it registers) only rebuilds when data actually moves.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
import {
  holdSinceOf,
  type AuditStatusRow, type Extra, type HoldSince, type SeriesRecord,
} from '@/lib/finance/thisWeek'

const PAGE = 1000
/** Ids per `.in()` filter, so the request URL stays well inside limits. */
const CHUNK = 100

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

async function readPaged<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out
}

/** A query's state as the model reads it. `table` names the read in the
 *  Blocked text. */
function useExtra<T>(q: { data: T | undefined; isError: boolean; isSuccess: boolean }, table: string): Extra<T> {
  const { data, isError, isSuccess } = q
  return useMemo<Extra<T>>(() => {
    if (isSuccess && data !== undefined) return { state: 'ok', value: data }
    if (isError) return { state: 'blocked', table }
    return { state: 'loading' }
  }, [data, isError, isSuccess, table])
}

const EMPTY_HOLDS: Extra<Map<string, HoldSince>> = { state: 'ok', value: new Map() }

/**
 * When each held survey went on hold, from its status history. Only the
 * status rows of the held surveys are read; the rule for what counts as a real
 * change lives in `holdSinceOf`.
 */
export function useHoldSince(ids: string[]): Extra<Map<string, HoldSince>> {
  const supabase = createClient()
  const key = useMemo(() => [...ids].sort(), [ids])
  const q = useQuery({
    queryKey: ['finance-this-week', 'hold-since', key.join(',')],
    enabled: key.length > 0,
    queryFn: async () => {
      const rows: AuditStatusRow[] = []
      for (let i = 0; i < key.length; i += CHUNK) {
        const chunk = key.slice(i, i + CHUNK)
        rows.push(...await readPaged<AuditStatusRow>((from, to) =>
          supabase
            .from('project_audit')
            .select('project_id, field, old_value, new_value, changed_by, changed_at')
            .eq('field', 'status')
            .in('project_id', chunk)
            .order('id')
            .range(from, to)))
      }
      return holdSinceOf(rows, key)
    },
    staleTime: 60_000,
    retry: 1,
  })
  const extra = useExtra(q, 'project_audit')
  return key.length === 0 ? EMPTY_HOLDS : extra
}

/** Every rerun_series row: cadence, pause and service switches. */
export function useSeriesRecords(): Extra<SeriesRecord[]> {
  const supabase = createClient()
  const q = useQuery({
    queryKey: ['finance-this-week', 'rerun-series'],
    queryFn: async (): Promise<SeriesRecord[]> => {
      const rows = await readPaged<Record<string, unknown>>((from, to) =>
        supabase.from('rerun_series').select('*').order('id').range(from, to))
      return rows.map(r => ({
        id: String(r.id),
        client_id: (r.client_id as string | null) ?? null,
        survey_name: (r.survey_name as string | null) ?? null,
        cadence_months: r.cadence_months == null ? null : Number(r.cadence_months),
        paused: (r.paused as boolean | null) ?? null,
        in_service: (r.in_service as boolean | null) ?? null,
        resume_anchor: (r.resume_anchor as string | null) ?? null,
      }))
    },
    staleTime: 60_000,
    retry: 1,
  })
  return useExtra(q, 'rerun_series')
}

/**
 * What each credit contract is worth in dollars, where David has entered it
 * (migration 100). Finance-only by RLS, which is fine here: /finance is
 * limited to finance holders. Empty today, so the pools fall back to the rate
 * the contract's own priced surveys imply, and say so.
 */
export function useTermDollars(): Extra<Map<string, number | null>> {
  const supabase = createClient()
  const q = useQuery({
    queryKey: ['finance-this-week', 'term-dollars'],
    queryFn: async () => {
      const rows = await readPaged<Record<string, unknown>>((from, to) =>
        supabase.from('client_term_financials').select('*').order('term_id').range(from, to))
      return new Map(rows.map(r => [String(r.term_id), r.dollars_total == null ? null : Number(r.dollars_total)]))
    },
    staleTime: 60_000,
    retry: 1,
  })
  return useExtra(q, 'client_term_financials')
}

/** Captain names by team_members id — the same cached read the board uses. */
export function useOwners(): Extra<Map<string, string>> {
  const q = useTeamMembers()
  const names = useMemo(
    () => (q.data ? new Map(q.data.map(m => [m.id, m.name])) : undefined),
    [q.data],
  )
  return useExtra({ data: names, isError: q.isError, isSuccess: q.isSuccess }, 'team_members')
}
