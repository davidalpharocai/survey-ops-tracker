'use client'
import { useEffect, useRef, useState } from 'react'
import type { ToastDetail } from '@/lib/utils/toast'

interface ToastItem extends ToastDetail {
  id: number
}

const AUTO_DISMISS_MS = 6_000
const MAX_TOASTS = 3

/**
 * Renders toasts fired via toast() from lib/utils/toast.ts.
 * Stacked bottom-left so they never collide with the bottom-right
 * Assistant button. Auto-dismiss after 6s, manual ✕, max 3 at once.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail
      if (!detail?.message) return
      const id = nextId.current++
      setToasts(prev => [...prev.slice(-(MAX_TOASTS - 1)), { id, ...detail }])
      window.setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, AUTO_DISMISS_MS)
    }
    window.addEventListener('sot-toast', onToast)
    return () => window.removeEventListener('sot-toast', onToast)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-5 left-5 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`bg-card border rounded-lg shadow-lg px-4 py-3 text-sm flex items-start gap-2 max-w-sm ${
            t.kind === 'error'
              ? 'border-red-500/50 text-foreground'
              : 'border-emerald-500/50 text-foreground'
          }`}
        >
          <span
            aria-hidden
            className={`shrink-0 ${
              t.kind === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {t.kind === 'error' ? '⚠' : '✓'}
          </span>
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
            title="Dismiss"
            className="shrink-0 text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
