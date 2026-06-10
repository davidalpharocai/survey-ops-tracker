import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ThemeToggle } from '@/components/shared/ThemeToggle'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="border-b border-border px-6 py-3 flex items-center gap-4">
        <span className="font-bold text-foreground text-sm">Survey Ops</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>
      <main className="p-6">
        {children}
      </main>
    </div>
  )
}
