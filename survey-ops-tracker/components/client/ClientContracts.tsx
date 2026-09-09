'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Caret } from '@/components/shared/Caret'
import { useCurrentMember } from '@/lib/hooks/useCurrentMember'
import { useCanViewFinancials } from '@/lib/hooks/useCapabilities'
import { fmtNum } from '@/lib/utils/number'
import { rollUp, describeConsumption } from '@/lib/sales/credits'
import {
  useClientTerms, useCreateClientTerm, useUpdateClientTerm, useDeleteClientTerm,
  useTermDollars, useSetTermDollars, type ClientTerm,
} from '@/lib/hooks/useClientTerms'

const TIP = {
  header:
    'The contracts this client has bought — each one an allowance of CREDITS with a start and a renewal date. A survey draws down its contract by the credits on the survey, so this is what a salesperson shows the client when they ask how much of their commitment is left.',
  credits:
    'How many credits the contract bought. Leave it blank if the contract does not state one — blank means "not recorded", which is different from a contract that bought zero.',
  dollars:
    'What the contract is worth in dollars. Finance only — it is stored in a separate table the database gates on the finance capability, so analysts and salespeople cannot read it even directly.',
  dates:
    'When the contract starts and when it renews. Both optional: 44 of the 48 contracts in the CCM export carry no date at all, so requiring one would make them unimportable.',
  used:
    'Credits drawn down by the surveys attached to this contract. A survey with no credit figure is NOT counted as zero — it is unpriced, and the figure below says so, because a total that silently treats unpriced work as free is the wrong number to show a client.',
}

interface Draft {
  name: string
  credits_total: string
  dollars_total: string
  starts_on: string
  renews_on: string
  note: string
}

const empty: Draft = { name: '', credits_total: '', dollars_total: '', starts_on: '', renews_on: '', note: '' }

const toDraft = (t: ClientTerm, dollars: number | null | undefined): Draft => ({
  name: t.name,
  credits_total: t.credits_total == null ? '' : String(t.credits_total),
  dollars_total: dollars == null ? '' : String(dollars),
  starts_on: t.starts_on ?? '',
  renews_on: t.renews_on ?? '',
  note: t.note ?? '',
})

/** Blank stays NULL. Parsing '' as 0 is how "not recorded" becomes "bought
 *  nothing", which is the distinction this whole card is careful about. */
