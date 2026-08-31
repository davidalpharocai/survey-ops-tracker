import { requireSalesUser, mySalespersonName } from '@/lib/sales-auth'
import { fmtNum } from '@/lib/utils/number'

export const dynamic = 'force-dynamic'

/** The N fields, exactly as the product team sees them (David: "really, all of
 *  the same n fields that the product team sees"). n_target is the FLOOR of a
 *  range since migration 078, so showing it alone would misreport a project
 *  scoped as "100–500" as simply 100. */
type Row = {
  project_code: string | null
  project_name: string
  client: string | null
  requested_by_name: string | null
  board_column: string
  status: string
  n_target: number | null
  n_target_max: number | null
  n_internal_target: number | null
  n_collected: number
  n_actual: number | null
  deliver_date: string | null
}

/** "100 – 500", "100", or "—". The range is one cell because the two numbers
 *  are one fact; splitting them invites reading the floor as the target. */
function targetText(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—'
  if (min != null && max != null && max !== min) return `${fmtNum(min)} – ${fmtNum(max)}`
  return fmtNum((min ?? max) as number)
}

/** Progress against the floor of the range — the number that has to be hit.
 *  Against the ceiling every healthy project would look behind. */
function pct(collected: number, min: number | null): number | null {
  if (!min || min <= 0) return null
  return Math.round((collected / min) * 100)
}

const STAGE_TONE: Record<string, string> = {
  Fielding: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  'Data QA': 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  Delivery: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

export default async function SalesPipelinePage() {
  const { supabase, user } = await requireSalesUser('/sales')
  const name = await mySalespersonName(supabase, user.email)

  // Read as the USER, not the admin client. Migration 093's policy restricts
  // this to `salesperson = my_salesperson_name()`, so the scoping is enforced by
  // Postgres and there is no filter here that a future edit could drop. The
  // absence of a `.eq('salesperson', …)` below is the point, not an omission.
  const { data, error } = await supabase
    .from('survey_projects')
    // One literal string, not concatenated: PostgREST's types parse the select
    // at compile time, and a `+` defeats that inference — the rows come back as
    // GenericStringError[] and the cast below stops being checked at all.
    .select(
      'project_code, project_name, client, requested_by_name, board_column, status, n_target, n_target_max, n_internal_target, n_collected, n_actual, deliver_date'
    )
    .eq('status', 'Open')
    .order('deliver_date', { ascending: true, nullsFirst: false })

  const rows = (data ?? []) as Row[]

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">Open surveys</h1>
        {name && <span className="text-sm text-muted-foreground">{name}</span>}
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Everything currently open on your accounts, soonest delivery first.
      </p>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Couldn&apos;t load your surveys. Try again, or tell David if it keeps happening.
        </p>
      )}

      {/* An empty list is ambiguous — no work, or scoping that failed to match?
          Say which, because a salesperson who cannot tell will assume the tool is
          broken (and on the evidence of a blank page, fairly). */}
      {!error && rows.length === 0 && (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          {name
            ? `No open surveys are currently assigned to ${name}.`
            : 'Your account is not linked to a salesperson yet — ask David to finish setting it up.'}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {['Survey', 'Requested by', 'Stage', 'Target', 'Internal', 'Collected', 'Deliver'].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-2.5 text-[11px] font-normal uppercase tracking-widest text-muted-foreground ${i >= 3 && i <= 5 ? 'text-right' : ''}`}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const p = pct(r.n_collected, r.n_target)
                return (
                  <tr key={r.project_code ?? i} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3">
                      <span className="block font-medium">{r.project_name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.project_code ? <span className="font-mono">{r.project_code}</span> : null}
                        {r.project_code && r.client ? ' · ' : ''}
                        {r.client}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.requested_by_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${STAGE_TONE[r.board_column] ?? 'bg-muted text-muted-foreground'}`}
                      >
                        {r.board_column}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {targetText(r.n_target, r.n_target_max)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                      {r.n_internal_target != null ? fmtNum(r.n_internal_target) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {/* n_actual is the delivered figure and supersedes n_collected
                          once it exists — showing the in-field count on a delivered
                          study would understate what the client received. */}
                      {fmtNum(r.n_actual ?? r.n_collected)}
                      {p != null && (
                        <span
                          className={`ml-1.5 text-xs ${p >= 100 ? 'text-emerald-600 dark:text-emerald-400' : p >= 60 ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}
                        >
                          {p}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.deliver_date ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground/70">
        {rows.length > 0 && `${rows.length} open survey${rows.length === 1 ? '' : 's'}. `}
        What each study is worth in credits or dollars is coming — that lives in the credit system
        and isn&apos;t connected yet.
      </p>
    </div>
  )
}
