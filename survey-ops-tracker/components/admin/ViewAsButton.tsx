'use client'

import { useState } from 'react'
import { toast } from '@/lib/utils/toast'

/**
 * "View as" for one person, in Admin → Access.
 *
 * Only rendered for the read-only tiers, because those are the only legal
 * targets — see lib/auth/impersonation.ts. The server refuses anything else
 * regardless, so this is about not offering a button that cannot work rather
 * than about enforcement.
 *
 * A full page load rather than a router push, for the same reason as stopping:
 * the auth cookies change identity mid-flight, and every cached server component
 * and react-query entry in the tab belongs to the previous person.
 */
export function ViewAsButton({ email, tier }: { email: string; tier: string }) {
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string; next?: string }
      if (!res.ok || body.error) {
        // The server's refusals explain themselves (why this tier, why not an
        // analyst), so they are shown verbatim rather than replaced with
        // something generic.
        toast(body.error ?? 'Could not view as this user.')
        setBusy(false)
        return
      }
      window.location.assign(body.next ?? '/')
    } catch {
      toast('Could not reach the server.')
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      title={`Sign in as ${email} to see exactly what they see. Read-only — the ${tier} tier can only read, and every session is logged.`}
      className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:opacity-50"
    >
      {busy ? '…' : '👁 View as'}
    </button>
  )
}
