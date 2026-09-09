/**
 * Bulk-import B2B blasts from a Campaign Manager CSV export into SOCC.
 *
 *   node scripts/import-cm-blasts.mjs <file.csv>            # dry run + report
 *   node scripts/import-cm-blasts.mjs <file.csv> --apply    # writes
 *   node scripts/import-cm-blasts.mjs <file.csv> --report out.md
 *
 * DRY RUN BY DEFAULT, and idempotent: keyed on project_blasts.cm_blast_id
 * (migration 106), so a second run inserts nothing and updates in place.
 *
 * WHAT IT WILL NOT DO
 *   * Guess a project. A survey id that resolves to no project, or to more than
 *     one, is REPORTED and skipped. Nothing is created.
 *   * Duplicate a hand-logged blast. Blasts entered by hand carry no
 *     cm_blast_id; where one matches on (same day, same sent, same completes)
 *     the import ADOPTS it — stamping the id onto the existing row — rather than
 *     inserting a second copy of the same send.
 *
 * TWO DELIBERATE DEPARTURES FROM THE WRITTEN HANDOFF, both on David's own
 * instruction in chat, both stated in the report so the difference is visible:
 *
 *   FAILED rows are EXCLUDED. The handoff says include them where sent_count>0;
 *   David said "you dont need to include failed ones for now since nothing
 *   happened there". Measured: 55 FAILED rows, only 2 of which sent anything, no
 *   rewards and no completes between them — $1,157.40 of send cost left on the
 *   table. The report states that figure so the decision stays visible.
 *
 *   SCHEDULED rows are INCLUDED. The handoff says skip them; David said "you can
 *   include the 6 scheduled as well". They have no sent count and no completes,
 *   so they add $0 and record intent. Their `people` and `completes` are stored
 *   NULL, not 0 — a blast that has not gone out has not reached nobody, and 0
 *   would report a 0% response rate on a send that has not happened.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const file = process.argv[2]
const APPLY = process.argv.includes('--apply')
const reportIdx = process.argv.indexOf('--report')
const reportPath = reportIdx > -1 ? process.argv[reportIdx + 1] : null
if (!file) { console.error('usage: node scripts/import-cm-blasts.mjs <file.csv> [--apply] [--report out.md]'); process.exit(1) }

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ---------------------------------------------------------------- CSV
function parseCSV(t) {
  const rows = []; let row = [], cur = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  const h = rows.shift()
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(h.map((x, i) => [x.trim(), (r[i] ?? '').trim()])))
}
/** Blank stays NULL. A blank sent count on a scheduled blast is "not sent yet",
 *  and 0 would assert it reached nobody. */
const numOrNull = v => { const s = String(v ?? '').replace(/,/g, '').trim(); if (s === '') return null; const x = Number(s); return Number.isFinite(x) ? x : null }
const num = v => numOrNull(v) ?? 0

const rows = parseCSV(readFileSync(file, 'utf8'))
const SEND_RATE = 0.02
const SINCE = '2026-06-01'

// ---------------------------------------------------------------- filter
const isB2B = r => `${r.survey_title} ${r.survey_id}`.toUpperCase().includes('B2B_')
const whenOf = r => (r.scheduled_at_utc || r.blast_date_utc || '').trim()
const b2b = rows.filter(isB2B)
const failed = b2b.filter(r => r.blast_status === 'FAILED')
const failedThatSent = failed.filter(r => num(r.sent_count) > 0)
const considered = b2b.filter(r =>
  (r.blast_status === 'COMPLETED' || r.blast_status === 'SCHEDULED') &&
  whenOf(r).slice(0, 10) >= SINCE)

// ---------------------------------------------------------------- resolve
const { data: projects } = await db.from('survey_projects')
  .select('id, project_code, project_name, client, project_type, survey_tool_id, survey_ids_from_sheet, actual_spend')
  .is('deleted_at', null)

const idIndex = new Map()   // survey id -> Map(projectId -> project)
for (const p of projects) {
  const ids = new Set([p.survey_tool_id, p.survey_ids_from_sheet].filter(Boolean)
    .flatMap(x => String(x).split(/[,;\s]+/)).map(x => x.trim()).filter(Boolean))
  for (const id of ids) {
    if (!idIndex.has(id)) idIndex.set(id, new Map())
    idIndex.get(id).set(p.id, p)
  }
}
// A locale suffix is an audience split of ONE study, not a separate survey:
// B2B_BFBOFABMAT202607_GE/_FR/_UK are three sends of one Building Materials
// project. Stripped only as a LAST resort, after both exact passes.
const LOCALE = /_(UK|FR|GE|DE|AU|AUSG|APAC|India|US|CA|SG)$/i
const lookup = key => {
  if (!key) return []
  const hit = idIndex.get(key.trim())
  return hit ? [...hit.values()] : []
}
function resolve(r) {
  for (const k of [r.survey_id, r.survey_title]) {
    const hit = lookup(k)
    if (hit.length) return { projects: hit, via: 'exact' }
  }
  for (const k of [r.survey_id, r.survey_title]) {
    if (!k || !LOCALE.test(k)) continue
    const hit = lookup(k.replace(LOCALE, ''))
    if (hit.length) return { projects: hit, via: `locale-stripped from ${k}` }
  }
  return { projects: [], via: null }
}

