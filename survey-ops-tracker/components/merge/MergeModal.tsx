'use client'
import { useState } from 'react'
import { conflicts, buildSurvivorUpdate, PROJECT_MERGE_FIELDS, CLIENT_MERGE_FIELDS } from '@/lib/utils/merge'
import { useMergeProjects, useMergeClients } from '@/lib/hooks/useMerge'

type Row = { id: string } & Record<string, unknown>
type Props = { kind: 'project' | 'client'; a: Row; b: Row; open: boolean; onClose: () => void }

const COMBINES: Record<'project' | 'client', string[]> = {
  project: ['Bids & blasts', 'Next steps', 'Linked docs', 'Deliverables', 'Compliance submissions', 'Notes, activity & audit history'],
  client: ['Projects', 'Contacts', 'Notes', 'Portal reviewers', 'Deliverables'],
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return v.toLocaleString('en-US')
  return String(v)
}

export function MergeModal({ kind, a, b, open, onClose }: Props) {
  const fields = kind === 'project' ? PROJECT_MERGE_FIELDS : CLIENT_MERGE_FIELDS
  const codeKey = kind === 'project' ? 'project_code' : 'code'
  const nameKey = kind === 'project' ? 'project_name' : 'name'
  const mergeProjects = useMergeProjects()
  const mergeClients = useMergeClients()
  const merge = kind === 'project' ? mergeProjects : mergeClients

  const [survivorId, setSurvivorId] = useState<string>(a.id)
  const [picks, setPicks] = useState<Record<string, 'survivor' | 'loser'>>({})

  if (!open) return null
  const survivor = survivorId === a.id ? a : b
  const loser = survivorId === a.id ? b : a
  const diff = conflicts(survivor, loser, fields)

  function doMerge() {
    const survivorUpdate = buildSurvivorUpdate(survivor, loser, picks)
    merge.mutate(
      { survivorId: survivor.id, loserId: loser.id, survivorUpdate },
      { onSuccess: onClose }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-card border border-border rounded-xl p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-foreground">Merge {kind}s</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">Pick which record survives. The other is soft-deleted (recoverable in Admin).</p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {[a, b].map(rec => (
            <button
              key={rec.id}
              onClick={() => { setSurvivorId(rec.id); setPicks({}) }}
              className={`text-left rounded-lg p-3 border ${survivorId === rec.id ? 'border-2 border-blue-500' : 'border-border'}`}
            >
              <span className={`text-[11px] ${survivorId === rec.id ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                {survivorId === rec.id ? 'Survivor' : 'Retired'}
              </span>
              <span className="block text-sm text-foreground truncate">{fmt(rec[nameKey])}</span>
              <span className="block text-xs text-muted-foreground">{fmt(rec[codeKey])}</span>
            </button>
          ))}
        </div>

        {diff.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">Resolve differences ({diff.length})</p>
            <div className="flex flex-col gap-2">
              {diff.map(f => {
                const chosen = picks[f.key] ?? 'survivor'
                return (
                  <div key={f.key} className="grid grid-cols-[110px_1fr_1fr] gap-2 items-center text-sm">
                    <span className="text-muted-foreground">{f.label}</span>
                    {(['survivor', 'loser'] as const).map(side => {
                      const val = side === 'survivor' ? survivor[f.key] : loser[f.key]
                      const active = chosen === side
                      return (
                        <button
                          key={side}
                          onClick={() => setPicks(p => ({ ...p, [f.key]: side }))}
                          className={`text-center rounded px-2 py-1 truncate ${active ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500' : 'border border-border text-muted-foreground'}`}
                        >
                          {fmt(val)}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mb-4">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Everything else combines</p>
          <p className="text-xs text-muted-foreground">{COMBINES[kind].join(' · ')}</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5">Cancel</button>
          <button onClick={doMerge} disabled={merge.isPending} className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg">
            {merge.isPending ? 'Merging…' : `Merge into ${fmt(survivor[codeKey])}`}
          </button>
        </div>
      </div>
    </div>
  )
}
