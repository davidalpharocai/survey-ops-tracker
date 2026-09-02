'use client'
import { Caret } from '@/components/shared/Caret'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { FieldCell, DateCell, NumberCell, RateCell, TextCell } from './fields'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import {
  useProjectBlasts,
  useAddBlast,
  useUpdateBlast,
  useDeleteBlast,
  type Blast,
} from '@/lib/hooks/useProjectBlasts'
import {
  blastCost,
  unknownCostBlasts,
  sendCost,
  blastAllInCost,
  totalBidDollars,
  totalSendDollars,
  unknownSendBlasts,
} from '@/lib/utils/blast'
import type { SurveyProject } from '@/lib/hooks/useProjects'

const TIP = {
  header:
    'Log each B2B blast. It costs TWO things and both count toward the project’s spend: the reward ($/bid × completes — paid only for people who finished) and the send ($/send × # people — paid for every message that went out, answered or not). Leave a figure blank until you actually know it: blank means “not recorded”, which is not the same as 0.',
  sent: 'When the blast actually went out — pick the date and time (AM/PM).',
  people:
    'How many messages this blast sent. DRIVES THE SEND COST (# people × $/send) and is the denominator of the completion rate. Counts sends, not unique people: re-sending to the same list adds to this every time, and is charged every time. Blank = not recorded; 0 means it genuinely reached nobody.',
  completes:
    'How many of those people completed the survey. Trickles in for days after the send — fill it in when you know. Blank = NOT RECORDED YET, and the cost then shows as unknown; 0 means the blast really produced nothing. Cost = $/bid × completes.',
  bid: 'The per-completion reward (dollars paid per completed response). $/bid × completes = this blast’s REWARD cost, one of its two costs. Blank = not recorded; 0 means an unpaid send.',
  costPerSend:
    'What it costs to send ONE message on this blast — currently $0.02 across the board. Charged per send, not per person: three reminder passes over the same list are charged three times. This is NOT the cost of buying the contacts (that goes in Other costs as a flat fee); it is the cost of sending to them. Stored per blast, so changing the standard rate later re-prices new blasts and leaves this one alone.',
  cost: 'Everything this blast cost = the reward ($/bid × completes) plus the send ($/send × # people). Both feed the project’s actual spend. Shows “not recorded” while any figure it needs is still blank — an unknown cost is never displayed as $0.',
  note: 'Optional note on who this blast targeted — e.g. “3PL companies + retailers”. Doesn’t affect the cost.',
}

