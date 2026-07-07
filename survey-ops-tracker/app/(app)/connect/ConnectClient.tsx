'use client'
import { useState, useTransition } from 'react'

/** Copy-to-clipboard box for the connector URL. */
export function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can be blocked (permissions, non-HTTPS); the URL is
      // still selectable text, so this is a soft failure.
    }
  }

  return (
    <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2">
      <code className="text-sm text-foreground flex-1 min-w-0 truncate">{value}</code>
      <button
        onClick={copy}
        title="Copy the connector URL to your clipboard"
        className="shrink-0 text-xs border border-border text-foreground hover:border-ring px-2 py-1 rounded transition-colors"
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  )
}

/** Revoke button for a single active connection — calls the server action, then lets revalidatePath refresh the list. */
export function RevokeButton({
  id,
  revoke,
}: {
  id: string
  revoke: (id: string) => Promise<void>
}) {
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5">
        <button
          onClick={() => startTransition(() => { void revoke(id) })}
          disabled={pending}
          className="text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded transition-colors disabled:opacity-50"
        >
          {pending ? 'Revoking…' : 'Confirm revoke'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-muted-foreground hover:text-foreground px-1"
        >
          Cancel
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="Sign this Claude out — it will need to log in again to reconnect"
      className="text-xs border border-border text-foreground hover:border-ring px-2 py-1 rounded transition-colors"
    >
      Revoke
    </button>
  )
}
