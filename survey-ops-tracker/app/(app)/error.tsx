'use client'

import { useEffect } from 'react'

/**
 * App-wide error boundary for the authenticated surfaces. Without this, a failed
 * data fetch or a render error blanks the screen — which reads as "all my
 * projects vanished" to a non-technical user. Here it shows a clear,
 * recoverable message with a retry that re-runs the failed render.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface the real error in the browser console for debugging.
    console.error('[app-error-boundary]', error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl shadow-sm p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4 text-2xl">
          ⚠️
        </div>
        <h1 className="text-lg font-semibold text-foreground mb-2">
          Something went wrong on this page
        </h1>
        <p className="text-sm text-muted-foreground mb-2 leading-relaxed">
          This is a display problem, not lost data — your projects are safe. Try
          again, and if it keeps happening, refresh the page or contact{' '}
          <a href="mailto:info@alpharoc.ai" className="text-blue-600 dark:text-blue-400 hover:underline">
            info@alpharoc.ai
          </a>
          .
        </p>
        <button
          onClick={reset}
          className="mt-4 w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
        >
          Try again
        </button>
        {error.digest && (
          <p className="mt-4 text-xs text-muted-foreground/60">Error ID: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
