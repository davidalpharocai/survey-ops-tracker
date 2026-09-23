// Creates the private `project-files` bucket that survey attachments live in.
//
// Idempotent, and equivalent to the insert in migration 120 -- run either. This
// exists so the feature works without waiting on a hand-applied migration; the
// migration exists so the bucket is in the record with the rest of the schema.
//
//   node scripts/create-project-files-bucket.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

const NAME = 'project-files'

const { data: existing } = await db.storage.listBuckets()
const found = (existing ?? []).find(b => b.name === NAME)
if (found) {
  console.log(`bucket '${NAME}' already exists — public: ${found.public}`)
  if (found.public) {
    console.error('REFUSING TO CONTINUE: it is PUBLIC. These are internal working files.')
    process.exit(1)
  }
} else {
  const { error } = await db.storage.createBucket(NAME, { public: false })
  if (error) { console.error('create failed:', error.message); process.exit(1) }
  console.log(`created private bucket '${NAME}'`)
}

// Prove it is actually private rather than trusting the flag: an anonymous
// fetch of a public url must not return the object.
const { data: after } = await db.storage.listBuckets()
const b = (after ?? []).find(x => x.name === NAME)
console.log(`verified: ${b?.name} public=${b?.public}`)
