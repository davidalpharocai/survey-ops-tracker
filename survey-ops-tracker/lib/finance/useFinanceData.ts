'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { loadFinanceRaw, type FinanceLoad } from './load'

/**
 * The finance hub's one read.
 *
 * Every table the hub needs, paged, ordered and settled table by table
 * (lib/finance/load.ts), so a failed read names its table instead of taking the
 * page down or reading as $0. The shell calls this once and hands the result to
 * whichever tab is showing; a tab never re-reads anything this already holds.
 *
 * The key is versioned. v6 is the four-tab hub: the load's shape is the same
 * as v5, but bumping it means a browser that still holds the old page's cached
 * answer in memory cannot paint the new page from it.
 */
export const FINANCE_QUERY_KEY = ['finance-hub-v6'] as const

export interface FinanceData {
  /** The settled load, or null while it is first loading or if it threw. */
  load: FinanceLoad | null
  isLoading: boolean
  /** True while a refetch is in flight (Retry, or a stale refresh). */
  isFetching: boolean
  /** loadFinanceRaw never throws, so this means something unexpected: a
   *  network failure before any table answered, or a bug. */
  isError: boolean
  error: unknown
  /** Load again — what the Retry button calls. */
  refetch: () => void
}

export function useFinanceData(): FinanceData {
  const q = useQuery({
    queryKey: FINANCE_QUERY_KEY,
    // createClient() inside the query, not per render: the browser client is a
    // singleton, but there is no reason to ask for it on every render either.
    queryFn: () => loadFinanceRaw(createClient()),
    staleTime: 60_000,
  })
  return {
    load: q.data ?? null,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: () => { void q.refetch() },
  }
}
