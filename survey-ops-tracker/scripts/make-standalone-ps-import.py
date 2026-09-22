# -*- coding: utf-8 -*-
"""Derive the dependency-free standalone from scripts/ps-import.mjs.

Generated rather than hand-copied so the two cannot drift: everything except the
database access layer is the verified original, byte for byte.
"""
import re, os

REPO = r"C:/Users/david/Claude Code Projects/survey-ops-tracker"
SRC = os.path.join(REPO, 'scripts', 'ps-import.mjs')
OUT = r"C:\Users\david\Downloads\socc-ps-import.mjs"
s = open(SRC, encoding='utf-8').read()


def sub(old, new, why):
    global s
    n = s.count(old)
    assert n == 1, f"{why}: anchor matched {n} times"
    s = s.replace(old, new)


# ── 1. header ───────────────────────────────────────────────────────────────
sub(''' * ps-import.mjs — load a PureSpectrum "Buyer Surveys" export into SOCC.
 *
 *   node scripts/ps-import.mjs <file|dir> [more…] [--apply] [--json] [--yes]
 *''',
''' * socc-ps-import.mjs — load a PureSpectrum "Buyer Surveys" export into SOCC.
 *
 * STANDALONE. No npm install, no repo, no node_modules — plain Node 18+ and two
 * environment variables. Drop it anywhere (a Downloads folder, a cron box, a
 * cloud runner) and run it.
 *
 *   SOCC_URL=https://<project>.supabase.co \\
 *   SOCC_SERVICE_KEY=<service role key> \\
 *   node socc-ps-import.mjs [file|dir…] [--apply] [--json]
 *
 * With NO path it imports the newest Buyer_Surveys*.zip sitting beside itself,
 * which is what a scheduled agent wants: download, then run.
 *
 * The key may instead live in a `.env` next to this file, or be pointed at with
 * --env <path>. It is a full-access credential — keep it in the runner's secret
 * store, never in a transcript.
 *''', 'header')

# ── 2. drop the only dependency ─────────────────────────────────────────────
sub("import { createClient } from '@supabase/supabase-js'\n", '', 'supabase import')

# ── 3. HERE, so .env and the default input resolve beside the script ────────
sub("const flagVal = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }",
    "const flagVal = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }\n"
    "const HERE = path.dirname(fileURLToPath(import.meta.url))", 'HERE')

# ── 4. no-argument default: newest export beside the script ────────────────
old_args = """const inputs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--state')
if (!inputs.length) {
  console.error('usage: node scripts/ps-import.mjs <file|dir> [more…] [--apply] [--json] [--state <path>]')
  process.exit(2)
}"""
new_args = """let inputs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--state' && argv[i - 1] !== '--env')
if (!inputs.length) {
  // A scheduled agent downloads then runs, so "the file I just downloaded" is
  // the sensible default: newest Buyer_Surveys*.zip beside this script.
  const here = fs.readdirSync(HERE)
    .filter(f => /^Buyer_Surveys.*\\.zip$/i.test(f))
    .map(f => ({ f, m: fs.statSync(path.join(HERE, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  if (!here.length) {
    console.error('usage: node socc-ps-import.mjs [file|dir…] [--apply] [--json] [--state <path>] [--env <path>]')
    console.error(`(no path given, and no Buyer_Surveys*.zip found in ${HERE})`)
    process.exit(2)
  }
  inputs = [path.join(HERE, here[0].f)]
  // stderr, not stdout: --json must emit nothing but the JSON document, or a
  // scheduler piping it into a parser gets a syntax error on line 1.
  console.error(`no path given — using the newest export beside this script: ${here[0].f}`)
}"""
sub(old_args, new_args, 'default input')

# ── 5. state beside the script ─────────────────────────────────────────────
sub("const STATE = flagVal('--state') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '.ps-import-state.json')",
    "const STATE = flagVal('--state') ?? path.join(HERE, '.ps-import-state.json')", 'state path')

