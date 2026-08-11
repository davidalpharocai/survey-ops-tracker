import { NextRequest } from 'next/server'
import { startOfWeek, addDays, format, parseISO } from 'date-fns'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { sendAndLog } from '@/lib/email/send'
import { baseRerunName } from '@/lib/utils/rerun'
import { bucketRerunCalendar, buildRerunDigest, type RerunCalendarRow } from '@/lib/reruns/digest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Weekly "Rerun digest": every Monday, one email to Sree (cc David) summarizing
// the week's rerun calendar in four cuts (overdue/needs action, fielding this
// week, delivering this week, next-week preview). Unions the NEW model
// (rerun_series_status, migration 073) with the LEGACY sheet-mirrored
// rerun_status view so nothing is invisible during the seed transition (spec
// §12/§18) — de-duped by client+survey once a study exists in both. Always
// returns 200 so Vercel Cron doesn't retry and double-send.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

function todayEastern(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/** Monday of the current week, computed against America/New_York so a
 * Sunday-night/Monday-morning UTC cron run lands on the right week. */
function mondayOfThisWeekEastern(): string {
  const monday = startOfWeek(parseISO(todayEastern()), { weekStartsOn: 1 })
  return format(monday, 'yyyy-MM-dd')
}

function cadenceLabelFromMonths(m: number | null): string | null {
  if (m == null) return null
  const known: Record<number, string> = { 1: 'Monthly', 3: 'Quarterly', 6: 'Every 6 mo', 12: 'Yearly' }
  return known[m] ?? `Every ${m} mo`
}

/** Normalized dedup key: client + base survey name (strips a trailing
 * "- Nth Rerun" so a legacy sheet label matches its seeded series name). */
function calendarKey(client: string, surveyName: string): string {
  return `${client.trim().toLowerCase()}::${baseRerunName(surveyName).trim().toLowerCase()}`
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://survey-ops-tracker.vercel.app'
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const supabase = createAdminClient()
  const weekStartISO = mondayOfThisWeekEastern()
  const weekEndISO = format(addDays(parseISO(weekStartISO), 6), 'yyyy-MM-dd')

  // 1) New model: per-series overdue / needs-definition / next-due facts.
  const { data: seriesRows, error: seriesErr } = await supabase
    .from('rerun_series_status')
    .select('id, client, survey_name, cadence_months, next_wave_no, effective_next, is_overdue, paused, in_service')

  if (seriesErr) {
    await logSystemEvent({ source: 'rerun-digest', status: 'error', detail: `rerun_series_status query failed: ${seriesErr.message}` })
    return Response.json({ sent: false, reason: 'series_query_failed' })
  }

  const seriesById = new Map((seriesRows ?? []).map((s) => [s.id, s]))

  const seriesCalendarRows: RerunCalendarRow[] = (seriesRows ?? []).map((s) => ({
    client: s.client,
    surveyName: s.survey_name,
    waveNo: s.next_wave_no,
    cadenceLabel: cadenceLabelFromMonths(s.cadence_months),
    isOverdue: !!s.is_overdue,
    needsDefinition: !s.paused && s.in_service && s.cadence_months == null,
    effectiveDueISO: s.effective_next,
    launchDateISO: null,
    deliverDateISO: null,
  }))

  // 2) New model: concrete waves (survey_projects rows) fielding or delivering
  // in-window. rerun_series_status only carries a series-level "next due"
  // prediction, not per-wave launch/deliver dates, so this is queried
  // separately and joined client-side against the series map above.
  const { data: waveRows, error: waveErr } = await supabase
    .from('survey_projects')
    .select('client, project_name, rerun_number, launch_date, deliver_date, series_id')
    .not('series_id', 'is', null)
    .is('deleted_at', null)
    .or(
      `and(launch_date.gte.${weekStartISO},launch_date.lte.${weekEndISO}),` +
        `and(deliver_date.gte.${weekStartISO},deliver_date.lte.${weekEndISO})`
    )

  if (waveErr) {
    await logSystemEvent({ source: 'rerun-digest', status: 'error', detail: `survey_projects wave query failed: ${waveErr.message}` })
  }

  const waveCalendarRows: RerunCalendarRow[] = (waveRows ?? []).map((w) => {
    const series = w.series_id ? seriesById.get(w.series_id) : undefined
    return {
      client: w.client,
      surveyName: series?.survey_name ?? baseRerunName(w.project_name),
      waveNo: w.rerun_number,
      cadenceLabel: cadenceLabelFromMonths(series?.cadence_months ?? null),
      isOverdue: false,
      needsDefinition: false,
      effectiveDueISO: null,
      launchDateISO: w.launch_date,
      deliverDateISO: w.deliver_date,
    }
  })

  // 3) Legacy sheet-mirrored reruns — union during the seed transition so
  // nothing is invisible pre-seed. Skip any study already represented by a
  // seeded series (client + base survey name match).
  const seriesKeys = new Set((seriesRows ?? []).map((s) => calendarKey(s.client, s.survey_name)))
  const { data: legacyRows, error: legacyErr } = await supabase
    .from('rerun_status')
    .select('client, display_name, cadence, work, cadence_months, effective_due, is_overdue, needs_definition')

  if (legacyErr) {
    await logSystemEvent({ source: 'rerun-digest', status: 'error', detail: `rerun_status query failed (continuing without legacy union): ${legacyErr.message}` })
  }

  const legacyCalendarRows: RerunCalendarRow[] = (legacyRows ?? [])
    .filter((r) => r.client)
    .map((r) => ({
      client: r.client as string,
      surveyName: r.display_name || r.cadence || r.work || '(unlabeled)',
      cadenceLabel: cadenceLabelFromMonths(r.cadence_months),
      isOverdue: !!r.is_overdue,
      needsDefinition: !!r.needs_definition,
      effectiveDueISO: r.effective_due,
      launchDateISO: null,
      deliverDateISO: null,
      waveNo: null as number | null,
    }))
    .filter((r) => !seriesKeys.has(calendarKey(r.client, r.surveyName)))

  const buckets = bucketRerunCalendar(
    [...seriesCalendarRows, ...waveCalendarRows, ...legacyCalendarRows],
    weekStartISO
  )
  const digest = buildRerunDigest({ ...buckets, weekStartISO, weekEndISO, baseUrl: baseUrl() })

  const ok = await sendAndLog({
    to: process.env.RERUN_DIGEST_TO ?? 'sreerag@alpharoc.ai',
    cc: process.env.RERUN_DIGEST_CC ?? 'david@alpharoc.ai',
    subject: digest.subject,
    html: digest.html,
    template: 'rerun_digest',
    submissionId: null,
  })

  const counts = {
    overdue: buckets.overdue.length,
    fielding: buckets.fielding.length,
    delivering: buckets.delivering.length,
    upcoming: buckets.upcoming.length,
  }

  if (ok) {
    await logSystemEvent({ source: 'rerun-digest', status: 'ok', detail: `Sent rerun digest for week of ${weekStartISO}.`, meta: counts })
  } else {
    await logSystemEvent({ source: 'rerun-digest', status: 'error', detail: `Failed to send rerun digest for week of ${weekStartISO}.`, meta: counts })
  }

  return Response.json({ sent: ok, weekStartISO, weekEndISO, ...counts })
}
