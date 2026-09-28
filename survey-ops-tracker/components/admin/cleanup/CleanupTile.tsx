'use client'

import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import {
  GROUP_LABEL, SEVERITY_LABEL, SEVERITY_TONE, SOURCE_LABEL,
  type CheckResult,
} from '@/lib/admin/cleanup'
import { tileState } from './order'

/**
 * One check, as a number you can click.
 *
 * ── THREE STATES, AND THEY MUST NOT LOOK ALIKE ──────────────────────────────
 *   · WORK — a count, big, and a red or amber severity chip. Clickable.
 *   · CLEAR — zero. Settled: a tick, the word "Clear", a green rule, and the
 *     number stepped back rather than shouted. David's goal state is every tile
 *     at zero, and a goal state has to feel like one; a dashboard where the
 *     finished tiles look exactly like the unfinished ones gives no reward for
 *     the work and no way to see progress at a glance.
 *   · BLOCKED — the source did not load. It shows a DASH, never 0, and names
 *     the read that failed. "We could not measure this" and "there is nothing
 *     wrong" are different sentences and this tile refuses to conflate them.
 *
 * ── THE RERUN SPLIT ─────────────────────────────────────────────────────────
 * David, asked how repeat waves should appear: "70 surveys, plus 48 rerun waves
 * not yet picked up". The headline is the actionable count; the waves are
 * stated beside it in words, on the tile, never folded in and never hidden.
 *
 * With ONE exception, and it is the reason the headline is not simply `count`:
 * a tile whose every failure is a repeat wave has an actionable count of zero
 * while being amber, clickable and not clear. Printing a lone "0" there says the
 * opposite of what the tile's own state says, on a dashboard whose contract is
 * "every tile should be 0". So that tile reads "0 + 22" — nothing hidden,
 * nothing claimed as finished.
 */
export function CleanupTile({ result, onOpen }: {
  result: CheckResult
  onOpen: (id: string) => void
}) {
  const { check } = result
  const state = tileState(result)
  const help = `${check.help} ${check.why}`
  /** Work to do, and every bit of it is a repeat wave. */
  const wavesOnly = state === 'work' && result.count === 0 && result.waveCount > 0

  const frame =
    state === 'blocked'
      ? 'border-amber-500/40 bg-amber-500/5'
      : state === 'clear'
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-border bg-card hover:border-ring hover:bg-accent/40'

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[11px] px-1.5 py-0.5 rounded border ${SEVERITY_TONE[check.severity]}`}>
            {SEVERITY_LABEL[check.severity]}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {GROUP_LABEL[check.group]}
          </span>
        </span>
        <InfoTooltip text={help} />
      </div>

      <p className="text-sm font-medium text-foreground mt-2 leading-snug">{check.label}</p>

      {state === 'blocked' ? (
        <>
          <p className="text-3xl font-semibold text-muted-foreground mt-1 leading-none">—</p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1.5 leading-snug">
            Not measured — {result.blockedBy.map(s => SOURCE_LABEL[s]).join(' and ')} did not load.
          </p>
        </>
      ) : (
        <>
          <p
            className={`text-3xl font-semibold mt-1 leading-none tabular-nums ${
              state === 'clear' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
            }`}
          >
            {state === 'clear'
              ? '✓ 0'
              : wavesOnly
                ? `0 + ${fmtNum(result.waveCount)}`
                : fmtNum(result.count)}
          </p>
          <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
            {state === 'clear' ? (
              <span className="text-emerald-700 dark:text-emerald-400">
                Clear{result.applies > 0 ? ` — all ${fmtNum(result.applies)} checked` : ' — nothing to check'}
              </span>
            ) : wavesOnly ? (
              <>
                no survey fails this, of {fmtNum(result.applies)} checked
                <br />
                <span className="text-muted-foreground/90">
                  plus {fmtNum(result.waveCount)} rerun{' '}
                  {result.waveCount === 1 ? 'wave' : 'waves'} not yet picked up
                </span>
              </>
            ) : (
              <>
                {result.count === 1 ? 'survey' : 'surveys'}, of {fmtNum(result.applies)} checked
                {result.waveCount > 0 && (
                  <>
                    <br />
                    <span className="text-muted-foreground/90">
                      plus {fmtNum(result.waveCount)} rerun{' '}
                      {result.waveCount === 1 ? 'wave' : 'waves'} not yet picked up
                    </span>
                  </>
                )}
              </>
            )}
          </p>
        </>
      )}
    </>
  )

  const shell = `text-left border rounded-xl p-3 shadow-sm flex flex-col transition-colors ${frame}`

  // A settled or unmeasurable tile has nothing to drill into, so it is not a
  // control. A disabled button would still be announced as one, and there is
  // nothing behind it to reach.
  if (state !== 'work') {
    return (
      <div className={shell} data-testid={`tile-${check.id}`} data-state={state}>
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(check.id)}
      className={`${shell} cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      data-testid={`tile-${check.id}`}
      data-state={state}
      title={`Open the ${fmtNum(result.count + result.waveCount)} surveys behind "${check.label}"`}
    >
      {body}
      <span className="text-xs text-primary mt-2">See the surveys →</span>
    </button>
  )
}