# ── 6. the database layer: supabase-js -> plain fetch on PostgREST ─────────
i = s.index('/* ── 3. SOCC state')
j = s.index('const projects = (await page(')
sub(s[i:j], '''/* ── 3. SOCC state ─────────────────────────────────────────────────────── */
// Credentials: the real environment first (a scheduler's secret store), then a
// .env beside this script, then --env <path>. Both the SOCC_* names and the
// NEXT_PUBLIC_*/SUPABASE_* ones a repo .env.local already uses are accepted, so
// an existing file works unedited.
function loadEnv() {
  const out = { ...process.env }
  for (const f of [flagVal('--env'), path.join(HERE, '.env'), path.join(HERE, '.env.local')].filter(Boolean)) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\\n')) {
        const i = line.indexOf('=')
        if (i < 0 || line.trim().startsWith('#')) continue
        const k = line.slice(0, i).trim()
        if (!(k in process.env)) out[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
      }
    } catch { /* absent is fine */ }
  }
  return out
}
const ENV = loadEnv()
const URL_BASE = String(ENV.SOCC_URL || ENV.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\\/+$/, '')
const KEY = ENV.SOCC_SERVICE_KEY || ENV.SUPABASE_SERVICE_ROLE_KEY || ''
if (!URL_BASE || !KEY) {
  console.error('FATAL: set SOCC_URL and SOCC_SERVICE_KEY (or NEXT_PUBLIC_SUPABASE_URL and')
  console.error('       SUPABASE_SERVICE_ROLE_KEY) in the environment, in a .env beside this')
  console.error('       script, or via --env <path>.')
  process.exit(2)
}
const ACTOR = 'purespectrum import (scheduled)'

/* PostgREST over plain fetch. This is the whole reason the file needs no
 * dependencies — supabase-js is a convenience wrapper over exactly these calls,
 * and the service key is a normal bearer token. */
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
async function rest(method, pathAndQuery, body, extra = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${pathAndQuery}`, {
    method, headers: { ...HEADERS, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { const j = JSON.parse(text); msg = j.message || j.hint || text } catch { /* raw */ }
    const err = new Error(`${method} ${pathAndQuery.split('?')[0]} -> ${res.status}: ${msg}`)
    err.status = res.status
    throw err
  }
  return text ? JSON.parse(text) : null
}
const qs = v => encodeURIComponent(v)

/** Paged read. PostgREST caps a response at 1,000 rows and truncates SILENTLY,
 *  and a range with no ORDER BY has no stable page boundary — a row can then
 *  appear twice or not at all across pages. Hence the explicit order. */
const page = async (t, sel) => {
  let out = [], from = 0
  for (;;) {
    const rows = await rest('GET', `${t}?select=${qs(sel)}&order=id.asc`, undefined,
      { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' })
    out = out.concat(rows)
    if (rows.length < 1000) break
    from += 1000
  }
  return out
}

/* The four writes this script makes, shaped like the supabase-js calls they
 * replace so the logic below is untouched. */
const dbInsert = async (t, rows) => {
  const r = await rest('POST', t, rows, { Prefer: 'return=representation' })
  return Array.isArray(rows) ? r : (Array.isArray(r) ? r[0] : r)
}
const dbUpdate = (t, filter, patch) => rest('PATCH', `${t}?${filter}`, patch, { Prefer: 'return=representation' })
const dbDelete = (t, filter) => rest('DELETE', `${t}?${filter}`)
const dbRpc = (fn, args) => rest('POST', `rpc/${fn}`, args)

''', 'db layer')

