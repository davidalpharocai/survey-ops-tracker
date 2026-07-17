import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'

// Hooks for the observability tables (migration 036). All use retry:false so a
// pre-migration database shows the empty/fallback state instead of hammering.

export interface AppConfig {
  ai_monthly_cap_usd: number
  ai_hard_stop: boolean
}

export function useAppConfig() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['app-config'],
    queryFn: async (): Promise<AppConfig | null> => {
      const { data, error } = await supabase
        .from('app_config')
        .select('ai_monthly_cap_usd, ai_hard_stop')
        .eq('id', 1)
        .maybeSingle()
      if (error) throw error
      return data as AppConfig | null
    },
    retry: false,
    staleTime: 60_000,
  })
}

export function useUpdateAppConfig() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<AppConfig>) => {
      const { error } = await supabase
        .from('app_config')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', 1)
      if (error) throw error
    },
    onError: () => toast("Couldn't save the AI budget — please try again."),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['app-config'] }),
  })
}

export interface SystemEvent {
  id: string
  created_at: string
  source: string
  status: string
  detail: string | null
}

export function useSystemEvents(limit = 30) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['system-events', limit],
    queryFn: async (): Promise<SystemEvent[]> => {
      const { data, error } = await supabase
        .from('system_events')
        .select('id, created_at, source, status, detail')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as SystemEvent[]
    },
    retry: false,
    staleTime: 30_000,
  })
}

export interface AiUsageRow {
  created_at: string
  endpoint: string
  model: string
  user_email: string | null
  cost_usd: number
}

export interface AiUsageSummary {
  total: number
  count: number
  byEndpoint: { endpoint: string; cost: number; count: number }[]
  recent: AiUsageRow[]
}

function monthStartISO(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

// ---- Usage breakdown (admin): who is spending, over a chosen time range ----

export type UsageRange = 'month' | '30d' | '90d' | 'all'

export const USAGE_RANGES: { key: UsageRange; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'all', label: 'All time' },
]

/** Start of a range as ISO, or null for "all time" (no lower bound). */
function rangeStartISO(range: UsageRange): string | null {
  const now = new Date()
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  if (range === '30d') return new Date(now.getTime() - 30 * 86_400_000).toISOString()
  if (range === '90d') return new Date(now.getTime() - 90 * 86_400_000).toISOString()
  return null
}

export interface AiUsageBreakdown {
  total: number
  count: number
  byEndpoint: { endpoint: string; cost: number; count: number }[]
  byUser: { user: string; cost: number; count: number }[]
}

/** AI spend over a chosen range, grouped by feature AND by person. Admin-only
 *  view (rendered on the analyst-gated Admin page). */
export function useAiUsageBreakdown(range: UsageRange) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['ai-usage-breakdown', range],
    queryFn: async (): Promise<AiUsageBreakdown> => {
      let query = supabase.from('ai_usage').select('endpoint, user_email, cost_usd, created_at')
      const since = rangeStartISO(range)
      if (since) query = query.gte('created_at', since)
      const { data, error } = await query
      if (error) throw error
      const rows = (data ?? []) as { endpoint: string; user_email: string | null; cost_usd: number }[]
      const total = rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
      const ep = new Map<string, { cost: number; count: number }>()
      const us = new Map<string, { cost: number; count: number }>()
      for (const r of rows) {
        const e = ep.get(r.endpoint) ?? { cost: 0, count: 0 }
        e.cost += Number(r.cost_usd ?? 0)
        e.count += 1
        ep.set(r.endpoint, e)
        const uk = r.user_email || 'Unknown'
        const u = us.get(uk) ?? { cost: 0, count: 0 }
        u.cost += Number(r.cost_usd ?? 0)
        u.count += 1
        us.set(uk, u)
      }
      return {
        total,
        count: rows.length,
        byEndpoint: [...ep.entries()].map(([endpoint, v]) => ({ endpoint, ...v })).sort((a, b) => b.cost - a.cost),
        byUser: [...us.entries()].map(([user, v]) => ({ user, ...v })).sort((a, b) => b.cost - a.cost),
      }
    },
    retry: false,
    staleTime: 30_000,
  })
}

/** Current calendar month's AI spend, grouped by endpoint, plus recent calls. */
export function useAiUsageSummary() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['ai-usage', 'month'],
    queryFn: async (): Promise<AiUsageSummary> => {
      const { data, error } = await supabase
        .from('ai_usage')
        .select('created_at, endpoint, model, user_email, cost_usd')
        .gte('created_at', monthStartISO())
        .order('created_at', { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as AiUsageRow[]
      const total = rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
      const map = new Map<string, { cost: number; count: number }>()
      for (const r of rows) {
        const e = map.get(r.endpoint) ?? { cost: 0, count: 0 }
        e.cost += Number(r.cost_usd ?? 0)
        e.count += 1
        map.set(r.endpoint, e)
      }
      const byEndpoint = [...map.entries()]
        .map(([endpoint, v]) => ({ endpoint, ...v }))
        .sort((a, b) => b.cost - a.cost)
      return { total, count: rows.length, byEndpoint, recent: rows.slice(0, 12) }
    },
    retry: false,
    staleTime: 30_000,
  })
}
