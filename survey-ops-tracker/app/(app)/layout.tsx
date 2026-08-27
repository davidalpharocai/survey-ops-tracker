import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RealtimeSync } from '@/components/shared/RealtimeSync'
import { AssistantPanel } from '@/components/assistant/AssistantPanel'
import { CommandPalette } from '@/components/shared/CommandPalette'
import { TopNav } from '@/components/shared/TopNav'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Compliance reviewers (external emails) belong in the portal — check the
  // role before the alpharoc.ai domain gate so they get redirected, not blocked.
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'compliance') redirect('/portal')

  if (!isAllowedEmail(user.email)) redirect('/login?unauthorized=1')
  if (profileError) redirect('/login')

  // Fail closed on any tier that is not an analyst. Migration 085 added 'sales'
  // to the tier enum, and every one of the ~73 RLS policies behind this app
  // tests `my_role() = 'analyst'` — so a sales account reaching this layout
  // would render the whole tool with every query returning zero rows: no leak,
  // but a convincing impression that the data had vanished. Better to say
  // plainly that there is no surface for them yet than to show an empty one.
  //
  // Remove this once the sales portal exists and has its own layout to redirect
  // to, the way 'compliance' redirects to /portal above.
  if (profile?.role !== 'analyst') redirect('/login?pending=1')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <RealtimeSync />
      <TopNav />
      <main className="px-6 pt-3 pb-6">
        {children}
      </main>
      <AssistantPanel />
      <CommandPalette />
    </div>
  )
}
