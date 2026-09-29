'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

/**
 * The account button: initials in a circle, top right, opening Admin + Sign out.
 *
 * ── WHY THESE TWO ITEMS AND NOT THE REST ────────────────────────────────────
 * David, 2026-09-29: "maybe put one's name or initials in a circle like other
 * systems do in the top right and it's lightly animated drop down. there, it
 * will include Admin and Sign Out."
 *
 * Both were in odd places. Admin was a ribbon TAB, sitting beside Reruns and
 * Calendar as though it were daily work; Sign out was the last line of the
 * "More" menu, under the ribbon-reordering tip. Neither is a destination you
 * navigate to while working — they are things you do to your account — which
 * is exactly the convention the circle encodes in every other tool. Moving
 * Admin out also freed the ribbon slot that Insights now takes.
 *
 * ── WHERE THE INITIALS COME FROM ────────────────────────────────────────────
 * team_members.initials if the viewer has a row (the column already exists and
 * is what the board's avatars use, so one person reads the same everywhere),
 * then their name, then the local part of their email. The last fallback
 * matters: a signed-in user with no team_members row is not an error state —
 * roster rows are added by hand — and an empty circle would look like one.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 * It does not claim to know who you are while viewing as somebody else.
 * ImpersonationBanner already says that, loudly and across the whole width;
 * a second, smaller voice saying it in a circle would be a worse place to
 * learn it and a good place to miss it.
 */

interface Viewer {
  name: string | null
  initials: string | null
  email: string | null
}

/** Up to three characters, never empty. `··` only when there is no identity at
 *  all to read, which is the signed-out flash before the query resolves. */
export function initialsOf(v: Viewer | null | undefined): string {
  const roster = v?.initials?.trim()
  if (roster) return roster.slice(0, 3).toUpperCase()
  const name = v?.name?.trim()
  if (name) {
    const words = name.split(/\s+/).filter(Boolean)
    const picked = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)
    return picked.toUpperCase()
  }
  const local = v?.email?.split('@')[0]?.replace(/[^a-z0-9]/gi, '')
  if (local) return local.slice(0, 2).toUpperCase()
  return '··'
}

/** The name to print in the menu header, or the email, or nothing. */
export function viewerLabel(v: Viewer | null | undefined): string | null {
  return v?.name?.trim() || v?.email || null
}

const itemClass =
  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-foreground/90 hover:bg-accent hover:text-foreground transition-colors'

export function UserMenu() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // One query for both halves of the identity, so the circle and the header
  // can never disagree. Fails soft to nulls: a menu that still opens Admin and
  // Sign out is worth more than one that refuses to render because a roster
  // lookup 500'd.
  const { data: viewer } = useQuery<Viewer>({
    queryKey: ['viewer-identity'],
    queryFn: async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const email = user?.email ?? null
      if (!email) return { name: null, initials: null, email: null }
      const { data } = await supabase
        .from('team_members')
        .select('name, initials')
        .eq('email', email)
        .maybeSingle()
      return { name: data?.name ?? null, initials: data?.initials ?? null, email }
    },
    staleTime: 5 * 60_000,
  })

  // Close on navigation / outside-click / Escape — the same three the More
  // menu closes on, so the two behave identically.
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const initials = initialsOf(viewer)
  const label = viewerLabel(viewer)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={label ? `Account — ${label}` : 'Account'}
        title={label ? `${label} — Admin and Sign out` : 'Account — Admin and Sign out'}
        className={`inline-flex items-center justify-center h-7 w-7 rounded-full text-[11px] font-semibold tracking-tight
          bg-primary/10 text-primary ring-1 transition-[transform,box-shadow,background-color] duration-150
          hover:bg-primary/15 hover:scale-105 active:scale-95
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          ${open ? 'ring-primary/40 scale-105' : 'ring-primary/20'}`}
      >
        {initials}
      </button>

      {/* NO role="menu"/"menuitem" BELOW, DELIBERATELY. Those roles override an
          anchor's implicit `link` role, so the two destinations stop being
          links to everything that looks for one — assistive tech navigating by
          links, and this app's own convention that a hyperlinked element is
          always a real <a href> you can middle-click. The ARIA menu pattern
          also owes the reader roving arrow-key focus, which a two-item popup of
          links does not need and would then be missing. The "More" menu beside
          it is built the same way. */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 w-56 bg-popover border border-border rounded-xl shadow-xl p-1.5
            flex flex-col origin-top-right animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
        >
          {/* Who this session belongs to. Named before the actions, because
              "Sign out" is a different decision depending on the answer. */}
          {label && (
            <>
              <div className="px-3 pt-1.5 pb-2">
                <div className="text-sm font-medium text-foreground truncate" title={label}>{label}</div>
                {viewer?.name && viewer.email && (
                  <div className="text-[11px] text-muted-foreground truncate" title={viewer.email}>{viewer.email}</div>
                )}
              </div>
              <div className="border-t border-border mb-1.5" />
            </>
          )}
          <Link href="/admin" className={itemClass} title="Admin — system links, client ids, roster, recently deleted, and data health">
            <span aria-hidden="true">⚙️</span> Admin
          </Link>
          <Link href="/signout" className={itemClass} title="Sign out — ends your session, and clears the 'viewing as' cookie if one is set">
            <span aria-hidden="true">🚪</span> Sign out
          </Link>
        </div>
      )}
    </div>
  )
}
