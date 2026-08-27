'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { CHANGELOG, LATEST_CHANGE_DATE, type ChangeKind } from '@/lib/changelog/entries'
import { SEEN_KEY } from '@/lib/changelog/seen'

// What's new. Shape borrowed from Claude Code's own release notes, which is what
// David asked for: date headings newest first, short uppercase category labels,
// one plain-English bullet per change.
//
// Static data (lib/changelog/entries.ts), so there is nothing to fetch and no
// loading state. The only dynamic thing on the page is marking it as read.

// Meaning-encoded, consistent with the rest of the app: green for something
// gained, blue for something sharpened, amber for something repaired.
const KIND_STYLE: Record<ChangeKind, string> = {
  NEW: 'text-emerald-600 dark:text-emerald-400',
  IMPROVED: 'text-blue-600 dark:text-blue-400',
  FIXED: 'text-amber-600 dark:text-amber-400',
}

const ORDER: ChangeKind[] = ['NEW', 'IMPROVED', 'FIXED']

export default function ChangelogPage() {
  // Opening the page is the acknowledgement — no button to click. Wrapped
  // because localStorage throws outright in some contexts (a browser set to
  // block site data), and a changelog must never be the reason a page breaks.
  useEffect(() => {
    try {
      localStorage.setItem(SEEN_KEY, LATEST_CHANGE_DATE)
    } catch {
      // Nothing to do: the dot on the nav stays, which is a cosmetic cost.
    }
  }, [])

  return (
    <div className="max-w-3xl">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h1 className="text-xl font-semibold text-foreground">What&rsquo;s new</h1>
        <Link
          href="/guide"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          User Guide →
        </Link>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Everything that changed in the tracker, newest first. Something missing or unclear? Tell
        Claude.
      </p>

      {CHANGELOG.map((entry) => (
        <section key={entry.date} className="mb-7">
          <h2 className="text-sm font-semibold text-foreground mb-3 pb-1.5 border-b border-border">
            {formatDate(entry.date)}
          </h2>

          {ORDER.map((kind) => {
            const items = entry.changes.filter((c) => c.kind === kind)
            if (items.length === 0) return null
            return (
              <div key={kind} className="mb-3 last:mb-0">
                <h3
                  className={`text-[11px] font-semibold tracking-widest mb-1.5 ${KIND_STYLE[kind]}`}
                >
                  {kind}
                </h3>
                <ul className="space-y-1.5">
                  {items.map((c, i) => (
                    <li key={i} className="text-sm text-foreground/90 flex gap-2 leading-relaxed">
                      <span className="text-muted-foreground/50 select-none shrink-0">·</span>
                      <span>{c.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

/** "August 27, 2026" — spelled out, because this page is read by people, and a
 *  numeric date is ambiguous between the US and everywhere else. Parsed as parts
 *  rather than `new Date(iso)`, which would treat the string as UTC midnight and
 *  render the day before for anyone west of London. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
