import { PortalThemeToggle } from '@/components/portal/PortalThemeToggle'
import { ImpersonationBanner } from '@/components/shared/ImpersonationBanner'

export const dynamic = 'force-dynamic'

export default function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div id="portal-root" className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Inline script runs before first paint so there is no flash of wrong theme */}
      <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('portal-theme')==='dark')document.currentScript.parentElement.classList.add('dark')}catch{}" }} />
      {/* The portal has its own palette, and the banner deliberately keeps the
          app's amber rather than adopting it: an admin viewing as a compliance
          reviewer should see the same bar here as anywhere else. */}
      <ImpersonationBanner />
      <nav className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-6 py-3 flex items-center gap-3">
        <span className="font-bold text-slate-900 dark:text-white text-sm">AlphaRoc</span>
        <span className="text-slate-400 dark:text-slate-600 text-sm">/</span>
        <span className="text-slate-500 dark:text-slate-400 text-sm">Compliance Portal</span>
        <PortalThemeToggle />
      </nav>
      <main className="p-6 max-w-4xl mx-auto">{children}</main>
    </div>
  )
}
