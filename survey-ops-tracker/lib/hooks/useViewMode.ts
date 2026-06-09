import { useState } from 'react'

export type ViewMode = 'operations' | 'full'

export function useViewMode() {
  const [mode, setMode] = useState<ViewMode>('operations')
  return {
    mode,
    setMode,
    isFullView: mode === 'full',
    isOperationsView: mode === 'operations',
  }
}
