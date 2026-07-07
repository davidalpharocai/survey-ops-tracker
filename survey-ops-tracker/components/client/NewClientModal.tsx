'use client'
import { useState } from 'react'
import { useCreateClient, type Client } from '@/lib/hooks/useClients'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

interface NewClientModalProps {
  initialName?: string
  onCreated?: (client: Client) => void
  onClose: () => void
}

/**
 * Create a client directly — from Admin's Accounts section, the New-Project
 * client picker's "+ New Client", or the board's client filter. The client's
 * Cl##### code is assigned automatically on insert once migration 047 is
 * applied — until then the row is created without one.
 */
export function NewClientModal({ initialName = '', onCreated, onClose }: NewClientModalProps) {
  const createClient = useCreateClient()
  const [name, setName] = useState(initialName)
  const [beforeFielding, setBeforeFielding] = useState(false)
  const [afterFielding, setAfterFielding] = useState(false)
  const [contact, setContact] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim() !== '' && !createClient.isPending

  async function handleCreate() {
    if (!canSubmit) return
    setError(null)
    try {
      const created = await createClient.mutateAsync({
        name: name.trim(),
        compliance_before_fielding: beforeFielding,
        compliance_after_fielding: afterFielding,
        compliance_contact: contact.trim() || null,
        compliance_notes: notes.trim() || null,
      })
      onCreated?.(created)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the client. Please try again.')
    }
  }

  const inputClass =
    'bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl p-5 w-full max-w-md flex flex-col gap-3 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-foreground">New Client</h2>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Client name *
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Meridian Capital"
            className={inputClass}
          />
        </label>

        <div className="flex flex-col gap-2 text-sm border-t border-border pt-3">
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium flex items-center">
            Compliance
            <InfoTooltip text="When set, this client's surveys are blocked from being fielded (before) or delivered (after) until the matching compliance review is approved. Leave both off if this client has no compliance requirement." />
          </span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={beforeFielding}
              onChange={e => setBeforeFielding(e.target.checked)}
              className="accent-blue-600"
            />
            <span className="text-foreground">Review required <span className="text-muted-foreground">before fielding</span> — questions only</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={afterFielding}
              onChange={e => setAfterFielding(e.target.checked)}
              className="accent-blue-600"
            />
            <span className="text-foreground">Review required <span className="text-muted-foreground">after fielding</span> — questions + results</span>
          </label>
        </div>

        {(beforeFielding || afterFielding) && (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Compliance contact email(s)
              <input
                value={contact}
                onChange={e => setContact(e.target.value)}
                placeholder="compliance@client.com, reviewer@client.com"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Notes <span className="text-muted-foreground/70">(advisory — e.g. conditions)</span>
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. only if the survey contains open-text questions"
                className={inputClass}
              />
            </label>
          </>
        )}

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
          >
            {createClient.isPending ? 'Creating…' : 'Create client'}
          </button>
        </div>
      </div>
    </div>
  )
}
