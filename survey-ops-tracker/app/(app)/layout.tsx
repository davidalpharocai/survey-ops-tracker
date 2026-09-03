import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RealtimeSync } from '@/components/shared/RealtimeSync'
import { AssistantPanel } from '@/components/assistant/AssistantPanel'
import { CommandPalette } from '@/components/shared/CommandPalette'
import { TopNav } from '@/components/shared/TopNav'
import { ImpersonationBanner } from '@/components/shared/ImpersonationBanner'
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

  // The sales tier now has its own surface, so send them to it rather than
  // turning them away. Same shape as the compliance redirect above.
  if (profile?.role === 'sales') redirect('/sales')

  // Fail closed on anything else. Every one of the ~73 RLS policies behind this
  // app tests `my_role() = 'analyst'`, so an unknown tier reaching this layout
  // would render the whole tool with every query returning zero rows: no leak,
  // but a convincing impression that the data had vanished. Better to say
  // plainly that there is no surface for them than to show an empty one.
  if (profile?.role !== 'analyst') redirect('/login?pending=1')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <RealtimeSync />
      <ImpersonationBanner />
      <TopNav />
      <main className="px-6 pt-3 pb-6">
        {children}
      </main>
      <AssistantPanel />
      <CommandPalette />
    </div>
  )
}
