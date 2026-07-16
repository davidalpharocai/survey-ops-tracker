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
