import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SHARED_DOMAINS } from '@/lib/deliverables/shared-domains'
import { generateFilterXml } from '@/lib/email-activity/filters'

export const dynamic = 'force-dynamic'

// Analyst-only. Returns a downloadable Gmail filter set that captains import to
// forward client-tied mail to the activity@ Group. Criteria = each client
// contact's domain (or the full address when the domain is shared, e.g. gmail.com).
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function GET() {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: contacts, error } = await admin
    .from('client_contacts')
    .select('email')
    .eq('archived', false)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const senders = new Set<string>()
  for (const c of contacts ?? []) {
    const email = (c.email ?? '').toLowerCase().trim()
    const domain = email.split('@')[1]
    if (!domain) continue
    // A shared domain (gmail.com, etc.) would forward everyone's personal mail —
    // so match only that exact contact address; otherwise match the whole domain.
    senders.add(SHARED_DOMAINS.has(domain) ? email : domain)
  }

  const xml = generateFilterXml([...senders])
  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="survey-ops-activity-filters.xml"',
    },
  })
}
