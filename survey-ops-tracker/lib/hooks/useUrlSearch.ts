'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * A search box whose typing is instant and whose URL still carries the query.
 *
 * David, 2026-09-23: "except for home, search on all pages is super laggy (not
 * the org-wide search)."
 *
 * ── WHY EXACTLY THOSE PAGES ─────────────────────────────────────────────────
 * Home keeps its query in useState, so typing is pure React. Accounts, Contacts
 * and the survey list each called router.replace() ON EVERY KEYSTROKE. These are
 * force-dynamic server pages, so each replace is a full RSC round trip to the
 * server before the character appears settled -- the input fights the network on
 * every letter. The org-wide search was never laggy for the same reason Home is
 * not: it holds its own state.
 *
 * The URL was carrying the query for a good reason -- a search someone can send
 * to a colleague -- so the answer is not to drop it but to stop doing it per
 * keystroke.
 *
 * ── HOW THIS RESOLVES THE FIGHT ─────────────────────────────────────────────
 * The box renders LOCAL state, which is what makes typing instant, and the URL
 * is written once the typing pauses. The subtlety is the other direction: the
 * URL can also change from outside -- Back, a Clear button, a link someone
 * pasted -- and that has to win. So the last value THIS hook wrote is
 * remembered, and an incoming URL value is adopted only when it differs from
 * that. Without the ref, the debounced write would bounce off the URL change it
 * had just caused and the box would stutter on every pause.
 */
export function useUrlSearch(
  key: string,
  delay = 250,
): [string, (v: string) => void] {
  const router = useRouter()
  const params = useSearchParams()
  const fromUrl = params.get(key) ?? ''

  const [local, setLocal] = useState(fromUrl)
  // The last value this hook pushed. Anything else in the URL came from
  // somewhere else and outranks what is being typed.
  const written = useRef(fromUrl)

  useEffect(() => {
    if (fromUrl !== written.current) {
      written.current = fromUrl
      setLocal(fromUrl)
    }
  }, [fromUrl])

  useEffect(() => {
    if (local === written.current) return
    const t = setTimeout(() => {
      written.current = local
      const next = new URLSearchParams(window.location.search)
      if (local) next.set(key, local)
      else next.delete(key)
      router.replace(next.toString() ? `?${next.toString()}` : '?', { scroll: false })
    }, delay)
    return () => clearTimeout(t)
  }, [local, key, delay, router])

  // Exposed so a Clear button can reset the box and the URL together without
  // waiting out the debounce.
  const set = useCallback((v: string) => setLocal(v), [])

  return [local, set]
}
