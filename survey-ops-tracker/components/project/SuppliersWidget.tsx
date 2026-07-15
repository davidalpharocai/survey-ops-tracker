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
} from '@/lib/hooks/useProjectSuppliers'
import { estimatedCost, blendedCpi, totalCappedCompletes } from '@/lib/utils/suppliers'
import { fmtNum } from '@/lib/utils/number'

function money(v: number): string {
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function rate(v: number | null): string {
  return v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
const inputCls =
  'bg-muted border border-border rounded px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring'

export function SuppliersWidget({ projectId, nTarget }: { projectId: string; nTarget: number | null }) {
  const supabase = createClient()
  const { data: catalog } = useSuppliers()
  const { data: rows, isError } = useProjectSuppliers(projectId)
  const addProjectSupplier = useAddProjectSupplier(projectId)
  const updateRow = useUpdateProjectSupplier(projectId)
  const removeRow = useRemoveProjectSupplier(projectId)
  const addSupplier = useAddSupplier()

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  const [applyCpi, setApplyCpi] = useState('')
  const [newName, setNewName] = useState('')

  if (isError) {
    return (
      <div className="border-t border-border pt-3 mt-1">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium">Suppliers</p>
        <p className="text-xs text-muted-foreground/70">Suppliers need the latest database migration.</p>
      </div>
    )
  }

  const list = rows ?? []
  const chosenIds = new Set(list.map((r) => r.supplier_id))
  const available = (catalog ?? []).filter((s) => !chosenIds.has(s.id))
  const lines = list.map((r) => ({ cpi: r.cpi, completes_cap: r.completes_cap }))
  const est = estimatedCost(lines)
  const capTotal = totalCappedCompletes(lines)
  const underN = nTarget != null && capTotal < nTarget

  function addByCatalog(supplierId: string) {
    if (!supplierId) return
    const cpi = parseFloat(applyCpi)
    addProjectSupplier.mutate({ supplier_id: supplierId, cpi: isNaN(cpi) ? 0 : cpi, completes_cap: 1000, created_by: userName })
  }
  function addNewSupplier() {
    const name = newName.trim()
    if (!name) return
    addSupplier.mutate({ name, createdBy: userName }, { onSuccess: (s) => { setNewName(''); addByCatalog(s.id) } })
  }
  function applyToAll() {
    const cpi = parseFloat(applyCpi)
    if (isNaN(cpi)) return
    for (const r of list) if (r.cpi !== cpi) updateRow.mutate({ id: r.id, updates: { cpi } })
  }

  return (
    <div className="border-t border-border pt-3 mt-1">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 font-medium flex items-center">
        Suppliers
        <InfoTooltip text="PureSpectrum sample suppliers for this study. Each has a CPI (cost per interview) and a completes cap. Estimated cost = Σ(cap × CPI) — the most you'd spend if every supplier fills its cap." />
      </p>

      <div className="flex flex-col gap-1 text-xs">
        {list.length > 0 && (
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 text-[11px] text-muted-foreground">
            <span>Supplier</span>
            <span className="text-right">CPI $</span>
            <span className="text-right">cap</span>
            <span></span>
          </div>
        )}
        {list.map((r) => (
          <div key={r.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 items-center group">
            <span className="text-foreground truncate" title={r.suppliers?.name ?? undefined}>{r.suppliers?.name ?? '—'}</span>
            <input
              key={`cpi-${r.id}-${r.cpi}`}
              type="number"
              step="0.01"
              defaultValue={r.cpi}
              onBlur={(e) => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v) && v !== r.cpi) updateRow.mutate({ id: r.id, updates: { cpi: v } })
              }}
              className={`${inputCls} w-16 text-right`}
            />
            <input
              key={`cap-${r.id}-${r.completes_cap}`}
              type="number"
              defaultValue={r.completes_cap}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v !== r.completes_cap) updateRow.mutate({ id: r.id, updates: { completes_cap: v } })
              }}
              className={`${inputCls} w-16 text-right`}
            />
            <button
              onClick={() => removeRow.mutate(r.id)}
              title="Remove supplier"
              className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 px-0.5"
            >
              ✕
            </button>
          </div>
        ))}

        {list.length > 0 && (
          <div className="flex justify-between text-[11px] mt-1 pt-1 border-t border-border">
            <span className="text-muted-foreground">
              Est. cost <span className="text-foreground font-medium">{money(est)}</span> · blended {rate(blendedCpi(lines))}
            </span>
            <span className={underN ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
              {fmtNum(capTotal)} cap{underN ? ` · under N ${fmtNum(nTarget!)}` : ''}
            </span>
          </div>
        )}

        {/* Add a supplier + apply-CPI-to-all */}
        <div className="flex flex-wrap gap-1 mt-1.5 items-center">
          {available.length > 0 && (
            <select
              value=""
              onChange={(e) => addByCatalog(e.target.value)}
              className={`${inputCls} flex-1 min-w-[8rem]`}
              aria-label="Add supplier"
            >
              <option value="">＋ add supplier…</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <input
            value={applyCpi}
            onChange={(e) => setApplyCpi(e.target.value)}
            type="number"
            step="0.01"
            placeholder="CPI $"
            className={`${inputCls} w-16`}
          />
          <button
            onClick={applyToAll}
            disabled={list.length === 0 || !applyCpi.trim()}
            title="Set this CPI on every supplier"
            className="text-xs bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed px-2 py-0.5 rounded"
          >
            Apply to all
          </button>
        </div>

        {/* Inline: add a brand-new supplier to the catalog */}
        <div className="flex gap-1 mt-0.5" onKeyDown={(e) => { if (e.key === 'Enter') addNewSupplier() }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="new supplier name"
            className={`${inputCls} flex-1`}
          />
          <button
            onClick={addNewSupplier}
            disabled={!newName.trim() || addSupplier.isPending}
            className="text-xs bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed px-2 py-0.5 rounded"
          >
            + new
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
          New in the “CPI $” box applies to newly-added suppliers; “Apply to all” retro-sets every row.
        </p>
      </div>
    </div>
  )
}