const num = (s: string): number | null => {
  const t = s.trim().replace(/[$,]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function ContractForm({
  draft, setDraft, onSave, onCancel, saving, canFinance,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  canFinance: boolean
}) {
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft({ ...draft, [k]: e.target.value })
  const field = 'w-full rounded border border-border bg-background px-2 py-1 text-sm focus:border-ring focus:outline-none'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-2.5">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Name</span>
        <input
          autoFocus value={draft.name} onChange={set('name')}
          placeholder="e.g. 2026 Contract" className={field}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="flex items-center text-[11px] text-muted-foreground">
            Credits <InfoTooltip text={TIP.credits} />
          </span>
          <input
            value={draft.credits_total} onChange={set('credits_total')}
            inputMode="numeric" placeholder="e.g. 150" className={field}
          />
        </label>
        {/* Rendered only for the finance capability. Not disabled — absent. A
            greyed-out box tells a salesperson the number exists. */}
        {canFinance && (
          <label className="flex flex-col gap-1">
            <span className="flex items-center text-[11px] text-muted-foreground">
              Value $ <InfoTooltip text={TIP.dollars} />
            </span>
            <input
              value={draft.dollars_total} onChange={set('dollars_total')}
              inputMode="decimal" placeholder="finance only" className={field}
            />
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="flex items-center text-[11px] text-muted-foreground">
            Starts <InfoTooltip text={TIP.dates} />
          </span>
          <input type="date" value={draft.starts_on} onChange={set('starts_on')} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Renews</span>
          <input type="date" value={draft.renews_on} onChange={set('renews_on')} className={field} />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Note (internal)</span>
        <textarea value={draft.note} onChange={set('note')} rows={2} className={field} />
      </label>

      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving || !draft.name.trim()}
          className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
        {!draft.name.trim() && <span className="text-[11px] text-muted-foreground/70">A name is required.</span>}
      </div>
    </div>
  )
}

/**
 * Contracts on a client, with the credit consumption each one has drawn.
 *
 * ON THE ANALYST CLIENT PAGE, not the sales portal. Creating a contract is an
 * internal act — sales READS its own accounts' contracts through the
 * finance-free sales_terms view (105) and cannot write. Putting the form here
 * keeps the one writable surface behind the analyst tier.
 *
 * Consumption is computed with the same rollUp() the sales account page uses, so
 * the number David sees and the number Alex shows a client are the same
 * function, not two implementations that agree today.
 */
export function ClientContracts({ clientId }: { clientId: string }) {
  const supabase = createClient()
  const { data: terms = [], isLoading, isError } = useClientTerms(clientId)
  const create = useCreateClientTerm(clientId)
  const update = useUpdateClientTerm(clientId)
  const del = useDeleteClientTerm(clientId)
  const setDollars = useSetTermDollars()
  const { data: member } = useCurrentMember()
  const canFinance = useCanViewFinancials()
  const { data: dollars = {} } = useTermDollars(terms.map(t => t.id))

  const [expanded, setExpanded] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(empty)

  // The surveys attached to each contract, for the drawdown. Only the two
  // columns the arithmetic needs.
  const { data: surveys = [] } = useQuery({
    queryKey: ['client-term-surveys', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select('id, credits, term_id')
        .eq('client_id', clientId)
        .is('deleted_at', null)
      if (error) throw error
      return (data ?? []) as { id: string; credits: number | null; term_id: string | null }[]
    },
    enabled: !!clientId,
    staleTime: 30_000,
  })

  function save() {
    const fields = {
      name: draft.name.trim(),
      credits_total: num(draft.credits_total),
      starts_on: draft.starts_on || null,
      renews_on: draft.renews_on || null,
      note: draft.note.trim() || null,
    }
    if (editingId) {
      update.mutate({ id: editingId, updates: fields })
      if (canFinance) setDollars.mutate({ termId: editingId, dollars: num(draft.dollars_total) })
      setEditingId(null)
    } else {
      create.mutate(
        { ...fields, source: 'app', created_by: member?.name ?? null },
        {
          onSuccess: t => {
            // The dollars land in a second table, so they can only be written
            // once the term has an id.
            if (canFinance && num(draft.dollars_total) != null) {
              setDollars.mutate({ termId: t.id, dollars: num(draft.dollars_total) })
            }
          },
        },
      )
      setAdding(false)
    }
    setDraft(empty)
  }

  const unattached = surveys.filter(s => s.term_id == null).length

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            <Caret open={expanded} className="text-primary" />
            Contracts · {terms.length}
          </button>
          <InfoTooltip text={TIP.header} />
        </span>
        {!adding && !editingId && (
          <button
            onClick={() => { setDraft(empty); setAdding(true) }}
            className="text-sm font-medium text-primary hover:underline"
          >
            + Add
          </button>
        )}
      </div>

      {isError && <p className="text-xs text-muted-foreground/70">Contracts need the latest database migration.</p>}
      {isLoading && <p className="text-xs text-muted-foreground/60">Loading…</p>}

      {expanded && (
        <div className="flex flex-col gap-2">
          {adding && (
            <ContractForm
              draft={draft} setDraft={setDraft} onSave={save}
              onCancel={() => { setAdding(false); setDraft(empty) }}
              saving={create.isPending} canFinance={canFinance}
            />
          )}

          {terms.map(t =>
            editingId === t.id ? (
              <ContractForm
                key={t.id} draft={draft} setDraft={setDraft} onSave={save}
                onCancel={() => { setEditingId(null); setDraft(empty) }}
                saving={update.isPending} canFinance={canFinance}
              />
            ) : (
              <ContractRow
                key={t.id}
                term={t}
                dollars={dollars[t.id]}
                canFinance={canFinance}
                consumption={rollUp(surveys.filter(s => s.term_id === t.id), t.credits_total ?? null)}
                onEdit={() => { setDraft(toDraft(t, dollars[t.id])); setEditingId(t.id); setAdding(false) }}
                onRemove={() => del.mutate(t.id)}
              />
            ),
          )}

          {!isLoading && !isError && terms.length === 0 && !adding && (
            <p className="text-xs text-muted-foreground/60">
              No contracts recorded. Add one to track credit consumption for this client.
            </p>
          )}

          {/* A contract's drawdown only counts surveys POINTED AT it, so an
              unattached survey is silently absent from every total on this card.
              Say so rather than let the numbers quietly under-report. */}
          {terms.length > 0 && unattached > 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              {unattached} of this client&apos;s {surveys.length} surveys are not attached to a contract, so they
              draw down nothing above.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ContractRow({
  term, dollars, canFinance, consumption, onEdit, onRemove,
}: {
  term: ClientTerm
  dollars: number | null | undefined
  canFinance: boolean
  consumption: ReturnType<typeof rollUp>
  onEdit: () => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const pct = consumption.pct

  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <button onClick={onEdit} className="text-left text-sm font-medium hover:underline">
          {term.name}
        </button>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {term.credits_total != null && <span className="tabular-nums">{fmtNum(term.credits_total)} credits</span>}
          {canFinance && dollars != null && <span className="tabular-nums">${fmtNum(dollars)}</span>}
          <button
            onClick={() => (confirming ? onRemove() : setConfirming(true))}
            onBlur={() => setConfirming(false)}
            className="text-muted-foreground/50 hover:text-destructive"
            title={confirming ? 'Click again to remove' : 'Remove this contract'}
          >
            {confirming ? 'Sure?' : '✕'}
          </button>
        </span>
      </div>

      {(term.starts_on || term.renews_on) && (
        <p className="mb-1.5 text-[11px] text-muted-foreground">
          {term.starts_on ?? '—'} → {term.renews_on ?? 'no renewal date'}
        </p>
      )}

      {pct != null && (
        <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={pct > 100 ? 'h-full bg-red-500' : 'h-full bg-primary'}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      )}
      <p className="flex items-start text-[11px] text-muted-foreground">
        {describeConsumption(consumption)}
        <InfoTooltip text={TIP.used} />
      </p>

      {term.note && <p className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground/80">{term.note}</p>}
    </div>
  )
}
