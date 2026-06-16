'use client'

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div
      id="portal-root"
      className="min-h-screen bg-slate-50 flex items-center justify-center px-4"
    >
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M12 4a8 8 0 100 16A8 8 0 0012 4z"
            />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-slate-900 mb-2">
          Something went wrong
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          We encountered an unexpected error. Please try again, or contact{' '}
          <a
            href="mailto:info@alpharoc.ai"
            className="text-blue-600 hover:underline"
          >
            info@alpharoc.ai
          </a>{' '}
          if the issue persists.
        </p>
        <button
          onClick={reset}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
        >
          Try again
        </button>
        {error.digest && (
          <p className="mt-4 text-xs text-slate-400">Error ID: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
