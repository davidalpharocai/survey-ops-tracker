import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { RealtimeSync } from '@/components/shared/RealtimeSync'
import { AssistantPanel } from '@/components/assistant/AssistantPanel'
import { CommandPalette } from '@/components/shared/CommandPalette'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!isAllowedEmail(user.email)) redirect('/login?unauthorized=1')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <RealtimeSync />
      <nav className="border-b border-border px-6 py-1.5 flex items-center gap-4">
        <span className="font-bold text-foreground text-sm">Survey Ops Command Center</span>
        <div className="ml-auto flex items-center gap-3">
          <span
            title="Open the command palette"
            className="hidden md:inline-flex text-[11px] border border-border rounded px-1.5 py-0.5 text-muted-foreground"
          >
            Ctrl+K
          </span>
          <ThemeToggle />
        </div>
      </nav>
      <main className="px-6 pt-3 pb-6">
        {children}
      </main>
      <AssistantPanel />
      <CommandPalette />
    </div>
  )
}