# ── 7. rewrite every supabase-js call site ─────────────────────────────────
CALLS = [
 # supplier resolve/create
 ("""  const { data, error } = await sb.from('suppliers').insert({ name: String(name).trim(), created_by: 'ps-import' }).select('id').single()
  if (error) throw new Error(`supplier "${name}": ${error.message}`)
  supIdByName.set(k, data.id)
  return data.id""",
  """  const row = await dbInsert('suppliers', [{ name: String(name).trim(), created_by: 'ps-import' }])
  const id = (Array.isArray(row) ? row[0] : row).id
  supIdByName.set(k, id)
  return id"""),
 # raise: update an existing supplier row
 ("""        const { error } = await sb.from('project_suppliers').update({ n_collected: s.n, cpi: s.cpi }).eq('id', cur.id)
        if (error) throw new Error(`raise ${r.launch.label}: ${error.message}`)""",
  """        await dbUpdate('project_suppliers', `id=eq.${cur.id}`, { n_collected: s.n, cpi: s.cpi })"""),
 # raise: insert a supplier row that did not exist on the launch
 ("""      const { error } = await sb.from('project_suppliers').insert({
        project_id: r.launch.project_id, launch_id: r.launch.id, supplier_id: sid,
        cpi: s.cpi, completes_cap: 0, n_collected: s.n, created_by: 'ps-import',
      })
      if (error) throw new Error(`raise ${r.launch.label}: ${error.message}`)""",
  """      await dbInsert('project_suppliers', [{
        project_id: r.launch.project_id, launch_id: r.launch.id, supplier_id: sid,
        cpi: s.cpi, completes_cap: 0, n_collected: s.n, created_by: 'ps-import',
      }])"""),
 # create launch
 ("""  const { data: launch, error } = await sb.from('project_launches').insert({
    project_id: c.project.id, label: g.survey_id, launch_date: g.first, target: null,
    note: noteFor(g), created_by: 'ps-import',
  }).select('id').single()
  if (error) { warn(`  FAILED create ${g.survey_id}: ${error.message}`); report.followUp.push(`create ${g.survey_id} failed`); continue }""",
  """  let launch
  try {
    const made = await dbInsert('project_launches', [{
      project_id: c.project.id, label: g.survey_id, launch_date: g.first, target: null,
      note: noteFor(g), created_by: 'ps-import',
    }])
    launch = Array.isArray(made) ? made[0] : made
  } catch (e) {
    warn(`  FAILED create ${g.survey_id}: ${e.message}`); report.followUp.push(`create ${g.survey_id} failed`); continue
  }"""),
 # create supplier rows, with the compensating rollback
 ("""  const { error: se } = await sb.from('project_suppliers').insert(rows)
  if (se) {
    await sb.from('project_launches').delete().eq('id', launch.id)   // no orphan launch
    warn(`  FAILED suppliers ${g.survey_id}: ${se.message}`); report.followUp.push(`suppliers ${g.survey_id} failed`); continue
  }""",
  """  try {
    await dbInsert('project_suppliers', rows)
  } catch (e) {
    await dbDelete('project_launches', `id=eq.${launch.id}`)   // no orphan launch
    warn(`  FAILED suppliers ${g.survey_id}: ${e.message}`); report.followUp.push(`suppliers ${g.survey_id} failed`); continue
  }"""),
 # n_collected write
 ("""  const { data, error } = await sb.rpc('mcp_write_project', {
    p_id: p.id, p_patch: { n_collected: src }, p_actor: ACTOR, p_expected_updated_at: null,
  })
  if (error) { warn(`  n_collected ${p.project_code}: ${error.message}`); continue }
  if (num(data.n_collected) !== src) { warn(`  n_collected ${p.project_code} did not take`); continue }""",
  """  let data
  try {
    data = await dbRpc('mcp_write_project', { p_id: p.id, p_patch: { n_collected: src }, p_actor: ACTOR, p_expected_updated_at: null })
  } catch (e) { warn(`  n_collected ${p.project_code}: ${e.message}`); continue }
  if (num(data?.n_collected) !== src) { warn(`  n_collected ${p.project_code} did not take`); continue }"""),
 # segment note
 ("""    await sb.from('project_data_changes').insert({
      project_id: p.id, created_by: 'ps-import',""",
  """    await dbInsert('project_data_changes', [{
      project_id: p.id, created_by: 'ps-import',"""),
 # verification reads
 ("""  const { data: p } = await sb.from('survey_projects').select('project_code,actual_spend').eq('id', id).single()
  const { data: rows } = await sb.from('project_suppliers').select('cpi,n_collected').eq('project_id', id)
  const calc = (rows ?? []).reduce((t, x) => t + num(x.cpi) * num(x.n_collected), 0)""",
  """  const p = (await rest('GET', `survey_projects?select=project_code,actual_spend&id=eq.${id}`))[0]
  const rows = await rest('GET', `project_suppliers?select=cpi,n_collected&project_id=eq.${id}`)
  const calc = (rows ?? []).reduce((t, x) => t + num(x.cpi) * num(x.n_collected), 0)"""),
]
for old, new in CALLS:
    sub(old, new, f'call site: {old[:46]!r}')

# close the segment-note object literal (was .insert({…}) -> dbInsert(t,[{…}]))
sub("""`If that happens, ${src.toLocaleString('en-US')} is the figure the fielding record supports — put the difference on the right segment.`,
    })""",
    """`If that happens, ${src.toLocaleString('en-US')} is the figure the fielding record supports — put the difference on the right segment.`,
    }])""", 'segment note close')

# (the usage string was already rewritten by the default-input step above)

leftovers = re.findall(r'\bsb\.', s)
assert not leftovers, f"{len(leftovers)} supabase-js call(s) still present"
# A prose mention in a comment is fine; an IMPORT is not.
bad = [l for l in s.split(chr(10)) if l.strip().startswith('import ') and 'node:' not in l]
assert not bad, f'non-builtin import(s) remain: {bad}'

open(OUT, 'w', encoding='utf-8', newline='\n').write(s)
print('wrote', OUT)
print(f'  {len(s):,} chars, {s.count(chr(10)):,} lines, zero npm dependencies')
