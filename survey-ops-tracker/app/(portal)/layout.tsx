export const dynamic = 'force-dynamic'

export default function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="border-b border-slate-800 px-6 py-3 flex items-center gap-3">
        <span className="font-bold text-white text-sm">AlphaRoc</span>
        <span className="text-slate-600 text-sm">/</span>
        <span className="text-slate-400 text-sm">Compliance Portal</span>
      </nav>
      <main className="p-6 max-w-4xl mx-auto">{children}</main>
    </div>
  )
}
