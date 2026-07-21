'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useSuppliers, useAddSupplier } from '@/lib/hooks/useSuppliers'
import {
  useProjectSuppliers,
  useAddProjectSupplier,
  useUpdateProjectSupplier,
  useRemoveProjectSupplier,
  type ProjectSupplier,
} from '@/lib/hooks/useProjectSuppliers'
import {
  useProjectLaunches,
  useAddLaunch,
  useUpdateLaunch,
  useRemoveLaunch,
  type ProjectLaunch,
} from '@/lib/hooks/useProjectLaunches'
import {
  actualCost, totalCollected, launchRange,
  projectEstimateRange, projectActualCost, projectCollected, projectTarget, projectBlendedCpi,
} from '@/lib/utils/suppliers'
import { fmtNum } from '@/lib/utils/number'

function money(v: number): string {
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function rate(v: number | null): string {
  return v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
const inputCls =
  'bg-muted border border-border rounded px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring'

/** One fielding wave: its own supplier rows + target. Estimate range before completes,
 *  actual cost once N collected is entered. */
function LaunchBlock({
  projectId,
  launch,
  rows,
  index,
  catalog,
  userName,
}: {
  projectId: string
  launch: ProjectLaunch
  rows: ProjectSupplier[]
  index: number
  catalog: { id: string; name: string }[]
  userName: string
}) {
  const addProjectSupplier = useAddProjectSupplier(projectId)
  const updateRow = useUpdateProjectSupplier(projectId)
  const removeRow = useRemoveProjectSupplier(projectId)
  const addSupplier = useAddSupplier()
  const updateLaunch = useUpdateLaunch(projectId)
  const removeLaunch = useRemoveLaunch(projectId)

  const [applyCpi, setApplyCpi] = useState('')
  const [newName, setNewName] = useState('')

  const chosenIds = new Set(rows.map((r) => r.supplier_id))
  const available = catalog.filter((s) => !chosenIds.has(s.id))
  const lines = rows.map((r) => ({ cpi: r.cpi, completes_cap: r.completes_cap, n_collected: r.n_collected }))
  const collected = totalCollected(lines)
  const hasCollected = collected > 0
  const actual = actualCost(lines)
  const range = launchRange({ target: launch.target, lines })
  const overTarget = launch.target != null && collected > launch.target

  function addByCatalog(supplierId: string) {
    if (!supplierId) return
    const cpi = parseFloat(applyCpi)
    addProjectSupplier.mutate({ supplier_id: supplierId, launch_id: launch.id, cpi: isNaN(cpi) || cpi < 0 ? 0 : cpi, completes_cap: 1000, created_by: userName })
  }
  function addNewSupplier() {
    const name = newName.trim()
    if (!name) return
    addSupplier.mutate({ name, createdBy: userName }, { onSuccess: (s) => { setNewName(''); addByCatalog(s.id) } })
  }
  function applyToAll() {
    const cpi = parseFloat(applyCpi)
    if (isNaN(cpi) || cpi < 0) return // guard negatives like the inline CPI editor does
    for (const r of rows) if (r.cpi !== cpi) updateRow.mutate({ id: r.id, updates: { cpi } })
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2 flex flex-col gap-1.5">
      {/* Launch header — number, optional date + label, remove */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-foreground whitespace-nowrap">Launch {index + 1}</span>
        <input
          key={`date-${launch.id}-${launch.launch_date ?? ''}`}
          type="date"
          defaultValue={launch.launch_date ?? ''}
          onBlur={(e) => { const v = e.target.value || null; if (v !== (launch.launch_date ?? null)) updateLaunch.mutate({ id: launch.id, updates: { launch_date: v } }) }}
          title="When this launch was fielded (optional)"
          className={`${inputCls} w-32`}
        />
        <input
          key={`label-${launch.id}-${launch.label ?? ''}`}
          defaultValue={launch.label ?? ''}
          placeholder="label (optional)"
          onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (launch.label ?? null)) updateLaunch.mutate({ id: launch.id, updates: { label: v } }) }}
          className={`${inputCls} flex-1 min-w-0`}
        />
        <button onClick={() => removeLaunch.mutate(launch.id)} title="Remove launch" className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 px-0.5">✕</button>
      </div>

      {/* Supplier table */}
      {rows.length > 0 && (
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 text-[11px] text-muted-foreground">
          <span>Supplier</span>
          <span className="w-16 text-right" title="Cost per complete (CPI) — what you pay this supplier per completed response.">$ / complete</span>
          <span className="w-16 text-right" title="The most completes to buy from this supplier in this launch — a per-supplier ceiling.">cap</span>
          <span className="w-16 text-right" title="How many this supplier actually collected in this launch.">N collected</span>
          <span className="w-5"></span>
        </div>
      )}
      {rows.map((r) => {
        const overCap = (r.n_collected ?? 0) > r.completes_cap
        return (
          <div key={r.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 items-center group">
            <span className="text-foreground truncate" title={r.suppliers?.name ?? undefined}>{r.suppliers?.name ?? '—'}</span>
            <input
              key={`cpi-${r.id}-${r.cpi}`}
              type="number"
              step="0.01"
              min="0"
              defaultValue={r.cpi}
              onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v !== r.cpi) updateRow.mutate({ id: r.id, updates: { cpi: v } }) }}
              className={`${inputCls} w-16 text-right`}
            />
            <input
              key={`cap-${r.id}-${r.completes_cap}`}
              type="number"
              min="0"
              defaultValue={r.completes_cap}
              onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0 && v !== r.completes_cap) updateRow.mutate({ id: r.id, updates: { completes_cap: v } }) }}
              className={`${inputCls} w-16 text-right`}
            />
            <input
              key={`col-${r.id}-${r.n_collected}`}
              type="number"
              min="0"
              defaultValue={r.n_collected ?? 0}
              title={overCap ? "Above this supplier's cap" : undefined}
              onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0 && v !== (r.n_collected ?? 0)) updateRow.mutate({ id: r.id, updates: { n_collected: v } }) }}
              className={`${inputCls} w-16 text-right ${overCap ? 'border-amber-500/60 text-amber-600 dark:text-amber-400' : ''}`}
            />
            <button
              onClick={() => removeRow.mutate(r.id)}
              title="Remove supplier from this launch"
              className="w-5 text-center text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400"
            >
              ✕
            </button>
          </div>
        )
      })}

      {/* Target + this launch's subtotal */}
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Target
          <InfoTooltip text="This launch's target # of completes. Its estimate range = target × [cheapest…priciest CPI in the launch]. The project estimate is the sum of the launch ranges." />
          <input
            key={`tgt-${launch.id}-${launch.target ?? ''}`}
            type="number"
            min="0"
            defaultValue={launch.target ?? ''}
            placeholder="—"
            onBlur={(e) => {
              const raw = e.target.value.trim()
              const v = raw === '' ? null : parseInt(raw, 10)
              if (!(v != null && (isNaN(v) || v < 0)) && v !== (launch.target ?? null)) updateLaunch.mutate({ id: launch.id, updates: { target: v } })
            }}
            className={`${inputCls} w-16 text-right`}
          />
        </label>
        <span className="text-[11px] text-right">
          {hasCollected ? (
            <span className={overTarget ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
              Actual <span className="text-foreground font-medium">{money(actual)}</span> · {fmtNum(collected)} collected
              {launch.target != null ? ` / ${fmtNum(launch.target)}` : ''}{overTarget ? ' · over' : ''}
            </span>
          ) : range ? (
            <span className="text-muted-foreground">
              Est. <span className="text-foreground font-medium">{money(range.low)}–{money(range.high)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/60">set target + CPIs to estimate</span>
          )}
        </span>
      </div>

      {/* Add supplier (scoped to this launch) + apply-CPI-to-all */}
      <div className="flex flex-wrap gap-1 items-center">
        {available.length > 0 && (
          <select value="" onChange={(e) => addByCatalog(e.target.value)} className={`${inputCls} flex-1 min-w-[7rem]`} aria-label="Add supplier to launch">
            <option value="">＋ add supplier…</option>
            {available.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        )}
        <input value={applyCpi} onChange={(e) => setApplyCpi(e.target.value)} type="number" step="0.01" min="0" placeholder="$ / complete" className={`${inputCls} w-20`} />
        <button
          onClick={applyToAll}
          disabled={rows.length === 0 || !applyCpi.trim()}
          title="Set this CPI on every supplier in this launch"
          className="text-xs bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed px-2 py-0.5 rounded"
        >
          Apply to all
        </button>
      </div>
      <div className="flex gap-1" onKeyDown={(e) => { if (e.key === 'Enter') addNewSupplier() }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="new supplier name" className={`${inputCls} flex-1`} />
        <button
          onClick={addNewSupplier}
          disabled={!newName.trim() || addSupplier.isPending}
          className="text-xs bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed px-2 py-0.5 rounded"
        >
          + new
        </button>
      </div>
    </div>
  )
}

export function SuppliersWidget({
  projectId,
  nTarget,
  nInternalTarget,
  nActual,
}: {
  projectId: string
  nTarget: number | null
  nInternalTarget?: number | null
  nActual?: number | null
}) {
  const supabase = createClient()
  const { data: catalog } = useSuppliers()
  const { data: launches, isError: launchesErr } = useProjectLaunches(projectId)
  const { data: rows, isError: suppliersErr } = useProjectSuppliers(projectId)
  const addLaunch = useAddLaunch(projectId)
  const addProjectSupplier = useAddProjectSupplier(projectId)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  if (launchesErr || suppliersErr) {
    return (
      <div className="border-t border-border pt-3 mt-1">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium">Suppliers</p>
        <p className="text-xs text-muted-foreground/70">Suppliers need the latest database migration.</p>
      </div>
    )
  }

  const launchList = launches ?? []
  const allRows = rows ?? []
  const rowsFor = (launchId: string) => allRows.filter((r) => r.launch_id === launchId)

  // Project rollup across launches.
  const launchesLite = launchList.map((l) => ({
    target: l.target,
    lines: rowsFor(l.id).map((r) => ({ cpi: r.cpi, completes_cap: r.completes_cap, n_collected: r.n_collected })),
  }))
  const pCollected = projectCollected(launchesLite)
  const pActual = projectActualCost(launchesLite)
  const pRange = projectEstimateRange(launchesLite)
  const pBlended = projectBlendedCpi(launchesLite)
  const pTarget = projectTarget(launchesLite)
  const hasCollected = pCollected > 0
  const internalTarget = nInternalTarget ?? nTarget
  const divergence = pTarget > 0 && internalTarget != null && pTarget !== internalTarget

  function addLaunchWithCopy() {
    const prev = launchList[launchList.length - 1]
    const prevRows = prev ? rowsFor(prev.id) : []
    const today = new Date().toISOString().slice(0, 10)
    addLaunch.mutate(
      { launch_date: today, created_by: userName },
      {
        onSuccess: (created) => {
          // Copy the previous launch's supplier panel (CPIs + caps); N collected resets to 0.
          for (const r of prevRows) {
            addProjectSupplier.mutate({
              supplier_id: r.supplier_id, launch_id: created.id,
              cpi: r.cpi, completes_cap: r.completes_cap, created_by: userName,
            })
          }
        },
      }
    )
  }

  return (
    <div className="border-t border-border pt-3 mt-1">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium flex items-center">
        Suppliers
        <InfoTooltip text="PureSpectrum sample suppliers, grouped into launches (fielding waves). Each launch has its own target and supplier rows (CPI = cost per complete, plus a per-supplier cap). Before completes, each launch shows a cost range and the project estimate is the SUM of the launch ranges; once you enter N collected, the actual cost = Σ(CPI × N collected) across all launches." />
      </p>

      <div className="flex flex-col gap-2 text-xs">
        {launchList.map((l, i) => (
          <LaunchBlock
            key={l.id}
            projectId={projectId}
            launch={l}
            rows={rowsFor(l.id)}
            index={i}
            catalog={catalog ?? []}
            userName={userName}
          />
        ))}

        <button
          onClick={addLaunchWithCopy}
          disabled={addLaunch.isPending}
          className="self-start text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg"
        >
          {addLaunch.isPending ? 'Adding…' : launchList.length === 0 ? '＋ Add launch' : '＋ Add launch (copies the last one)'}
        </button>

        {launchList.length > 0 && (
          <div className="mt-1 pt-1 border-t border-border flex flex-col gap-0.5">
            {hasCollected ? (
              <>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    Actual cost <span className="text-foreground font-medium">{money(pActual)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {fmtNum(pCollected)} collected{pTarget > 0 ? ` / ${fmtNum(pTarget)}` : ''} · blended {rate(pBlended)}
                  </span>
                </div>
                {nActual != null && pBlended != null && (
                  <p className="text-[10px] text-muted-foreground/60">
                    ↳ blended {rate(pBlended)} × N actual {fmtNum(nActual)} = {money(pBlended * nActual)}
                  </p>
                )}
              </>
            ) : (
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>
                  {pRange ? (
                    <>Est. <span className="text-foreground font-medium">{money(pRange.low)}–{money(pRange.high)}</span></>
                  ) : (
                    'Set targets + CPIs to estimate'
                  )}
                  {pTarget > 0 ? ` · target ${fmtNum(pTarget)}` : ''}
                </span>
                <span className="text-muted-foreground/60">sum of launch ranges</span>
              </div>
            )}
            {divergence && (
              <p className="text-[10px] text-amber-600/80 dark:text-amber-400/80">
                Launch targets sum to {fmtNum(pTarget)}, but the project internal target is {fmtNum(internalTarget as number)}.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
