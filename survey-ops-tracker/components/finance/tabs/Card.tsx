'use client'

/**
 * The one card frame every finance tile uses, and the small pieces inside it.
 *
 * ── WHY THE SCOPE CHIP IS A REQUIRED PROP ───────────────────────────────────
 * The history of this page is numbers that were right about a subset and read
 * as though they were about the business. A card cannot render without saying
 * which surveys it counts ("Delivered · 1 Jun–27 Sep 2026 · BAM · 41 surveys"),
 * and a filter the tab does not apply is named on the card rather than
 * silently ignored (finance spec, rule 1).
 *
 * ── WHY A BLOCKED READ REPLACES THE BODY ────────────────────────────────────
 * A failed read is not $0. When a table the card needs did not load, the card
 * says so by name and draws nothing, so no figure is ever computed on a
 * missing input (rule 6).
 */

import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { blockedText, type Blocked } from '@/lib/finance/load'
import { blockedFor, type Needs } from './types'

export function FinanceCard({
  id, title, help, scope, ignored, needs = [], blocked = [], verdict, actions, children, tone,
}: {
  /** Anchor id, so a link can jump to the card. */
  id?: string
  title: string
  /** One or two plain sentences for the (i). */
  help: string
  /** The scope chip text, usually `props.scope.chip`. */
  scope: string
  /** Filters this card does not apply, in words (`props.scope.ignored`). */
  ignored?: string[]
  /** Tables this card's figures are computed from. */
  needs?: Needs
  /** `props.load.blocked`. */
  blocked?: Blocked[]
  /** The computed closing sentence with a verb (rule 7). */
  verdict?: React.ReactNode
  /** Small controls in the header (a group-by picker, a toggle). */
  actions?: React.ReactNode
  children: React.ReactNode
  /** `alert` is for money still moving — the one thing on the page that is a
   *  phone call earns colour. */
  tone?: 'alert'
}) {
  const failed = blockedFor(blocked, needs)
  return (
    <section
      id={id}
      className={
        'min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm ' +
        (tone === 'alert' ? 'border-red-500/40' : 'border-border')
      }
    >
      <header className={
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 ' +
        (tone === 'alert' ? 'border-red-500/30 bg-red-500/5' : 'border-border')
      }>
        <h2 className="flex items-center text-sm font-semibold">
          {title}
          <InfoTooltip text={help} />
        </h2>
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
          title="The studies this card counts. Change them with the filters at the top of the page."
        >
          {scope}
        </span>
        {ignored?.map(t => (
          <span
            key={t}
            className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground"
            title="This card does not apply that filter."
          >
            {t}
          </span>
        ))}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {failed.length > 0 ? (
        <div role="alert" className="px-4 py-6 text-sm text-red-700 dark:text-red-400">
          {failed.map(b => (
            <p key={b.table} title={b.message}>{blockedText(b.table)}. Nothing on this card is shown until it does.</p>
          ))}
        </div>
      ) : (
        <>
          {children}
          {verdict && (
            <p className="border-t border-border bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed">
              {verdict}
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** A headline number. `sub` is REQUIRED — it carries the population or the
 *  caveat, and a figure without one is the bug this page keeps having. */
export function Figure({ value, label, help, sub, tone, onOpen, openLabel }: {
  value: string
  label: string
  help?: string
  sub: React.ReactNode
  tone?: 'price' | 'cost' | 'keep' | 'loss'
  /** Opens the drill behind the figure. */
  onOpen?: () => void
  openLabel?: string
}) {
  const colour = tone === 'price' ? 'text-[var(--chart-price)]'
    : tone === 'cost' ? 'text-[var(--chart-cost)]'
      : tone === 'keep' ? 'text-[var(--chart-keep)]'
        : tone === 'loss' ? 'text-[var(--chart-loss)]' : 'text-foreground'
  const number = <span className={`text-2xl font-semibold tabular-nums ${colour}`}>{value}</span>
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="flex items-center text-xs uppercase tracking-wide text-muted-foreground">
        {label}
        {help && <InfoTooltip text={help} />}
      </div>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          title={openLabel ?? 'Show the studies behind this figure'}
          className="mt-0.5 rounded text-left underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--chart-price)]"
        >
          {number}
        </button>
      ) : (
        <div className="mt-0.5">{number}</div>
      )}
      <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{sub}</div>
    </div>
  )
}

/** The caveat that belongs under a number, in the same block as the number. */
export function Note({ children, tone }: { children: React.ReactNode; tone?: 'neg' }) {
  return (
    <p className={
      'bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed ' +
      (tone === 'neg' ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground')
    }>
      {children}
    </p>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}

/**
 * A survey code that is a real anchor.
 *
 * David has asked twice for `<a href>` on every linked element so that
 * right-click, middle-click and cmd-click work. `stopPropagation` keeps a click
 * on the code from also opening the row's drill.
 */
export function ProjectLink({ id, code }: { id: string; code: string | null }) {
  return (
    <Link
      href={`/projects/${id}`}
      className="font-medium text-primary underline-offset-2 hover:underline"
      onClick={e => e.stopPropagation()}
    >
      {code ?? '(no code)'}
    </Link>
  )
}
