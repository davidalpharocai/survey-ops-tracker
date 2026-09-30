'use client'

import Link from 'next/link'
import { BarChart } from '@/components/charts'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { fmtNum } from '@/lib/utils/number'
import { formatNRange } from '@/lib/utils/nRange'
import { NO_CAPTAIN } from '@/lib/insights/filters'
import { stageLabel } from '@/lib/utils/stage'
import { DUE_SOON_DAYS, pctText, type InsightsModel, type StageRow, type WorkloadRow } from '@/lib/insights/model'
import { InsightsCard } from './InsightsCard'
import { sideBucketRequest, type DrillRequest, type OpenDrill } from './drill'
import { OpenCount } from './OpenCount'

/**
 * Work open right now: the pipeline by stage, deadlines, and who is carrying
 * what. Kept from the page before the dashboard, because analysts start their
 * day here. The date range does not apply (open work is open whenever it
 * started); type, captain and account do.
 *
 * Every figure opens the exact surveys it counted. Where the List can show the
 * same set, the drill also offers it — and says when it cannot match exactly
 * (the List counts co-captains, and has no type or account filter).
 */
export function RightNow({ model: m, open }: { model: InsightsModel; open: OpenDrill }) {
  const n = m.now
  const f = m.filter
  const words = m.filterWords.length ? ' · ' + m.filterWords.join(' · ') : ''
  const scope = `In flight · right now${words} · ${fmtNum(n.inFlight)} ${n.inFlight === 1 ? 'study' : 'studies'}`
  const listCaptain = f.captain ? (f.captain === NO_CAPTAIN ? 'unassigned' : f.captain) : null

  /** The List link for a set, with the ways the List may differ spelled out. */
  const list = (params: Record<string, string | null>): Pick<DrillRequest, 'listHref' | 'listNote'> => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
    const notes: string[] = []
    if (params.captain && params.captain !== 'unassigned') notes.push('the List also counts studies this person co-captains')
    if (f.type || f.account) notes.push('the List has no type or account filter, so it shows every type and account')
    notes.push('the List shows open, active-phase work')
    return {
      listHref: `/list${qs.toString() ? `?${qs}` : ''}`,
      listNote: `It may differ slightly: ${notes.join('; ')}.`,
    }
  }

  // `key`, `query` and the list filter below carry d.stage RAW: they are the
  // board_column enum value, and a label there would match nothing. Only the
  // two strings a person reads are relabelled.
  const openStage = (d: StageRow) => open({
    key: `stage-${d.stage}`,
    title: `In flight · ${stageLabel(d.stage)}`,
    population: `In flight · ${stageLabel(d.stage)}${words}`,
    query: { kind: 'open', stage: d.stage },
    expected: d.count,
    expectedWhere: 'on the bar',
    ...(d.stage === 'Other' ? {} : list({ stage: d.stage, captain: listCaptain })),
  })
  const openWorkload = (d: WorkloadRow) => open({
    key: `workload-${d.id}`,
    title: `In flight · ${d.name}`,
    population: `In flight · captain ${d.name}${words}`,
    query: { kind: 'open', captain: d.id },
    expected: d.open,
    expectedWhere: 'on the bar',
    ...list({ captain: d.id === NO_CAPTAIN ? 'unassigned' : d.id }),
  })

  const targetIsRange = n.targetMin != null && n.targetMax != null && n.targetMin !== n.targetMax

  return (
    <section className="flex flex-col gap-3" aria-labelledby="right-now-heading">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="right-now-heading" className="flex items-center text-lg font-semibold text-foreground">
          Right now
          <InfoTooltip text="Work open today. The date range above does not apply here — open work is open whenever it started — but the type, captain and account filters do." />
        </h2>
        <span className="text-sm text-muted-foreground">
          {fmtNum(n.inFlight)} in flight ·{' '}
          <OpenCount title="Show the studies on hold" onOpen={() => open(sideBucketRequest(m, 'hold', 'in the header'))}>
            {fmtNum(n.hold)} on hold
          </OpenCount>
          {' · '}
          <OpenCount title="Show the studies still being scoped" onOpen={() => open(sideBucketRequest(m, 'scoping', 'in the header'))}>
            {fmtNum(n.scoping)} still scoping
          </OpenCount>
        </span>
        <Link href="/list" className="text-sm text-primary underline-offset-2 hover:underline">Open the List</Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NowTile
          label="Overdue"
          help="In-flight studies whose due date has passed. A study due today is not overdue yet — it is due this week."
          value={n.overdue}
          tone={n.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}
          sub={n.overdue > 0 ? 'Past the due date — oldest first in the list' : 'Nothing past its due date'}
          openTitle="Show the overdue studies"
          onOpen={() => open({
            key: 'now-overdue', title: 'Overdue', population: `In flight · past the due date${words}`,
            query: { kind: 'open', due: 'overdue' }, expected: n.overdue, expectedWhere: 'in the tile',
            ...list({ due: 'overdue', captain: listCaptain }),
          })}
        />
        <NowTile
          label="Due this week"
          help={`In-flight studies due today or in the next ${DUE_SOON_DAYS - 1} days — the same rule as the List's "due this week".`}
          value={n.dueSoon}
          sub={`Today to ${DUE_SOON_DAYS - 1} days out`}
          openTitle={`Show the studies due in the next ${DUE_SOON_DAYS} days`}
          onOpen={() => open({
            key: 'now-soon', title: `Due in the next ${DUE_SOON_DAYS} days`, population: `In flight · due today to ${DUE_SOON_DAYS - 1} days out${words}`,
            query: { kind: 'open', due: 'soon' }, expected: n.dueSoon, expectedWhere: 'in the tile',
            ...list({ due: 'week', captain: listCaptain }),
          })}
        />
        <NowTile
          label="Behind target"
          help="Studies in Fielding that have collected fewer responses than their minimum N target so far. Not necessarily late — just not there yet."
          value={n.behind}
          tone={n.behind > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}
          sub="In Fielding, short of the minimum N"
          openTitle="Show the fielding studies still short of their minimum N"
          onOpen={() => open({
            key: 'now-behind', title: 'Behind target in Fielding', population: `In flight · Fielding · short of the minimum N${words}`,
            query: { kind: 'open', behind: true }, expected: n.behind, expectedWhere: 'in the tile',
          })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InsightsCard
          title="Pipeline by stage"
          help="Where in-flight work sits today, by board column. Click a stage for its studies."
          scope={scope}
          verdict={
            <>
              {n.stageVerdict}
              {n.collectionPct != null && (
                <> Across in-flight studies with an N target, {fmtNum(n.collected)} of {formatNRange(n.targetMin, n.targetMax)} responses are in ({pctText(n.collectionPct)}{targetIsRange ? ' of the minimum' : ''}).</>
              )}
              {n.collectionPct != null && n.untargeted > 0 && (
                <>
                  {' '}Left out of that: {fmtNum(n.untargeted)} in-flight {n.untargeted === 1 ? 'study' : 'studies'} with no N target
                  {n.untargetedCollected > 0 ? `, holding ${fmtNum(n.untargetedCollected)} response${n.untargetedCollected === 1 ? '' : 's'}` : ''}.
                </>
              )}
            </>
          }
        >
          <BarChart
            ariaLabel="In-flight studies by stage"
            data={n.byStage}
            label={d => stageLabel(d.stage)}
            labelHeader="Stage"
            value={d => d.count}
            valueName="Studies"
            note={d => d.help}
            color="var(--chart-cat-1)"
            emptyMessage="Nothing in flight in this view"
            onSelect={openStage}
          />
        </InsightsCard>

        <InsightsCard
          title="Workload by captain"
          help="In-flight studies per lead captain, with how many are overdue. A study with no captain needs an owner. Click a bar for the studies."
          scope={scope}
          verdict={n.workloadVerdict}
        >
          <BarChart
            ariaLabel="In-flight studies by captain"
            data={n.workload}
            label={d => (d.id === NO_CAPTAIN ? 'No captain' : d.name)}
            labelHeader="Captain"
            value={d => d.open}
            valueName="In flight"
            valueLabel={{
              name: 'In flight · overdue',
              text: d => (d.overdue ? `${fmtNum(d.open)} · ${fmtNum(d.overdue)} overdue` : fmtNum(d.open)),
              description: 'Open studies, and how many are past their due date',
            }}
            color={d => (d.id === NO_CAPTAIN ? 'var(--chart-loss)' : 'var(--chart-cat-1)')}
            note={d => (d.id === NO_CAPTAIN ? 'These studies need a captain' : null)}
            emptyMessage="Nobody has open work in this view"
            onSelect={openWorkload}
          />
        </InsightsCard>
      </div>
    </section>
  )
}

/** A deadline tile. The number is the button that opens the surveys; the (i)
 *  sits beside the label, outside it (a button inside a button is invalid). */
function NowTile({ label, help, value, tone = 'text-foreground', sub, openTitle, onOpen }: {
  label: string
  help: string
  value: number
  tone?: string
  sub: string
  openTitle: string
  onOpen: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card p-3">
      <span className="flex items-center text-xs text-muted-foreground">{label}<InfoTooltip text={help} /></span>
      <button
        type="button"
        onClick={onOpen}
        title={openTitle}
        className={`self-start text-left text-2xl font-semibold tabular-nums underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none ${tone}`}
      >
        {fmtNum(value)}
      </button>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  )
}