// ---------------------------------------------------------------- existing
const { data: existing, error: exErr } = await db.from('project_blasts')
  .select('id, project_id, idem_key, cm_blast_id, bid, people, completes, blast_at, note')
// Check the ERROR, not the shape of row zero: with the column absent PostgREST
// rejects the whole select and returns data: null, which an "is the key in the
// first row" test reads as success on an empty table.
if (exErr) {
  console.error(exErr.message.includes('cm_blast_id')
    ? 'project_blasts.cm_blast_id does not exist — apply migration 106 first.'
    : `could not read project_blasts: ${exErr.message}`)
  process.exit(1)
}
const byCm = new Map((existing ?? []).filter(b => b.cm_blast_id != null).map(b => [Number(b.cm_blast_id), b]))
const exByProject = {}
for (const b of existing ?? []) (exByProject[b.project_id] ??= []).push(b)

/**
 * Pair CSV rows against a project's hand-logged blasts.
 *
 * TWO GRADES OF MATCH, and the second one is the reason this is not a one-liner.
 *
 *   EXACT — same day, same sent, same completes. Certainly the same send,
 *   correctly transcribed. Adopt it.
 *
 *   RESTATED — same day and same reward, but the counts differ. Also the same
 *   send, transcribed WRONG, and the CSV is Campaign Manager's own record so it
 *   is the authority. Adopt and correct, and list every one in the report with
 *   its before and after, because silently rewriting somebody's numbers is not
 *   something a script should do quietly.
 *
 * Without the second grade the import inserts alongside the bad row and the
 * project ends up with both. PR00375 is the case that forced it: SOCC has
 * people=0/completes=39 and people=0/completes=17 — the impossible shape health
 * check 7c exists to flag — where the CSV has sent=32/completes=12 and
 * sent=19/completes=9. Two rows would have become four, and the spend with them.
 *
 * Pairing is GREEDY AND ONE-TO-ONE in time order, because several blasts on one
 * project routinely share a day and a reward (PR00363 sent three at $25 on
 * 2026-08-26). Each existing row can be claimed once.
 */
const sameDay = (b, r) => {
  const d1 = String(b.blast_at ?? '').slice(0, 10)
  const d2 = whenOf(r).slice(0, 10)
  return !!d1 && d1 === d2
}
const sameCounts = (b, r) =>
  numOrNull(b.people) === numOrNull(r.sent_count) &&
  numOrNull(b.completes) === numOrNull(r.completes)

/** Claim an unclaimed existing blast for this CSV row. Returns
 *  {row, grade} or null. */
function claim(pool, r) {
  const free = pool.filter(b => b.cm_blast_id == null && !b.__claimed && sameDay(b, r))
  if (!free.length) return null
  const exact = free.find(b => sameCounts(b, r))
  if (exact) { exact.__claimed = true; return { row: exact, grade: 'exact' } }
  // Among same-day, same-reward candidates, take the one whose recorded sent
  // count is CLOSEST to the CSV's. Several blasts routinely go out on one day at
  // one reward, and taking the first free row swapped two of PR00309's on
  // 2026-08-13 — the totals came out right but each row's completes attached to
  // the wrong send. A blast with no sent count recorded sorts last, since it
  // gives no evidence either way.
  const byBid = free.filter(b => numOrNull(b.bid) === numOrNull(r.reward))
  if (byBid.length) {
    const target = numOrNull(r.sent_count)
    const dist = b => {
      const v = numOrNull(b.people)
      return v == null || target == null ? Number.MAX_SAFE_INTEGER : Math.abs(v - target)
    }
    byBid.sort((a, b) => dist(a) - dist(b))
    byBid[0].__claimed = true
    return { row: byBid[0], grade: 'restated' }
  }
  return null
}

// ---------------------------------------------------------------- plan
const plan = { insert: [], update: [], adopt: [], restated: [], skipUnmatched: [], skipAmbiguous: [] }
const perProject = {}

