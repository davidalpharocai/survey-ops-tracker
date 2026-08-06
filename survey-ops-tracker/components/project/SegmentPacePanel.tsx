'use client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import type { SegmentPaceRow } from '@/lib/utils/insights'

const card = 'bg-card border border-border shadow-sm rounded-xl p-3'
const sectionTitle = 'text-xs uppercase tracking-widest text-muted-foreground font-medium mb-2 flex items-center'

function pctStr(v: number | null): string {
  return v == null ? '—' : `${Math.round(v)}%`
}

/**
 * Per-segment progress + pace, shown only for multi-segment projects. Each segment
 * is measured against ITS OWN target, so a total-N that looks complete can't hide a
 * segment that's behind. Rows are pre-computed via segmentPaces (pure).
 */
export function SegmentPacePanel({ rows, delivered }: { rows: SegmentPaceRow[]; delivered: boolean }) {
  if (rows.length < 2) return null
  const behind = rows.filter((r) => r.onTrack === false).length
  return (
    <div className={card}>
      <p className={sectionTitle}>
        Segment pace
        <InfoTooltip text="Each segment is paced against ITS OWN target using the project's launch + due dates (segments share the project timeline). A total N at or over target can still hide a segment that's behind — over-collecting one segment doesn't cover a shortfall in another." />
        <span
          className={`ml-auto normal-case tracking-normal font-medium ${
            behind ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
          }`}
        >
          {behind ? `${behind} behind` : delivered ? 'all met' : 'all on pace'}
        </span>
      </p>

      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 text-[12px] items-center">
        <span className="text-muted-foreground">segment</span>
        <span className="text-muted-foreground text-right w-24">collected / target</span>
        <span className="text-muted-foreground text-right w-24">{delivered ? 'final' : 'proj. by due'}</span>
        <span className="text-muted-foreground text-right w-16">status</span>
        {rows.map((r, i) => {
          const frac = r.target != null && r.target > 0 ? Math.min(1, r.collected / r.target) : 0
          const status =
            r.onTrack == null ? (
              <span className="text-muted-foreground">—</span>
            ) : r.onTrack ? (
              <span className="text-emerald-600 dark:text-emerald-400">{delivered ? 'met' : 'on track'}</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">{delivered ? 'short' : 'behind'}</span>
            )
          return (
            <div key={i} className="contents">
              <div className="min-w-0">
                <span className="text-foreground truncate block">{r.label}</span>
                <div className="h-1 rounded-full bg-muted overflow-hidden mt-0.5">
                  <div
                    className={`h-full rounded-full ${r.onTrack === false ? 'bg-amber-500/70' : 'bg-primary/70'}`}
                    style={{ width: `${frac * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-right tabular-nums text-foreground">
                {fmtNum(r.collected)}
                {r.target != null ? ` / ${fmtNum(r.target)}` : ''}
                <span className="text-muted-foreground"> · {pctStr(r.pct)}</span>
              </span>
              <span className="text-right tabular-nums text-foreground">
                {delivered
                  ? pctStr(r.pct)
                  : r.projectedPct != null
                    ? pctStr(r.projectedPct)
                    : r.perDay != null
                      ? `${fmtNum(Math.round(r.perDay))}/day`
                      : '—'}
              </span>
              <span className="text-right">{status}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
