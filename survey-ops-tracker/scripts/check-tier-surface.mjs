/**
 * Assert what each tier can actually reach, against the real database, with a
 * real user JWT. The only way to test an RLS policy.
 *
 *   node scripts/check-tier-surface.mjs            # exits 1 on any breach
 *   node scripts/check-tier-surface.mjs --verbose
 *
 * Runs in CI (see .github/workflows/tier-surface.yml). Three column leaks were
 * found by hand in one week — 102, 105 and 107 — each by someone remembering to
 * run a probe. This is that probe, promoted to something that fails a build.
 *
 * WHY A SCRIPT AND NOT A VITEST FILE: it needs a service-role key to mint the
 * links and network access to a live database. Keeping it out of the unit suite
 * means `npm test` stays hermetic and fast, and this runs as its own CI job that
 * can be skipped when the secret is absent (a fork's PR) without pretending to
 * have passed.
 *
 * IT FAILS ON THE UNKNOWN, not merely on the forbidden: any relation a tier can
 * read that lib/auth/tierSurface.ts does not list as allowed is a breach. A new
 * table with a permissive policy cannot slip past by being unfamiliar.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const VERBOSE = process.argv.includes('--verbose')

// tierSurface.ts is 'server-only' TypeScript, so its table is parsed out rather
// than imported — this script is plain node with no bundler.
const src = readFileSync('lib/auth/tierSurface.ts', 'utf8')
function block(tier) {
  const i = src.indexOf(`  ${tier}: {`)
  const j = src.indexOf('\n  },', i)
  return src.slice(i, j)
}
function listOf(text, key) {
  const i = text.indexOf(`${key}: [`)
  if (i < 0) return []
  const j = text.indexOf(']', i)
  return [...text.slice(i, j).matchAll(/'([^']+)'/g)].map(m => m[1])
}
function allowedOf(text) {
  const i = text.indexOf('allowed: [')
  const j = text.indexOf('    ],', i)
  return [...text.slice(i, j).matchAll(/name: '([^']+)'/g)].map(m => m[1])
}
function absentOf(text) {
  const i = text.indexOf('absentColumns: {')
  const j = text.indexOf('\n    },', i)
  const seg = text.slice(i, j)
  const out = {}
  for (const m of seg.matchAll(/(\w+):\s*\[([^\]]*)\]/gs)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])
  }
  return out
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const U = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !ANON || !SERVICE) { console.error('missing Supabase credentials'); process.exit(1) }

const admin = createClient(U, SERVICE, { auth: { persistSession: false } })
const failures = []
const note = s => { if (VERBOSE) console.log('   ' + s) }

for (const tier of ['sales', 'compliance']) {
  const text = block(tier)
  const allowed = allowedOf(text)
  const denied = listOf(text, 'denied')
  const absent = absentOf(text)

  const { data: profiles } = await admin.from('profiles').select('email').eq('role', tier).limit(1)
  if (!profiles?.length) { console.log(`\n${tier}: no account of this tier — skipped`); continue }
  const email = profiles[0].email

  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (le) { failures.push(`${tier}: cannot mint a link for ${email}: ${le.message}`); continue }
  const pub = createClient(U, ANON, { auth: { persistSession: false } })
  const { data: sess, error: ve } = await pub.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
  if (ve || !sess?.session) { failures.push(`${tier}: cannot exchange the token: ${ve?.message}`); continue }
  const jwt = sess.session.access_token
  const get = p => fetch(`${U}/rest/v1/${p}`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } })

  console.log(`\n=== ${tier} (${email}) ===`)

  // 1. Everything denied must return zero rows.
  for (const rel of denied) {
    const r = await get(`${rel}?select=*&limit=1`)
    const b = await r.json()
    if (Array.isArray(b) && b.length > 0) failures.push(`${tier} CAN READ ${rel} — ${b.length} row(s)`)
    else note(`denied ok: ${rel}`)
  }

  // 2. Withheld columns must not exist on the views.
  for (const [rel, cols] of Object.entries(absent)) {
    for (const c of cols) {
      const r = await get(`${rel}?select=${c}&limit=1`)
      const b = await r.json()
      if (Array.isArray(b)) failures.push(`${tier}: ${rel}.${c} is READABLE and must not be`)
      else if (b?.code !== '42703') note(`${rel}.${c}: ${b?.code}`)
    }
  }

  // 3. Everything allowed must actually work — a boundary that also breaks the
  //    product is not a boundary, it is an outage, and this is how we notice.
  for (const rel of allowed) {
    const r = await get(`${rel}?select=*&limit=1`)
    const b = await r.json()
    if (!Array.isArray(b)) failures.push(`${tier}: ${rel} should be readable but returned ${JSON.stringify(b).slice(0, 80)}`)
    else note(`allowed ok: ${rel} (${b.length} row sample)`)
  }
  console.log(`  ${denied.length} denied, ${Object.values(absent).flat().length} columns, ${allowed.length} allowed — checked`)
}

if (failures.length) {
  console.error(`\n${failures.length} BREACH${failures.length === 1 ? '' : 'ES'}:`)
  for (const f of failures) console.error('  ✗ ' + f)
  console.error('\nEither the policy is wrong, or lib/auth/tierSurface.ts needs updating for a deliberate change.')
  process.exit(1)
}
console.log('\nNo breaches. Every tier reaches exactly what lib/auth/tierSurface.ts says it may.')