considered.sort((a, b) => whenOf(a).localeCompare(whenOf(b)))
for (const r of considered) {
  const { projects: hits, via } = resolve(r)
  if (hits.length === 0) { plan.skipUnmatched.push(r); continue }
  if (hits.length > 1) { plan.skipAmbiguous.push({ r, hits }); continue }
  const p = hits[0]
  const cm = numOrNull(r.blast_id)
  const scheduled = r.blast_status === 'SCHEDULED'

  const fields = {
    project_id: p.id,
    bid: numOrNull(r.reward),
    // NULL for a scheduled blast: it has not sent, which is not the same as
    // having sent to nobody.
    people: scheduled ? null : numOrNull(r.sent_count),
    completes: scheduled ? null : numOrNull(r.completes),
    cost_per_send: SEND_RATE,
    blast_at: whenOf(r) ? whenOf(r).replace(' ', 'T') + 'Z' : null,
    note: [
      r.channel || 'SMS',
      r.audience_name || null,
      r.campaign_name ? `${r.campaign_name}${r.campaign_id ? ` (#${r.campaign_id})` : ''}` : null,
      r.blast_number ? `CM blast #${r.blast_number}` : null,
      scheduled ? 'scheduled, not yet sent' : null,
    ].filter(Boolean).join(' · '),
    cm_blast_id: cm,
  }

  const e = (perProject[p.id] ??= { p, insert: 0, adopt: 0, restate: 0, update: 0, reward: 0, send: 0 })
  const already = cm != null ? byCm.get(cm) : null
  if (already) {
    plan.update.push({ r, p, fields, existing: already })
    e.update++
    continue
  }
  const hit = claim(exByProject[p.id] ?? [], r)
  if (hit) {
    plan.adopt.push({ r, p, fields, existing: hit.row, grade: hit.grade })
    if (hit.grade === 'restated') { plan.restated.push({ r, p, fields, existing: hit.row }); e.restate++ }
    else e.adopt++
    continue
  }
  plan.insert.push({ r, p, fields })
  e.insert++
  e.reward += num(r.reward) * num(r.completes)
  e.send += num(r.sent_count) * SEND_RATE
}

// ---------------------------------------------------------------- report
const L = []
const say = s => { L.push(s); console.log(s) }
const money = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

say(`# Campaign Manager blast import — ${APPLY ? 'APPLIED' : 'DRY RUN'}`)
say(`source: ${file.split(/[\\/]/).pop()}`)
say('')
say('## Rows')
say(`- ${rows.length} rows read; ${b2b.length} are B2B (survey_title or survey_id contains "B2B_") across ${new Set(b2b.map(r => r.survey_id)).size} distinct survey ids`)
say(`- ${considered.length} considered — COMPLETED (${b2b.filter(r => r.blast_status === 'COMPLETED').length}) plus SCHEDULED (${b2b.filter(r => r.blast_status === 'SCHEDULED').length})`)
say(`- ${failed.length} FAILED rows EXCLUDED on your instruction. Only ${failedThatSent.length} of them actually sent anything — ${money(failedThatSent.reduce((t, r) => t + num(r.sent_count), 0) * SEND_RATE)} of send cost, no rewards, no completes. That money is not recorded anywhere.`)
say('')
say('## Matching')
say(`- resolved to one project: ${plan.insert.length + plan.update.length + plan.adopt.length} rows`)
say(`- **unmatched** (no project carries the survey id): ${plan.skipUnmatched.length} rows across ${new Set(plan.skipUnmatched.map(r => r.survey_id)).size} surveys — skipped, nothing created`)
say(`- **ambiguous** (id maps to >1 project): ${plan.skipAmbiguous.length} rows — skipped`)

if (plan.skipAmbiguous.length) {
  say('')
  say('### Ambiguous — needs your call')
  const grouped = {}
  for (const { r, hits } of plan.skipAmbiguous) (grouped[r.survey_id] ??= { hits, n: 0 }).n++
  for (const [id, g] of Object.entries(grouped)) {
    say(`- \`${id}\` — ${g.n} blasts, could be either:`)
    for (const p of g.hits) say(`    - ${p.project_code} · ${p.client} · ${p.project_name}`)
  }
}

if (plan.skipUnmatched.length) {
  say('')
  say('### Unmatched surveys — set a survey_tool_id on the right project and re-run')
  const g = {}
  for (const r of plan.skipUnmatched) {
    const k = r.survey_id
    ;(g[k] ??= { n: 0, study: r.study, title: r.survey_title, first: whenOf(r).slice(0, 10), last: whenOf(r).slice(0, 10), reward: 0, sent: 0 })
    g[k].n++
    g[k].reward += num(r.reward) * num(r.completes)
    g[k].sent += num(r.sent_count)
    const d = whenOf(r).slice(0, 10)
    if (d && d < g[k].first) g[k].first = d
    if (d && d > g[k].last) g[k].last = d
  }
  say('')
  say('| survey id | study | blasts | dates | reward $ | send $ |')
  say('|---|---|---:|---|---:|---:|')
  for (const [id, x] of Object.entries(g).sort((a, b) => b[1].reward - a[1].reward))
    say(`| \`${id}\` | ${(x.study || x.title || '').slice(0, 40)} | ${x.n} | ${x.first}${x.last !== x.first ? `→${x.last}` : ''} | ${money(x.reward)} | ${money(x.sent * SEND_RATE)} |`)
}

say('')
say('## What this run does')
say(`- insert new blasts: **${plan.insert.length}**`)
say(`- adopt hand-logged blasts unchanged (same day, same figures): **${plan.adopt.length - plan.restated.length}**`)
say(`- adopt and CORRECT hand-logged blasts (same day and reward, different figures): **${plan.restated.length}**`)
say(`- update already-imported: **${plan.update.length}**`)

if (plan.restated.length) {
  say('')
  say('### Figures corrected from Campaign Manager')
  say('These blasts are already in SOCC but with different numbers. Campaign Manager is its own record of what it sent, so the import treats it as the authority — but every change is listed, because rewriting a colleague’s figures should not happen quietly. Nothing is duplicated: these UPDATE the existing row.')
  say('')
  say('| project | date | sent: was → now | completes: was → now | reward: was → now |')
  say('|---|---|---|---|---|')
  const fmt = (a, b) => `${a ?? '—'} → ${b ?? '—'}`
  for (const x of plan.restated.sort((a, b) => a.p.project_code.localeCompare(b.p.project_code))) {
    say(`| ${x.p.project_code} | ${String(x.fields.blast_at ?? '').slice(0, 10)} | ${fmt(x.existing.people, x.fields.people)} | ${fmt(x.existing.completes, x.fields.completes)} | ${fmt(x.existing.bid, x.fields.bid)} |`)
  }
}

const addReward = Object.values(perProject).reduce((t, e) => t + e.reward, 0)
const addSend = Object.values(perProject).reduce((t, e) => t + e.send, 0)
say('')
say(`## Spend this adds`)
say(`- reward Σ(bid × completes): **${money(addReward)}**`)
say(`- send Σ(sent) × $${SEND_RATE}: **${money(addSend)}**`)
say(`- **total ${money(addReward + addSend)}** across ${Object.values(perProject).filter(e => e.insert).length} projects`)
say('')
say('| project | client | +new | adopted | corrected | reward $ | send $ | spend now |')
say('|---|---|---:|---:|---:|---:|---:|---:|')
for (const e of Object.values(perProject).sort((a, b) => (b.reward + b.send) - (a.reward + a.send))) {
  if (!e.insert && !e.adopt && !e.restate && !e.update) continue
  say(`| ${e.p.project_code} | ${String(e.p.client).slice(0, 22)} | ${e.insert} | ${e.adopt} | ${e.restate} | ${money(e.reward)} | ${money(e.send)} | ${money(Number(e.p.actual_spend ?? 0))} |`)
}

if (reportPath) { writeFileSync(reportPath, L.join('\n') + '\n'); console.log(`\nreport written to ${reportPath}`) }

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0) }

