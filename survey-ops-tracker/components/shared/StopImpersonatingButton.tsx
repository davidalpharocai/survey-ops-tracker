'use client'

import { useState } from 'react'
import { toast } from '@/lib/utils/toast'

/**
 * Hands the session back. Split out as a client component because the banner
 * itself is a server component reading an httpOnly cookie, and only this bit
 * needs interactivity.
 *
 * A FULL PAGE LOAD, not router.refresh(): stopping swaps the auth cookies for a
 * different user, and every cached server component, react-query cache entry and
 * RSC payload in the tab belongs to the person being impersonated. A soft
 * navigation would leave the admin looking at the target's cached rows under
 * their own identity — which is the one genuinely misleading state this feature
 * could produce. `location.assign` throws all of it away.
 */
export function StopImpersonatingButton({ className = '' }: { className?: string }) {
  const [busy, setBusy] = useState(false)

  async function stop() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/impersonate/stop', { method: 'POST' })
      const body = (await res.json()) as { ok?: boolean; error?: string; next?: string }
      if (!res.ok || body.error) {
        toast(body.error ?? 'Could not stop — sign out and back in.')
        // Still leave, if the server told us where. A failed restore that also
        // signed us out must not strand the tab on a page it can no longer read.
        if (body.next) window.location.assign(body.next)
        setBusy(false)
        return
      }
      window.location.assign(body.next ?? '/')
    } catch {
      toast('Could not reach the server. Sign out and back in to return to your own account.')
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={stop}
      disabled={busy}
      className={`shrink-0 rounded-md border border-amber-600/40 bg-amber-500/20 px-2.5 py-1 text-[13px] font-medium text-amber-900 transition-colors hover:bg-amber-500/30 disabled:opacity-50 dark:text-amber-100 ${className}`}
    >
      {busy ? 'Returning…' : 'Stop viewing as'}
    </button>
  )
}
