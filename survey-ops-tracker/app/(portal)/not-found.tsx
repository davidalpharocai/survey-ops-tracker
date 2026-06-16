import Link from 'next/link'

export default function PortalNotFound() {
  return (
    <div
      id="portal-root"
      className="min-h-screen bg-slate-50 flex items-center justify-center px-4"
    >
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <p className="text-xs font-semibold tracking-widest uppercase text-slate-400 mb-6">
          AlphaRoc — Survey Compliance
        </p>
        <h1 className="text-lg font-semibold text-slate-900 mb-2">
          Page not found
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          This link may have expired or the submission no longer exists. If you
          received a review link from AlphaRoc, please contact{' '}
          <a
            href="mailto:info@alpharoc.ai"
            className="text-blue-600 hover:underline"
          >
            info@alpharoc.ai
          </a>{' '}
          with the subject{' '}
          <span className="font-medium text-slate-700">Survey Compliance Link</span>.
        </p>
        <Link
          href="/portal"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
        >
          Go to portal
        </Link>
      </div>
    </div>
  )
}
