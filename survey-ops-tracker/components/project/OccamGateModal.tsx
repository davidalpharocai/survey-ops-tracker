'use client'
import { useState } from 'react'

/**
 * Delivery-time prompt: the FIRST time we deliver to a project's requested-by
 * contact, confirm the Occam account invite (welcome email) has been sent — they
 * need it to sign in and view the data. "Yes, sent" records the invite (so the
 * contact is never prompted again); "Deliver anyway" needs a logged reason.
 */
export function OccamGateModal({
  contactName,
  contactEmail,
  onCancel,
  onConfirmSent,
  onOverride,
}: {
  contactName: string
  contactEmail: string | null
  onCancel: () => void
  onConfirmSent: () => void
  onOverride: (reason: string) => void
}) {
  const [showOverride, setShowOverride] = useState(false)
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-md flex flex-col gap-3 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-foreground">Occam invite check</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This is the first delivery for{' '}
          <span className="text-foreground font-medium">{contactName}</span>
          {contactEmail ? <span> ({contactEmail})</span> : null}. They need the Occam welcome email and a
          sign-in to view the data. Has the Occam account invite been sent?
        </p>
        {!showOverride ? (
          <div className="flex justify-end gap-2 mt-1">
            <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-3 py-2">
              Cancel
            </button>
            <button
              onClick={() => setShowOverride(true)}
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-2"
            >
              Deliver anyway…
            </button>
            <button
              onClick={onConfirmSent}
              className="text-xs bg-primary hover:opacity-90 text-primary-foreground px-4 py-2 rounded-lg transition-opacity"
            >
              Yes, invite sent — deliver
            </button>
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Reason for delivering without the invite (recorded on the project)
            <input
              autoFocus
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why deliver before the client can sign in?"
              className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
              onKeyDown={e => {
                if (e.key === 'Enter' && reason.trim()) onOverride(reason.trim())
                if (e.key === 'Escape') setShowOverride(false)
              }}
            />
            <div className="flex justify-end gap-2 mt-1">
              <button onClick={() => setShowOverride(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-2">
                Back
              </button>
              <button
                onClick={() => reason.trim() && onOverride(reason.trim())}
                disabled={!reason.trim()}
                className="text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
              >
                Deliver without invite
              </button>
            </div>
          </label>
        )}
      </div>
    </div>
  )
}