function money(v: number): string {
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/** Money to the cent. The send cost needs it: at $0.02 a message the figure is
 *  almost never a whole number, and rounding 95,788 × $0.02 to "$1,916" makes a
 *  reader reconciling against an invoice think the app is wrong. */
function money2(v: number): string {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * The Money-section blast display for B2B / Rerun projects. Mirrors
 * `NSegmentsEditor`: a collapsible subheader with a right-aligned "+ Log blast",
 * one inset block per blast (fields wired straight through the blast hooks), and
 * a ✕ remove with a session-level Undo bar. A blast costs TWO things (095) —
 * the reward, $/bid × completes, and the send, $/send × # people — shown via
 * `blastAllInCost`, which returns null (rendered "not recorded") while EITHER
 * half is blank, with each half also displayed on its own so a known one is
 * never hidden by an unknown one. The DB trigger recomputes `actual_spend`.
 */
export function BlastBlocks({ project }: { project: SurveyProject }) {
  const supabase = createClient()
  const { data: blasts, isError } = useProjectBlasts(project.id)
  const add = useAddBlast(project.id)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  const [expanded, setExpanded] = useState(true)
  // Session-level Undo: the last-removed blast's payload. Cleared when re-added
  // or replaced by a newer removal.
  const [undo, setUndo] = useState<Blast | null>(null)

  if (isError) {
    return (
      <div className="border-t border-border pt-3 mt-1">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Blasts</p>
        <p className="text-xs text-muted-foreground/70">Blasts need the latest database migration.</p>
      </div>
    )
  }

  const list = blasts ?? []
  const count = list.length
  const unknown = unknownCostBlasts(list)
  // Tracked separately from `unknown`: a blast can have a known send cost and an
  // unknown reward, and vice versa. Collapsing them would either over-warn or
  // hide a real gap.
  const unknownSend = unknownSendBlasts(list)
  const rewardTotal = totalBidDollars(list)
  const sendTotalAll = totalSendDollars(list)
  // How many blasts are missing ANY figure their cost needs. NOT
  // Math.max(unknown, unknownSend): those count two independent sets, so two
  // blasts with opposite gaps would report "1 of 2 incomplete". blastAllInCost
  // is null exactly when either half is unknown, which is the union.
  const incompleteCount = list.filter(b => blastAllInCost(b) == null).length
  // Completes actually written down, treating null as 0 — the sum data-health
  // check 7b uses. Zero here alongside a project that HAS collected N is the
  // legacy "nobody entered them" signal (see the second banner below).
  const recordedCompletes = list.reduce((n, b) => n + (b.completes ?? 0), 0)

  // The per-block ✕ deletes via its own useDeleteBlast; here we just stash the
  // removed blast so the Undo bar can re-add it.
  function handleRemove(blast: Blast) {
    setUndo(blast)
  }

  function handleUndo() {
    if (!undo) return
    add.mutate(
      {
        bid: undo.bid,
        people: undo.people,
        completes: undo.completes,
        // Restored explicitly, INCLUDING when it is null. Omitting it lets the
        // column default fire, which reprices the blast at today's configured
        // rate — wrong for an SMS blast typed at a different rate, and wrong for
        // one deliberately left unrecorded (it would also retract the "this
        // total is a floor" warning).
        cost_per_send: undo.cost_per_send,
        blast_at: undo.blast_at,
        note: undo.note,
        created_by: undo.created_by ?? userName,
      },
      { onSuccess: () => setUndo(null) },
    )
  }

  return (
    <div className="border-t border-border pt-3 mt-1">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            <Caret open={expanded} className="text-primary" />
            Blasts · {count}
          </button>
          <InfoTooltip text={TIP.header} />
        </span>
        {/* bid / people / completes are OMITTED from the insert, not sent as null,
            and that is what makes this correct on both sides of migration 091.
            Pre-091 the columns are still `not null default 0`, so an explicit
            null would be rejected and "+ Log blast" would be dead for everyone
            until David runs the SQL; omitting lets the old defaults fire and
            nothing changes. Post-091 the defaults are gone, so omitting is
            exactly how a blast is born "not recorded" — which is the honest
            state at the moment of logging, since completes cannot be known yet. */}
        <button
          onClick={() => add.mutate({ blast_at: null, note: '', created_by: userName })}
          disabled={add.isPending}
          className="text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          {add.isPending ? 'Adding…' : '+ Log blast'}
        </button>
      </div>

      {undo && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          <span>Removed blast{undo.note ? ` “${undo.note}”` : ''}.</span>
          <button onClick={handleUndo} className="shrink-0 font-medium text-foreground/80 hover:text-foreground">
            ↩ Undo
          </button>
        </div>
      )}

      {/* The project's spend (and every margin figure derived from it) is
          Σ(bid × completes) + Σ(people × $/send), so a blast whose figures aren't in yet contributes
          nothing and the total silently understates what we actually spent. Say
          so here rather than letting Budget left, a few rows down in this same
          Money section, look healthy. */}
      {unknown > 0 && (
        <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[12px] text-amber-700 dark:text-amber-400">
          ⚠ {unknown} of {count} blast{count === 1 ? '' : 's'} {unknown === 1 ? 'has' : 'have'} no cost recorded
          yet — the project&rsquo;s spend excludes {unknown === 1 ? 'it' : 'them'}, so it is a floor, not the
          total. Fill in whichever is blank — $/bid and # completes for the reward, # people for the send.
        </p>
      )}

      {/* THE LEGACY CASE, and the one that actually matters right now.
          The banner above keys off NULL, which only exists on blasts logged after
          migration 091. The eight projects that prompted this whole change have a
          stored 0 instead — indistinguishable from a real zero, deliberately not
          backfilled because guessing which zeros were real would destroy
          information. So they would get no warning at all, on precisely the
          screens where ~$2,500 of real spend is missing.
          This is the same inference data-health check 7b makes: the project
          collected N, so completes plainly arrived, yet every blast says zero.
          That is provably unrecorded rather than a genuine nil result. Putting it
          here rather than only in the connector means it is in front of the
          person who can actually fix it, at the moment they are looking. */}
      {unknown === 0 && count > 0 && recordedCompletes === 0 && (project.n_collected ?? 0) > 0 && (
        <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[12px] text-amber-700 dark:text-amber-400">
          ⚠ This project collected {(project.n_collected ?? 0).toLocaleString('en-US')} responses, but every
          blast here records 0 completes — so its blast spend reads $0 and the completion rate reads 0%.
          Those completes were almost certainly never entered. Fill them in and the money corrects itself.
        </p>
      )}

      {/* The project total, split the way the cost actually splits. David asked
          for the send cost "on the blast segment and as a whole", and the whole
          is where it lands hardest: across the portfolio the send side is
          thousands of dollars that were previously invisible, and on PR00309 it is the ENTIRE
          cost of the project — $1,916 of sends against no recorded completes.
          Shown outside the `expanded` guard on purpose: the number that moved
          the budget should not be hidden behind a disclosure triangle. */}
      {count > 0 && (
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-[12px]">
          <span className="text-muted-foreground">
            Reward <span className="font-medium text-foreground tabular-nums">{money2(rewardTotal)}</span>
            {' · '}
            Send <span className="font-medium text-foreground tabular-nums">{money2(sendTotalAll)}</span>
          </span>
          <span className="text-muted-foreground">
            Blast total{' '}
            <span className="font-medium text-foreground tabular-nums">{money2(rewardTotal + sendTotalAll)}</span>
            {/* Both totals mirror the SQL, so an unrecorded figure contributes
                zero to them. Saying which ones are missing is the difference
                between a total and a floor. */}
            {(unknown > 0 || unknownSend > 0) && (
              <span className="ml-1 text-amber-700 dark:text-amber-400">
                — a floor; {incompleteCount} of {count} incomplete
              </span>
            )}
          </span>
        </div>
      )}

      {expanded && (
        <div className="flex flex-col gap-2">
          {list.map((b, i) => (
            <BlastBlock key={b.id} blast={b} index={i} onRemove={handleRemove} />
          ))}
          {count === 0 && (
            <p className="text-xs text-muted-foreground/60">No blasts logged yet — use + Log blast.</p>
          )}
        </div>
      )}
    </div>
  )
}

/** One editable blast: sent date-time, reach, completes, $/bid, a read-only cost,
 *  and a description — each cell writes through useUpdateBlast. The ✕ hands the
 *  whole row up for session-level Undo and deletes it. */
function BlastBlock({
  blast,
  index,
  onRemove,
}: {
  blast: Blast
  index: number
  onRemove: (b: Blast) => void
}) {
  const update = useUpdateBlast(blast.project_id)
  const del = useDeleteBlast(blast.project_id)
  const save = (updates: Partial<Blast>) => update.mutate({ id: blast.id, updates })
  // The two halves separately as well as together: each can be known while the
  // other is not, and the breakdown line says so per half.
  const reward = blastCost(blast)
  const send = sendCost(blast)
  const allIn = blastAllInCost(blast)

  function remove() {
    onRemove(blast)
    del.mutate(blast.id)
  }

  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5">
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Blast {index + 1}
        </span>
        <button
          onClick={remove}
          title="Remove blast"
          className="shrink-0 text-sm text-muted-foreground/50 transition-colors hover:text-red-600 dark:hover:text-red-400"
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextCell
            label="Description"
            tooltip={TIP.note}
            value={blast.note}
            placeholder="e.g. 3PL companies + retailers"
            onSave={v => save({ note: v || null })}
          />
        </div>
        <DateCell
          label="Sent"
          tooltip={TIP.sent}
          mode="datetime"
          value={blast.blast_at}
          onSave={iso => save({ blast_at: iso })}
        />
        {/* Clearing a cell hands NumberCell's null straight through instead of
            coercing it to 0 — that null IS the "not recorded" state (migration
            091), and `v ?? 0` is precisely how a blank became an indistinguishable
            zero in the first place. NumberCell already renders null as "— set",
            so an unrecorded figure reads as absent, never as a result. */}
        <NumberCell label="$ / bid" tooltip={TIP.bid} value={blast.bid} onSave={v => save({ bid: v })} />
        <NumberCell
          label="# people (reach)"
          tooltip={TIP.people}
          value={blast.people}
          onSave={v => save({ people: v })}
        />
        <NumberCell
          label="# completes"
          tooltip={TIP.completes}
          value={blast.completes}
          onSave={v => save({ completes: v })}
        />
        {/* Editable, and pre-filled by the database rather than by this form:
            095 makes the column default the CURRENT configured rate, so a blast
            is born priced correctly and nobody has to remember to type $0.02.
            Editable anyway because SMS almost certainly is not $0.02 — this
            project's own blast list already contains SMS sends. */}
        {/* RateCell, NOT NumberCell. NumberCell commits through commitNumber,
            which Math.rounds, so $0.02 would save as 0 -- and because it seeds
            from the stored value and commits on blur, merely opening this cell
            and clicking away would zero the rate. 0 is a LEGAL rate after 095
            (an owned list), so nothing downstream would flag it: the row would
            read "send $0.00" as a fact and the project would quietly lose the
            whole send cost. On PR00309 that is $1,915.76 destroyed by a stray
            click. CostLines and PricingWidget both hit this and both wrote it
            down; RateCell exists so the fourth caller does not repeat it. */}
        <RateCell
          label="$ / send"
          tooltip={TIP.costPerSend}
          value={blast.cost_per_send}
          onSave={v => save({ cost_per_send: v })}
        />
        {/* The DISPLAY functions, not the SQL-mirroring ones: blastTotal and
            sendTotal return 0 for an unrecorded blast, and "$0" on screen is read
            as a result — a send that cost us nothing. An unknown cost has to say
            it is unknown.

            money2 rather than money throughout, because the breakdown underneath
            is in cents and at $0.02 a send almost no total is a whole number: a
            "$1,916" headline above "reward $0.00 · send $1,915.76" reads as an
            app that cannot add up. */}
        <FieldCell
          label="Cost"
          tooltip={TIP.cost}
          computed="($ / bid × # completes) + ($ / send × # people)"
        >
          {allIn == null ? (
            <span className="text-muted-foreground/60">— not recorded</span>
          ) : (
            <span className="tabular-nums">{money2(allIn)}</span>
          )}
          {/* The breakdown, always, even when the total is unknown — especially
              then. A blast can have a fully known send cost and no completes at
              all (PR00309 is $1,916 of sends against zero recorded completes),
              and collapsing that to a bare "— not recorded" hides real money that
              IS known. Each half says its own state. */}
          <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
            reward {reward == null ? '—' : money2(reward)} · send{' '}
            {send == null ? '—' : money2(send)}
          </span>
        </FieldCell>
      </div>
    </div>
  )
}
