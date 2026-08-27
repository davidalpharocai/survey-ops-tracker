import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data, error } = await db.auth.admin.generateLink({
  type: 'magiclink',
  email: 'david@alpharoc.ai',
})
if (error) { console.error('ERR', error.message); process.exit(1) }
const th = data.properties?.hashed_token
console.log('http://localhost:3000/auth/confirm?token_hash=' + th + '&type=magiclink&next=/')
