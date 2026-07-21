'use client'
import { useState } from 'react'
import {
  useAppConfig,
  useUpdateAppConfig,
  useAiUsageSummary,
  useAiUsageBreakdown,
  USAGE_RANGES,
  type UsageRange,
} from '@/lib/hooks/useObservability'
import { formatUsd } from '@/lib/utils/aiCost'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

const ENDPOINT_LABELS: Record<string, string> = {
  assistant: 'Assistant chat',
  'parse-project': 'AI project entry',
}

// Emails render as their local part (david@alpharoc.ai -> "david"); full
// address on hover.
const shortUser = (e: string) => (e.includes('@') ? e.split('@')[0] : e)

export function AiUsagePanel() {
  const { data: cfg, isLoading: cfgLoading, isError: cfgError } = useAppConfig()
  const { data: usage, isLoading: usageLoading } = useAiUsageSummary()
  const update = useUpdateAppConfig()
  const [editingCap, setEditingCap] = useState(false)
  const [draftCap, setDraftCap] = useState('')
  const [range, setRange] = useState<UsageRange>('month')
  const { data: breakdown } = useAiUsageBreakdown(range)

  const heading = 'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center'

  if (cfgError) {
    return (
      <div className="bg-card border border-border shadow-sm rounded-xl p-4">
        <h3 className={heading}>AI usage</h3>
        <p className="text-xs text-muted-foreground/70">AI usage needs the latest database migration (036).</p>
      </div>
    )
  }

  const cap = Number(cfg?.ai_monthly_cap_usd ?? 0)
  const spend = usage?.total ?? 0
  const pct = cap > 0 ? Math.min(100, Math.round((spend / cap) * 100)) : 0
  const over = cap > 0 && spend >= cap
  const near = !over && cap > 0 && spend >= cap * 0.8
  const barColor = over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <h3 className={heading}>
        AI usage
        <InfoTooltip text="What the team's AI features (assistant chat and AI project entry) have cost this calendar month. Set a monthly budget; turn on 'hard stop' to actually pause AI features when the budget is reached (otherwise it's just a warning)." />
      </h3>

      {cfgLoading || usageLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-foreground">
                <span className="text-lg font-semibold">{formatUsd(spend)}</span>
                <span className="text-xs text-muted-foreground"> this month</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {usage?.count ?? 0} call{(usage?.count ?? 0) === 1 ? '' : 's'}
              </span>
            </div>
            {cap > 0 && (
              <>
                <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <p className={`mt-1 text-xs ${over ? 'text-red-500' : near ? 'text-amber-500' : 'text-muted-foreground/70'}`}>
                  {over
                    ? `Over the ${formatUsd(cap)} monthly budget${cfg?.ai_hard_stop ? ' — AI features are paused.' : ' (warning only).'}`
                    : `${pct}% of the ${formatUsd(cap)} monthly budget`}
                </p>
              </>
            )}
          </div>

          {/* Budget controls */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/50 pt-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Monthly budget</span>
              {editingCap ? (
                <>
                  <span className="text-xs text-muted-foreground">$</span>
                  <input
                    type="number"
                    min={0}
                    autoFocus
                    value={draftCap}
                    onChange={e => setDraftCap(e.target.value)}
                    className="w-20 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-ring"
                  />
                  <button
                    onClick={() => {
                      const n = Number(draftCap)
                      if (!isNaN(n) && n >= 0) update.mutate({ ai_monthly_cap_usd: n })
                      setEditingCap(false)
                    }}
                    className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded transition-colors"
                  >
                    Save
                  </button>
                  <button onClick={() => setEditingCap(false)} className="text-xs text-muted-foreground hover:text-foreground px-1">
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setDraftCap(String(cap))
                    setEditingCap(true)
                  }}
                  className="text-sm text-foreground hover:bg-accent rounded px-1.5 transition-colors cursor-pointer"
                  title="Change the monthly AI budget"
                >
                  {formatUsd(cap)}
                </button>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer" title="When on, AI features stop working once the monthly budget is reached, until the budget is raised or the month rolls over.">
              <input
                type="checkbox"
                checked={Boolean(cfg?.ai_hard_stop)}
                onChange={e => update.mutate({ ai_hard_stop: e.target.checked })}
                className="accent-blue-600"
              />
              Hard stop at budget
            </label>
          </div>

          {/* Usage detail — who is spending + on what, over a chosen range */}
          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span className="text-[12px] text-muted-foreground uppercase tracking-wide">Breakdown</span>
              <div className="flex bg-muted border border-border rounded-lg p-0.5 gap-0.5">
                {USAGE_RANGES.map(r => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`text-[12px] px-2 py-0.5 rounded transition-colors ${
                      range === r.key ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {!breakdown || breakdown.count === 0 ? (
              <p className="text-xs text-muted-foreground/60">No AI calls in this period.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  <div>
                    <p className="text-[12px] text-muted-foreground mb-1">By person</p>
                    {breakdown.byUser.map(u => (
                      <div key={u.user} className="flex items-center justify-between py-0.5 text-xs gap-2">
                        <span className="text-muted-foreground truncate" title={u.user}>{shortUser(u.user)}</span>
                        <span className="text-foreground shrink-0">
                          {formatUsd(u.cost)} <span className="text-muted-foreground/60">· {u.count}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-[12px] text-muted-foreground mb-1">By feature</p>
                    {breakdown.byEndpoint.map(e => (
                      <div key={e.endpoint} className="flex items-center justify-between py-0.5 text-xs gap-2">
                        <span className="text-muted-foreground truncate">{ENDPOINT_LABELS[e.endpoint] ?? e.endpoint}</span>
                        <span className="text-foreground shrink-0">
                          {formatUsd(e.cost)} <span className="text-muted-foreground/60">· {e.count}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[12px] text-muted-foreground/70 mt-2">
                  {formatUsd(breakdown.total)} · {breakdown.count} call{breakdown.count === 1 ? '' : 's'} in this period
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
