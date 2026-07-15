import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { sendAndLog } from '@/lib/email/send'
import { buildRerunNudge, type NudgeItem } from '@/lib/reruns/nudgeDigest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Per-owner rerun nudges: emails each owner ONE digest of their reruns that are
// overdue or due within their lead time. Dedup is per-wave — prep_nudged_for /
// overdue_nudged_for hold the effective_due already nudged, so logging a wave
// (which moves effective_due) re-arms the next one, and nothing double-sends.
//
// OFF by default: only runs when RERUN_NUDGES_ENABLED is "true"/"1"/"yes". This is
// the team-facing email switch — kept dark until email transport + owner
// assignments are confirmed (the in-app review ritual + Slack digest cover the gap
// meanwhile). Always returns 200 so Vercel Cron doesn't retry and double-send.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

function nudgesEnabled(): boolean {
  const v = (process.env.RERUN_NUDGES_ENABLED ?? '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

function titleOf(r: { client: string | null; cadence: string | null }): string {
  const client = (r.client ?? '').trim()
  const cadence = (r.cadence ?? '').trim()
  if (client && cadence) return `${client} — ${cadence}`
  return client || cadence || 'Rerun'
}

type OwnerItem = {
  key: string
  due: string
  kind: 'prep' | 'overdue'
  item: NudgeItem
  backup: string | null
  prior: string | null // the dedup value before this run — restored if the send fails
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })
  if (!nudgesEnabled()) return Response.json({ enabled: false, owners: 0, sent: 0 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('rerun_status')
    .select(
      'rerun_key, client, cadence, owner_email, backup_owner_email, effective_due, days_to_due, is_overdue, in_prep_window, prep_nudged_for, overdue_nudged_for'
    )

  if (error) {
    await logSystemEvent({ source: 'rerun-nudges', status: 'error', detail: `Query failed: ${error.message}` })
    return Response.json({ enabled: true, owners: 0, sent: 0, failed: 0 })
  }

  // Group the freshly-armed items (not yet nudged for this wave) by owner.
  const byOwner = new Map<string, OwnerItem[]>()
  for (const r of data ?? []) {
    const owner = (r.owner_email ?? '').trim()
    if (!owner || !r.rerun_key || !r.effective_due) continue

    const push = (kind: 'prep' | 'overdue', prior: string | null) => {
      const list = byOwner.get(owner) ?? []
      list.push({
        key: r.rerun_key!,
        due: r.effective_due!,
        kind,
        prior,
        backup: (r.backup_owner_email ?? '').trim() || null,
        item: { title: titleOf(r), due: r.effective_due, daysToDue: r.days_to_due },
      })
      byOwner.set(owner, list)
    }

    // overdue vs prep are mutually exclusive per row (the view gates them on
    // effective_due < today vs >= today), so a row contributes at most one item.
    if (r.is_overdue && r.overdue_nudged_for !== r.effective_due) push('overdue', r.overdue_nudged_for)
    else if (r.in_prep_window && r.prep_nudged_for !== r.effective_due) push('prep', r.prep_nudged_for)
  }

  const colOf = (i: OwnerItem) => (i.kind === 'overdue' ? 'overdue_nudged_for' : 'prep_nudged_for')

  let sent = 0
  let failed = 0

  for (const [owner, items] of byOwner) {
    // CLAIM each wave before sending, with a compare-and-set: set the dedup column
    // to effective_due only where it's still the pre-run value. The row count tells
    // us whether THIS run won the claim — so two overlapping invocations can't both
    // send (the loser's CAS matches 0 rows), and the error is inspected (unlike a
    // fire-and-forget update, which could silently re-arm and double-send).
    const claimed: OwnerItem[] = []
    for (const i of items) {
      const col = colOf(i)
      const setDue = i.kind === 'overdue' ? { overdue_nudged_for: i.due } : { prep_nudged_for: i.due }
      let q = supabase.from('rerun_meta').update(setDue).eq('rerun_key', i.key)
      // Guard: only claim if the column still equals the value we read (NULL-safe).
      q = i.prior === null ? q.is(col, null) : q.eq(col, i.prior)
      const { data: rows, error: claimErr } = await q.select('rerun_key')
      if (claimErr) {
        await logSystemEvent({
          source: 'rerun-nudges',
          status: 'error',
          detail: `Claim update failed for ${i.key} (${col}); skipping to avoid a wrong send: ${claimErr.message}`,
        })
        continue
      }
      if (rows && rows.length === 1) claimed.push(i) // we won this wave; 0 rows = another run already took it
    }

    if (claimed.length === 0) continue

    const overdue = claimed.filter((i) => i.kind === 'overdue')
    const prep = claimed.filter((i) => i.kind === 'prep')
    const backup = claimed.find((i) => i.backup)?.backup ?? null
    const digest = buildRerunNudge(owner, overdue.map((i) => i.item), prep.map((i) => i.item), backup)

    const ok = await sendAndLog({
      to: owner,
      subject: digest.subject,
      html: digest.html,
      template: 'rerun_nudge',
      submissionId: null,
    })

    if (ok) {
      sent++
    } else {
      failed++
      // Send failed — release the claims (restore the prior dedup value) so the next
      // run retries instead of the wave staying marked-but-never-emailed.
      await Promise.all(
        claimed.map((i) =>
          supabase
            .from('rerun_meta')
            .update(i.kind === 'overdue' ? { overdue_nudged_for: i.prior } : { prep_nudged_for: i.prior })
            .eq('rerun_key', i.key)
        )
      )
      await logSystemEvent({
        source: 'rerun-nudges',
        status: 'error',
        detail: `Failed to send rerun nudge to ${owner} (${claimed.length} item(s)); claims rolled back for retry.`,
      })
    }
  }

  if (byOwner.size > 0 && failed === 0) {
    await logSystemEvent({ source: 'rerun-nudges', status: 'ok', detail: `Sent ${sent} rerun nudge(s).` })
  }

  return Response.json({ enabled: true, owners: byOwner.size, sent, failed })
}
