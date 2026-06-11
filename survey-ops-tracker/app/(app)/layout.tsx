import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { AssistantPanel } from '@/components/assistant/AssistantPanel'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!isAllowedEmail(user.email)) redirect('/login?unauthorized=1')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="border-b border-border px-6 py-1.5 flex items-center gap-4">
        <span className="font-bold text-foreground text-sm">Survey Ops Command Center</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>
      <main className="px-6 pt-3 pb-6">
        {children}
      </main>
      <AssistantPanel />
    </div>
  )
}
