'use client'

/**
 * One verb group on This week: the verb, its rule, the dollars at stake, the
 * decision rows ranked by those dollars, and — for groups about live or held
 * surveys — Chart C3, a bullet bar per row (spend against the contract value,
 * the budget tick, the 50% goal tick, collected against target).
 *
 * The rows and the bullets are the SAME list in the same order, so the chart is
 * the picture of the decisions beside it, not a second population. Past
 * COLLAPSE_AFTER rows the group shows the top ones and a real "Show all N"
 * button; both the list and the chart expand together.
 */

import { useState } from 'react'
import { BulletChart } from '@/components/charts'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { money } from '@/lib/finance/format'
import { COLLAPSE_AFTER, type Verb, type WeekGroup, type WeekRow } from '@/lib/finance/thisWeek'
import { fmtNum } from '@/lib/utils/number'
import { ProjectLink } from '../tabs/Card'
import { AddNextStep } from './AddNextStep'

/** What the verb's colour means: money still moving (loss red), a record to
 *  fix (the amber goal colour), a sale to make or protect (price teal), and
 *  paused work (muted). Colour is never the only signal — the label says it.
 *
 *  These are CHART tokens, chosen to pass 3:1 as marks. They are used here for
 *  the swatch, the tint and the border — never for the label's text, which is
 *  11px and needs 4.5:1 and so is drawn in the page's own ink. */
const TONE: Record<Verb, string> = {
  freeze: 'var(--chart-loss)',
  confirm: 'var(--chart-loss)',
  stop: 'var(--chart-loss)',
  cap: 'var(--chart-loss)',
  budget: 'var(--chart-goal)',
  price: 'var(--chart-goal)',
  topup: 'var(--chart-price)',
  trial: 'var(--chart-price)',
  series: 'var(--chart-price)',
  hold: 'var(--chart-muted)',
}

export function VerbTag({ verb, label }: { verb: Verb; label: string }) {
  const c = TONE[verb]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-foreground"
      style={{ background: `color-mix(in oklab, ${c} 12%, transparent)`, border: `1px solid color-mix(in oklab, ${c} 35%, transparent)` }}
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
      {label}
    </span>
  )
}

