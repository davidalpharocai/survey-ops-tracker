import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Auth + role gate for portal pages. Returns the user-scoped client.
// Lives in pages (not the layout) so each page can send its own path
// through the login round-trip as ?next=.
export async function requirePortalUser(nextPath: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/portal/login?next=${encodeURIComponent(nextPath)}`)

  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profileError || !profile) redirect('/portal/login?error=profile')
  if (profile.role !== 'compliance') redirect('/')

  return supabase
}
