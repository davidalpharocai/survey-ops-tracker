'use client'
import { useState } from 'react'

export function ComplianceGateModal({
  message,
  contact,
  onCancel,
  onOverride,
}: {
  message: string
  contact: string | null
  onCancel: () => void
  onOverride: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-md flex flex-col gap-3 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-foreground">Compliance review required</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>
        {contact && (
          <p className="text-xs text-muted-foreground">
            Compliance contact: <span className="text-foreground">{contact}</span>
          </p>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Override reason (recorded on the project)
          <input
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why are you proceeding without approval?"
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
            onKeyDown={e => {
              if (e.key === 'Enter' && reason.trim()) onOverride(reason.trim())
              if (e.key === 'Escape') onCancel()
            }}
          />
        </label>
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-3 py-2">
            Cancel
          </button>
          <button
            onClick={() => reason.trim() && onOverride(reason.trim())}
            disabled={!reason.trim()}
            className="text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
          >
            Override &amp; proceed
          </button>
        </div>
      </div>
    </div>
  )
}
