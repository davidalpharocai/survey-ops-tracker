'use client'

/**
 * The pieces every finance tab is built from.
 *
 * ── ONE RULE ────────────────────────────────────────────────────────────────
 * No figure renders without the population it was computed on. `Figure` makes
 * the caption a required prop rather than an optional one, because the whole
 * history of this page is numbers that were right about a subset and read as
 * though they were about the business.
 */

import { InfoTooltip } from '@/components/shared/InfoTooltip'

export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
export const money2 = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Money at the precision the number deserves: cents under $10, whole dollars
 *  above. A panel complete at "$2" loses the decision; a $78,000 overrun does
 *  not need its cents. */
export const moneyAuto = (n: number) => (Math.abs(n) < 10 ? money2(n) : money(n))
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
/** A rate as a percentage, at the precision it actually needs. Blast response
 *  is 0.1186% — one decimal place renders that as "0.1%" and throws the
 *  decision away, so small rates keep their digits. */
export const pct1 = (x: number) => {
  const v = x * 100
  if (v === 0) return '0%'
  if (v < 0.01) return v.toFixed(4) + '%'
  if (v < 1) return v.toFixed(3) + '%'
  if (v < 10) return v.toFixed(1) + '%'
  return Math.round(v) + '%'
}

export function Card({ title, tip, children, wide, tone }: {
  title: string
  tip?: string
  children: React.ReactNode
  wide?: boolean
  /** `alert` is for a band that describes money still moving — it earns colour
   *  because it is the one thing on the page that is a phone call. */
  tone?: 'alert'
}) {
  return (
    <section className={
      'overflow-hidden rounded-xl border bg-card shadow-sm ' +
      (tone === 'alert' ? 'border-red-500/40 ' : 'border-border ') +
      (wide ? 'lg:col-span-2' : '')
    }>
      <h2 className={
        'flex items-center gap-2 border-b px-4 py-2.5 ' +
        (tone === 'alert' ? 'border-red-500/30 bg-red-500/5' : 'border-border')
      }>
        <span className={
          'text-xs font-medium uppercase tracking-widest ' +
          (tone === 'alert' ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground')
        }>{title}</span>
        {tip && <InfoTooltip text={tip} />}
      </h2>
      {children}
    </section>
  )
}

export function Bar({ value, max, tone = 'primary' }: {
  value: number; max: number; tone?: 'primary' | 'neg' | 'pos' | 'muted'
}) {
  const w = max > 0 ? Math.max(1, Math.round((Math.abs(value) / max) * 100)) : 0
  const bg = tone === 'neg' ? 'bg-red-500'
    : tone === 'pos' ? 'bg-emerald-500'
      : tone === 'muted' ? 'bg-muted-foreground/40' : 'bg-primary'
  return (
    <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-muted">
      <span className={`block h-full rounded-full ${bg}`} style={{ width: `${w}%` }} />
    </span>
  )
}

/** A headline number. `sub` is REQUIRED — it carries the population, and a
 *  figure without one is the bug this page keeps having. */
export function Figure({ value, label, sub, tone, size = 'lg' }: {
  value: string; label: string; sub: string
  tone?: 'neg' | 'pos'; size?: 'lg' | 'md'
}) {
  const c = tone === 'neg' ? 'text-red-600 dark:text-red-400'
    : tone === 'pos' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
  return (
    <div className="px-4 py-3">
      <div className={`tabular-nums font-semibold ${size === 'lg' ? 'text-2xl' : 'text-lg'} ${c}`}>{value}</div>
      <div className="mt-0.5 text-sm">{label}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{sub}</div>
    </div>
  )
}

/** A simple key/value row. */
export function Row({ k, v, sub, tone }: {
  k: React.ReactNode; v: React.ReactNode; sub?: React.ReactNode; tone?: 'neg' | 'pos'
}) {
  const c = tone === 'neg' ? 'text-red-600 dark:text-red-400'
    : tone === 'pos' ? 'text-emerald-600 dark:text-emerald-400' : ''
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{k}</span>
        <span className={`shrink-0 tabular-nums ${c}`}>{v}</span>
      </div>
      {sub && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{sub}</div>}
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
 * A project code that is a real anchor.
 *
 * David has asked twice for `<a href>` on every linked element so that
 * right-click, middle-click and cmd-click work. A table of 84 rows wired to
 * onClick is precisely the trap he named.
 */
export function ProjectLink({ id, code }: { id: string; code: string | null }) {
  return (
    <a
      href={`/projects/${id}`}
      className="font-medium text-primary underline-offset-2 hover:underline"
      onClick={e => e.stopPropagation()}
    >
      {code ?? '(no code)'}
    </a>
  )
}
