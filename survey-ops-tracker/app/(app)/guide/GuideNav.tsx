'use client'
import { useEffect, useMemo, useRef, useState } from 'react'

export interface TocItem {
  level: number
  text: string
  slug: string
}

/** Sticky side navigation for the User Guide: a searchable, click-to-jump list of
 *  every section, with scrollspy highlighting the section you're currently reading. */
export function GuideNav({ toc }: { toc: TocItem[] }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState<string | null>(toc[0]?.slug ?? null)
  const listRef = useRef<HTMLUListElement>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? toc.filter(t => t.text.toLowerCase().includes(needle)) : toc
  }, [q, toc])

  // Scrollspy — highlight the section nearest the top of the viewport.
  useEffect(() => {
    const els = toc.map(t => document.getElementById(t.slug)).filter((e): e is HTMLElement => !!e)
    if (els.length === 0) return
    const obs = new IntersectionObserver(
      entries => {
        const onscreen = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (onscreen[0]) setActive(onscreen[0].target.id)
      },
      { rootMargin: '-8% 0px -72% 0px', threshold: 0 }
    )
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [toc])

  function jump(slug: string) {
    const el = document.getElementById(slug)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(slug)
    history.replaceState(null, '', `#${slug}`)
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 max-h-72 overflow-auto thin-scroll lg:max-h-[calc(100vh-2rem)]">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium mb-2 px-1">On this page</p>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search sections…"
        className="w-full bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-ring mb-2"
        aria-label="Search the guide sections"
      />
      <ul ref={listRef} className="flex flex-col gap-0.5">
        {filtered.map(t => (
          <li key={t.slug} className={t.level >= 3 ? 'ml-3' : ''}>
            <button
              onClick={() => jump(t.slug)}
              className={`w-full text-left text-xs leading-snug px-2 py-1 rounded-md transition-colors ${
                active === t.slug
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {t.text}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="text-xs text-muted-foreground px-2 py-1">No matching section.</li>
        )}
      </ul>
    </div>
  )
}
