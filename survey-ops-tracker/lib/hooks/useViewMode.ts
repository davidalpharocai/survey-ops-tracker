import { useEffect, useState } from 'react'

export type ViewMode = 'operations' | 'full'

const KEY = 'sot.viewMode'

// Persisted per-browser so it survives navigation — returning to the board (or
// switching board↔list) keeps your last Operations/Full choice instead of
// snapping back to Operations.
export function useViewMode() {
  const [mode, setModeState] = useState<ViewMode>('operations')

  useEffect(() => {
    const stored = localStorage.getItem(KEY)
    if (stored === 'full' || stored === 'operations') setModeState(stored)
  }, [])

  function setMode(next: ViewMode) {
    setModeState(next)
    localStorage.setItem(KEY, next)
  }

  return {
    mode,
    setMode,
    isFullView: mode === 'full',
    isOperationsView: mode === 'operations',
  }
}
