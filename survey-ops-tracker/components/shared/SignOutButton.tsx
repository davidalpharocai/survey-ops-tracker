'use client'

import { useState } from 'react'

/**
 * The one control that ends a session. Used by /signout, and reachable from
 * every shell's nav.
 *
 * A FULL PAGE LOAD, not router.push — the same reasoning as
 * StopImpersonatingButton. Every cached server component, react-query entry and
 * RSC payload in the tab belongs to the person who just left. A soft navigation
 * would land on /login with their rows still sitting in memory behind it.
 * location.assign throws the whole document away.
 *
 * IT NAVIGATES EVEN WHEN THE REQUEST FAILS. If the network is down we cannot
 * clear the httpOnly cookies, but leaving the user parked on a page they were
 * trying to escape — with a toast telling them to try again — is how the
 * original stranding happened. /login is the right place to be either way: it is
 * outside every gated shell, and ?signout-failed tells it to clear what it can
 * from the browser side as a fallback.
 */
export function SignOutButton({
  className = '',
  label = 'Sign out',
}: {
  className?: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/signout', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { next?: string }
      window.location.assign(body.next ?? '/login')
    } catch {
      window.location.assign('/login?signout-failed=1')
    }
  }

  return (
    <button type="button" onClick={signOut} disabled={busy} className={className}>
      {busy ? 'Signing out…' : label}
    </button>
  )
}
