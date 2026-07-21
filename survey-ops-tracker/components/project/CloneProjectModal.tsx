'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCloneProject, type CloneCarry } from '@/lib/hooks/useCloneProject'
import { toast } from '@/lib/utils/toast'

const GROUPS: { key: keyof CloneCarry; label: string; desc: string }[] = [
  { key: 'people', label: 'People', desc: 'captain, co-captains, salesperson, requested-by' },
  { key: 'audienceN', label: 'Audience + N targets', desc: 'audience, N target, internal target, audience size' },
  { key: 'flags', label: 'Flags', desc: 'longitudinal, voter QA, citation, row-level, terminations' },
  { key: 'suppliers', label: 'Suppliers', desc: 'CPIs + caps (N collected reset to 0)' },
  { key: 'budget', label: 'Budget', desc: 'total budget' },
]

export function CloneProjectModal({
  sourceId,
  sourceName,
  sourceCode,
  onClose,
}: {
  sourceId: string
  sourceName: string
  sourceCode: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const clone = useCloneProject()
  const [name, setName] = useState(`${sourceName} (copy)`)
  const [carry, setCarry] = useState<Required<CloneCarry>>({
    people: true,
    audienceN: true,
    flags: true,
    suppliers: true,
    budget: true,
  })

  function submit() {
    if (!name.trim()) return
    clone.mutate(
      { sourceId, newName: name.trim(), carry },
      {
        onSuccess: (p) => {
          toast(`Cloned to ${p.project_code ?? p.project_name}`, 'success')
          onClose()
          router.push(`/projects/${p.id}`)
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">Clone project</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            A fresh copy of {sourceCode ? `${sourceCode} · ` : ''}
            {sourceName}. Dates, N collected/actual, survey IDs, and pipeline stage start blank; blasts, deliverables,
            and activity aren’t copied. The new project records what it was cloned from in its audit log.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-muted-foreground">New name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            className="bg-muted border border-border rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-ring"
          />
        </label>

        <div className="flex flex-col gap-0.5">
          <span className="text-[12px] text-muted-foreground mb-0.5">Carry over</span>
          {GROUPS.map((g) => (
            <label key={g.key} className="flex items-start gap-2 text-xs cursor-pointer py-0.5">
              <input
                type="checkbox"
                checked={carry[g.key]}
                onChange={(e) => setCarry({ ...carry, [g.key]: e.target.checked })}
                className="mt-0.5 accent-blue-600"
              />
              <span>
                <span className="text-foreground">{g.label}</span>{' '}
                <span className="text-muted-foreground/70">— {g.desc}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={submit}
            disabled={!name.trim() || clone.isPending}
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            {clone.isPending ? 'Cloning…' : 'Clone project'}
          </button>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
