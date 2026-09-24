import Link from 'next/link'
import { requireSalesUser, mySalesIdentity } from '@/lib/sales-auth'
import { salesHeaderLabel } from '@/lib/sales/identity'
import { fmtNum } from '@/lib/utils/number'
import { deliveredN, type DeliveryInput } from '@/lib/sales/deliveredN'
import { salesHome, daysBetween, type HomeRow, type Judged, type Kind } from '@/lib/sales/home'
import { HomeSearch, type HomeSearchRow } from '@/components/sales/HomeSearch'

export const dynamic = 'force-dynamic'

/**
 * The sales landing page. /sales now sends people here instead of to the table.
 *
 * The judgement lives in lib/sales/home.ts and is tested there; this file reads
 * rows and renders them. Nothing here reads project_audit — see that module's
 * header for why a "what changed" feed was the wrong build.
 */

const TODAY = () => new Date().toISOString().slice(0, 10)

const KIND_STYLE: Record<Exclude<Kind, 'ok'>, { label: string; className: string }> = {
  late: { label: 'Late', className: 'bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/30' },
  due: { label: 'Due soon', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  over: { label: 'Over', className: 'bg-muted text-muted-foreground border-border' },
}

/**
 * "2 days ago", and — the case that matters — "never updated".
 *
 * Of the 30 surveys in field on 2026-09-14, only 12 had ever recorded an
 * n_collected change; among those the figures were fresh (median 2 days, oldest
 * 11). So the common case is not a stale number, it is one that has never been
 * touched — and a survey showing 0 of 400 with no history is not behind, it is
 * UNMEASURED. Returns null when we could not read freshness at all, because
 * "we don't know" must not be rendered as "never".
 */
function freshness(last: string | undefined, today: string, available: boolean) {
  if (!available) return null
  if (!last) return { text: 'N never updated', stale: true, title: 'No change to N collected has ever been recorded for this survey, so this figure is not a measurement — it is the value the row was created with.' }
  const d = daysBetween(today, last.slice(0, 10))
  const text = d <= 0 ? 'N updated today' : d === 1 ? 'N updated yesterday' : `N updated ${d} days ago`
  return { text, stale: d > 7, title: `N collected last changed ${last.slice(0, 10)}.` }
}

function Card({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-border bg-card">
      <h2 className="flex items-baseline gap-2 border-b border-border px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</span>
        {aside && <span className="ml-auto text-xs text-muted-foreground">{aside}</span>}
      </h2>
      {children}
    </section>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

/** Collected over promised, with the percentage beneath — David, 2026-09-11.
 *  No target means NO percentage: a blank denominator rendered as 0% reads as
 *  failure, and "not set" and "none collected" are opposite problems. */
/**
 * Delivered N against target.
 *
 * Shows n_actual where it is recorded, and a PROJECTION where it is not —
 * David, 2026-09-17: "the N vs target should be the N actual if its filled in.
 * otherwise it should be an estimated number … if the PS survey target is 1000
 * and we collected 2000, it shouldnt be 2000/1000".
 *
 * The old cell showed raw collection, so an over-collected study read as 200%
 * of target and a salesperson would tell a client they were getting 2,000
 * interviews. They are not: a study that over-collects delivers roughly what it
 * sold. An estimate is marked with ~ and carries its reasoning in the title.
 */
function NCell({ row }: { row: DeliveryInput }) {
  const d = deliveredN(row)
  const target = row.n_target
  if (!d) {
    return (
      <div className="shrink-0 text-right leading-tight">
        <div className="text-sm tabular-nums text-muted-foreground">—</div>
        <div className="text-[11px] text-muted-foreground">nothing collected yet</div>
      </div>
    )
  }
  const pct = target ? Math.round((d.value / target) * 100) : null
  return (
    <div className="shrink-0 text-right leading-tight" title={d.note || undefined}>
      <div className="text-sm tabular-nums">
        {d.estimated && <span className="text-muted-foreground">~</span>}
        {fmtNum(d.value)}
        {target != null && <span className="text-muted-foreground">/{fmtNum(target)}</span>}
      </div>
      <div className={`text-[11px] tabular-nums ${
        !d.estimated && pct != null && pct >= 100
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-muted-foreground'
      }`}>
        {pct == null ? 'no target set' : `${pct}%`}
        {d.estimated && <span className="ml-1 italic">est.</span>}
      </div>
    </div>
  )
}

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0 hover:bg-muted/30">
      {children}
    </Link>
  )
}

export default async function SalesHomePage() {
  const { supabase, user } = await requireSalesUser('/sales/home')
  const identity = await mySalesIdentity(supabase, user.email)
  const name = salesHeaderLabel(identity)
  const today = TODAY()

  /* Paged. PostgREST caps a response at 1000 rows and truncates SILENTLY, so a
     salesperson whose book crossed that line would simply stop seeing their
     oldest work with nothing to indicate it. select('*') rather than a column
     list because the view is already an allowlist — naming columns here only
     creates a second place to forget one. */
  const rows: HomeRow[] = []
  let failed = false
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('sales_projects').select('*').range(from, from + 999)
    if (error) { failed = true; break }
    rows.push(...(data as unknown as HomeRow[]))
    if (!data || data.length < 1000) break
  }

  /* Freshness comes from a separate, deliberately two-column view (migration
     111). Cast because 111 is applied BY HAND and lib/supabase/types.ts is
     generated from the live schema, so the view is not in the type union until
     David runs it.

     `haveFreshness` is the important part, not the map. If this read fails —
     because the migration has not been applied yet, or the view is denied — an
     absent row would otherwise render as "N never updated", which is a claim
     about the data rather than about our access to it. Those are different
     statements and only one of them is true, so a failed read must say nothing
     at all. Same NULL-vs-0 discipline as everywhere else. */
  const freshRes = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => Promise<{
        data: { project_id: string; last_updated: string }[] | null
        error: unknown
      }>
    }
  }).from('sales_n_collected_freshness').select('*')
  const haveFreshness = !freshRes.error
  const lastUpdated = new Map<string, string>(
    (freshRes.data ?? []).map(f => [f.project_id, f.last_updated]),
  )

  const h = salesHome(rows, today)

  if (failed) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Couldn&apos;t load your surveys. Try again, or tell David if it keeps happening.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Today</h1>
        {name && <span className="text-sm text-muted-foreground">{name}</span>}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {fmtNum(h.counts.inField)} in field · {fmtNum(h.counts.scoping)} in scoping ·{' '}
        {fmtNum(h.counts.delivered)} delivered to date
      </p>

      {/* Searches the WHOLE book already loaded above, not the ~25 rows the
          cards below show. Renders nothing until someone types, so the curated
          view stays the default. */}
      <HomeSearch rows={rows as unknown as HomeSearchRow[]} />

      <Card
        title="In field now"
        aside={
          h.counts.needing
            ? `${h.counts.needing} of ${h.counts.inField} late or due inside three days — those sort first`
            : `all ${h.counts.inField} on pace`
        }
      >
        {h.inField.length === 0 ? (
          <Empty title="Nothing in field" body="No study of yours is collecting right now." />
        ) : (
          h.inField.map((j: Judged) => {
            const f = freshness(lastUpdated.get(j.row.id), today, haveFreshness)
            const pct = j.pct == null ? null : Math.min(100, j.pct)
            return (
              <Row key={j.row.id} href={`/sales/surveys/${j.row.id}`}>
                <span className="w-[68px] shrink-0 text-center">
                  {j.kind !== 'ok' && (
                    <span className={`inline-block rounded-full border px-2 py-px text-[11px] ${KIND_STYLE[j.kind].className}`}>
                      {KIND_STYLE[j.kind].label}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{j.row.project_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {j.row.client}
                    {j.commitDate ? ` · due ${j.commitDate}` : ' · no delivery date set'}
                    {j.why.length > 0 && ` · ${j.why.join(' · ')}`}
                  </span>
                  {pct != null && (
                    <span className={`mt-1.5 block h-[3px] w-full max-w-[260px] overflow-hidden rounded-full ${j.behind ? 'bg-red-500/20' : 'bg-muted'}`}>
                      <span className={`block h-full rounded-full ${j.behind ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                    </span>
                  )}
                  {/* How current the number is. Shown on EVERY row, not only the
                      stale ones — a freshness note that appears sometimes reads
                      as a warning about that row rather than as metadata. */}
                  {f && (
                    <span className={`mt-0.5 block text-[11px] ${f.stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/70'}`} title={f.title}>
                      {f.text}
                    </span>
                  )}
                </span>
                <NCell row={j.row} />
              </Row>
            )
          })
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Card title="Shipped · last 14 days" aside="delivered against promised">
            {h.shipped.length === 0 ? (
              <Empty title="Nothing shipped yet" body="Nothing of yours was delivered in the last two weeks." />
            ) : (
              h.shipped.slice(0, 8).map(r => (
                <Row key={r.id} href={`/sales/surveys/${r.id}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.project_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.client} · {r.deliver_date}</span>
                  </span>
                  <NCell row={r} />
                </Row>
              ))
            )}
            {h.shipped.length > 8 && (
              <p className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                {h.shipped.length - 8} more delivered in the last 14 days
              </p>
            )}
          </Card>
        </div>

        <div>
          <Card title="Stalled in scoping" aside="submitted 3+ weeks ago">
            {h.stalled.length === 0 ? (
              <Empty title="Scoping is moving" body="Nothing has been sitting unlaunched for three weeks." />
            ) : (
              h.stalled.map(r => (
                <Row key={r.id} href={`/sales/surveys/${r.id}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.project_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.client} · submitted {r.submitted_date}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {fmtNum(daysBetween(today, r.submitted_date as string))}d
                  </span>
                </Row>
              ))
            )}
          </Card>

          <Card title="Gone quiet" aside="nothing in flight, 60+ days">
            {h.quiet.length === 0 ? (
              <Empty title="Every account is active" body="None of your accounts has gone quiet." />
            ) : (
              h.quiet.slice(0, 6).map(q => (
                <Row key={q.client} href={`/sales/accounts?q=${encodeURIComponent(q.client)}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{q.client}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {fmtNum(q.delivered)} survey{q.delivered === 1 ? '' : 's'} delivered, nothing in flight
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtNum(q.daysSince)}d</span>
                </Row>
              ))
            )}
          </Card>
        </div>
      </div>

      {/* Stated, not hidden. A page that silently omits the rows it cannot judge
          reads as a complete picture, and this one is not. */}
      <p className="mt-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">What this page cannot tell you.</span> It is built
        only from what your view can see — dates, stage, N, account, contact. It does not read the change
        log.{' '}
        {h.blind.noDate > 0 && (
          <>
            {fmtNum(h.blind.noDate)} of your {fmtNum(h.counts.inField)} live studies carry no delivery
            date, so nothing above can say whether they are late.
          </>
        )}
      </p>
    </div>
  )
}
