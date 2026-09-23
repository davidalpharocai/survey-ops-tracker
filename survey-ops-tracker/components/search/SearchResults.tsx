'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fmtNum } from '@/lib/utils/number'
import type { Group } from '@/lib/search/run'

/**
 * The results page body, shared by the analyst and sales search pages.
 *
 * David, 2026-09-23: "it should be that if i type a word/characters in the
 * search and just press enter … it brings to a search page that shows where
 * that result came up in grouped by object (ie survey, contact, account, etc).
 * ive seen salesforce do this."
 *
 * ── THE SHAPE IS THE POINT ──────────────────────────────────────────────────
 * Salesforce's global search answers "where does this word appear" before it
 * answers "which record did you mean". So every object gets its own section
 * with its own count, and the chips narrow rather than re-search: the query ran
 * once, and clicking Surveys hides the other sections instead of asking the
 * database again. That is why the counts on the chips are trustworthy — they
 * are the same numbers the sections show.
 *
 * ── NO SILENT CAPS ──────────────────────────────────────────────────────────
 * A section shows eight rows and then says how many more there are. A list that
 * stops at eight without saying so reads as "that is all there is", which on a
 * search page is a wrong answer rather than a small one. Where the database
 * itself held more than we fetched, the footer says that too.
 */

const PREVIEW = 8

export function SearchResults({
  q, groups, total, initialObject, tierLabel,
}: {
  q: string
  groups: Group[]
  total: number
  initialObject: string | null
  tierLabel: string
}) {
  const router = useRouter()
  const [only, setOnly] = useState<string | null>(initialObject)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const shown = useMemo(
    () => groups.filter(g => (g.total > 0 || g.failed) && (!only || g.id === only)),
    [groups, only],
  )
  const withAny = useMemo(() => groups.filter(g => g.total > 0 || g.failed), [groups])

  function narrow(id: string | null) {
    setOnly(id)
    // Linkable: "surveys matching wealth" is a URL someone can send.
    const sp = new URLSearchParams({ q })
    if (id) sp.set('o', id)
    router.replace(`?${sp.toString()}`, { scroll: false })
  }

  const failedAll = withAny.length > 0 && withAny.every(g => g.failed)

  return (
    <div>
      <h1 className="text-xl font-semibold">
        Results for <span className="text-muted-foreground">&ldquo;{q}&rdquo;</span>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {total === 0
          ? `Nothing in ${tierLabel} matches that.`
          : `${fmtNum(total)} match${total === 1 ? '' : 'es'} across ${withAny.filter(g => !g.failed).length} ${
              withAny.filter(g => !g.failed).length === 1 ? 'object' : 'objects'
            }`}
      </p>

      {withAny.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Chip label="All" n={total} on={!only} onClick={() => narrow(null)} />
          {withAny.map(g => (
            <Chip key={g.id} label={g.label} n={g.total} on={only === g.id} onClick={() => narrow(g.id)} />
          ))}
        </div>
      )}

      {failedAll && (
        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          Every search failed to read. That is a permissions or connection problem, not an empty result —
          try again, and tell Claude if it keeps happening.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-5">
        {shown.map(g => {
          const open = expanded.has(g.id) || only === g.id
          const rows = open ? g.hits : g.hits.slice(0, PREVIEW)
          const more = g.total - rows.length
          return (
            <section key={g.id}>
              <h2 className="mb-2 flex items-baseline gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {g.label}
                {!g.failed && <span className="text-muted-foreground/60">{fmtNum(g.total)}</span>}
              </h2>

              {g.failed ? (
                <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                  Could not read {g.label.toLowerCase()} — this section is unknown, not empty.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  {rows.map(h => {
                    const body = (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{h.title}</span>
                          {h.subtitle && (
                            <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>
                          )}
                        </span>
                        {h.tag && (
                          <span className="shrink-0 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                            {h.tag}
                          </span>
                        )}
                      </>
                    )
                    return h.href ? (
                      // A real href, so middle-click and cmd-click work.
                      <Link
                        key={h.key}
                        href={h.href}
                        className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0 hover:bg-muted/30"
                      >
                        {body}
                      </Link>
                    ) : (
                      <span
                        key={h.key}
                        className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0"
                        title="This record has no page of its own to open."
                      >
                        {body}
                      </span>
                    )
                  })}

                  {more > 0 && (
                    <div className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                      {g.hits.length > rows.length ? (
                        <button
                          type="button"
                          className="underline hover:text-foreground"
                          onClick={() => setExpanded(s => new Set(s).add(g.id))}
                        >
                          Show all {fmtNum(g.hits.length)} loaded
                        </button>
                      ) : (
                        // The database held more than we asked for. Say the real
                        // number rather than let the list imply it is complete.
                        <span>
                          Showing {fmtNum(rows.length)} of {fmtNum(g.total)} — narrow the search to see the rest.
                        </span>
                      )}
                      {g.hits.length > rows.length && g.total > g.hits.length && (
                        <span> · {fmtNum(g.total)} match in total</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {total === 0 && !failedAll && (
        <div className="mt-4 rounded-lg border border-border bg-card px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">No record matches &ldquo;{q}&rdquo;.</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Search matches names, codes, emails and the text of notes and activity — try a shorter word,
            or part of a survey code.
          </p>
        </div>
      )}
    </div>
  )
}

function Chip({ label, n, on, onClick }: { label: string; n: number; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        on ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {label} <span className="tabular-nums opacity-70">{fmtNum(n)}</span>
    </button>
  )
}