// ---------------------------------------------------------------- apply
console.log('\napplying…')
let ins = 0, ado = 0, upd = 0, err = 0
for (const { fields } of plan.insert) {
  const { error } = await db.from('project_blasts').insert(fields)
  if (error) { err++; console.error(`  insert failed cm#${fields.cm_blast_id}: ${error.message}`) } else ins++
}
// Adopt: stamp the id and refresh the figures, but KEEP the existing idem_key —
// it is a human convention someone chose and other things may reference it.
for (const { fields, existing: b } of plan.adopt) {
  const { cm_blast_id, bid, people, completes, cost_per_send, blast_at, note } = fields
  const { error } = await db.from('project_blasts')
    .update({ cm_blast_id, bid, people, completes, cost_per_send, blast_at, note }).eq('id', b.id)
  if (error) { err++; console.error(`  adopt failed ${b.id}: ${error.message}`) } else ado++
}
for (const { fields, existing: b } of plan.update) {
  const { project_id, ...rest } = fields
  const { error } = await db.from('project_blasts').update(rest).eq('id', b.id)
  if (error) { err++; console.error(`  update failed cm#${fields.cm_blast_id}: ${error.message}`) } else upd++
}
console.log(`inserted ${ins}, adopted ${ado} (of which ${plan.restated.length} had their figures corrected), updated ${upd}${err ? `, ${err} FAILED` : ''}`)

// Verify against the database rather than trusting the plan.
const { data: after } = await db.from('project_blasts').select('id, cm_blast_id, project_id')
console.log(`project_blasts now: ${after.length} rows, ${after.filter(b => b.cm_blast_id != null).length} carrying a cm_blast_id`)
const ids = after.filter(b => b.cm_blast_id != null).map(b => Number(b.cm_blast_id))
console.log(`duplicate cm_blast_ids: ${ids.length - new Set(ids).size} (must be 0)`)
