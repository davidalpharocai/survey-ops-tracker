'use client'
import type { ViewMode } from '@/lib/hooks/useViewMode'

interface ViewToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

export function ViewToggle({ mode, onChange }: ViewToggleProps) {
  return (
    <div className="inline-flex bg-slate-900 border border-slate-700 rounded-full p-1 gap-1">
      <button
        onClick={() => onChange('operations')}
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
          mode === 'operations'
            ? 'bg-indigo-600 text-white'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        ⚙ Operations
      </button>
      <button
        onClick={() => onChange('full')}
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
          mode === 'full'
            ? 'bg-indigo-600 text-white'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        ◉ Full View
      </button>
    </div>
  )
}