export function DecisionGroup({ group }: { group: WeekGroup }) {
  const [all, setAll] = useState(false)
  const { meta } = group
  const rows = all ? group.rows : group.visible
  const bullets = meta.bullets ? rows.filter(r => r.bullet) : []
  const id = `this-week-${group.verb}`

  return (
    <section aria-labelledby={`${id}-h`} className="border-t border-border px-4 py-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={`${id}-h`} className="flex items-center">
          <VerbTag verb={group.verb} label={meta.label} />
          <InfoTooltip text={meta.help} />
        </h3>
        {!group.blocked.length && !group.pending && group.rows.length > 0 && (
          <>
            <span className="text-xs text-muted-foreground" title="Rows in this group">
              {fmtNum(group.rows.length)} {group.rows.length === 1 ? 'row' : 'rows'}
            </span>
            {group.stakeUnknown === group.rows.length ? (
              <span className="text-xs text-muted-foreground" title="None of these rows has a dollar figure, so there is no total — not $0.">
                No dollar figure on these rows
              </span>
            ) : (
              <span
                className="text-xs font-medium tabular-nums"
                // Honest about its own rows, and only its own rows: a survey
                // can need two or three decisions, so this total and the one
                // on the next group can cover the same money.
                title={group.stakeUnknown
                  ? `The dollars at stake across the rows IN THIS GROUP that have a figure. ${fmtNum(group.stakeUnknown)} ${group.stakeUnknown === 1 ? 'row has' : 'rows have'} none and ${group.stakeUnknown === 1 ? 'is' : 'are'} left out of this total, not counted as $0. A study can need more than one decision, so do not add this total to another group's.`
                  : 'The dollars at stake across the rows in this group. Each row here is a different study or contract, but a study can need more than one decision, so do not add this total to another group’s.'}
              >
                {money(group.stakeTotal)} at stake
                {group.stakeUnknown > 0 && <span className="font-normal text-muted-foreground"> · {fmtNum(group.stakeUnknown)} with no dollar figure</span>}
              </span>
            )}
          </>
        )}
      </header>
      <p className="mt-0.5 text-xs text-muted-foreground">{meta.rule}</p>

      {group.blocked.length > 0 ? (
        <div role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {group.blocked.map(t => <p key={t}>{t}. This check could not run, so it is not shown as clear.</p>)}
        </div>
      ) : group.pending ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">{group.pending}</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing to do among what this check can see.</p>
      ) : (
        <div className={bullets.length ? 'mt-2 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : 'mt-2'}>
          <ol id={`${id}-list`} className="min-w-0 divide-y divide-border/70 rounded-lg border border-border">
            {rows.map(r => <DecisionRow key={r.key} row={r} />)}
          </ol>
          {bullets.length > 0 && (
            <BulletChart
              ariaLabel={`${meta.label}: spend against what each study is worth`}
              info="Teal track: the contract value (price per N × N sold). Navy: spent so far, red past the contract value. Ink tick: the budget. Amber tick: the 50% goal (a guide, not a rule). Thin bar: N collected against the N target. A study with no price or no target shows spend against budget on a hatched track."
              data={bullets}
              label={r => r.code ?? '(no code)'}
              sublabel={r => `${r.account} · ${r.owner}`}
              value={r => r.bullet!.spend}
              max={r => r.bullet!.contract}
              missingMax={r => r.bullet!.missing ?? 'no price'}
              budget={r => r.bullet!.budget}
              goal={r => r.bullet!.goal}
              progress={r => (r.bullet!.target ? { value: r.bullet!.collected ?? 0, target: r.bullet!.target } : null)}
              href={r => `/projects/${r.id}`}
            />
          )}
        </div>
      )}

      {group.note && !group.blocked.length && (
        <p className="mt-2 text-xs text-muted-foreground">{group.note}</p>
      )}

      {group.collapsed && !group.blocked.length && (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={`${id}-list`}
          onClick={() => setAll(v => !v)}
          className="mt-2 rounded text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--chart-price)]"
          title={all ? 'Show only the rows with the most at stake' : 'Every row in this group, still ranked by dollars at stake'}
        >
          {all ? `Show the top ${COLLAPSE_AFTER}` : `Show all ${fmtNum(group.rows.length)}`}
        </button>
      )}
    </section>
  )
}

function DecisionRow({ row }: { row: WeekRow }) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <ProjectLink id={row.id} code={row.code} />
        {row.also.length > 0 && (
          <span className="text-xs text-muted-foreground">
            also{' '}
            {row.also.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ', '}
                <ProjectLink id={a.id} code={a.code} />
              </span>
            ))}
          </span>
        )}
        <span className="text-xs text-muted-foreground" title="The client account">{row.account}</span>
        <span className="text-xs text-muted-foreground" title={row.ownerNote ?? 'The study captain: who owns this decision'}>
          Owner: {row.owner}
        </span>
        <span
          className="ml-auto text-sm font-semibold tabular-nums"
          title={row.stake == null ? 'No dollar figure can be computed for this row; see "At stake".' : row.derived ? 'A derived dollar value of credits — see "At stake" for how it was derived.' : 'Dollars at stake: what this row is ranked by.'}
        >
          {row.stake == null ? '—' : `${row.derived ? '≈' : ''}${money(row.stake)}`}
          {row.derived && <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">derived</span>}
        </span>
      </div>
      <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-[13px] leading-relaxed sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        <dt className="text-xs text-muted-foreground sm:pt-0.5" title="The fact that put this study on the list, computed from its records">What happened</dt>
        <dd>{row.happened}</dd>
        <dt className="text-xs text-muted-foreground sm:pt-0.5" title="The dollars this decision protects or recovers, and how they are measured">At stake</dt>
        <dd>{row.stakeText}</dd>
        <dt className="text-xs text-muted-foreground sm:pt-0.5" title="The action to take. “Add as next step” puts this text on the study’s own next-step list.">What to do</dt>
        <dd className="font-medium">{row.action}</dd>
      </dl>
      <div className="mt-1.5">
        <AddNextStep projectId={row.id} code={row.code} text={row.action} />
      </div>
    </li>
  )
}
