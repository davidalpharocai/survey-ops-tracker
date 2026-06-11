'use client'
import type { ViewMode } from '@/lib/hooks/useViewMode'

interface ViewToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

export function ViewToggle({ mode, onChange }: ViewToggleProps) {
  return (
    <div className="inline-flex bg-card border border-border rounded-full p-1 gap-1">
      <button
        onClick={() => onChange('operations')}
        title="Operations view: only open, active projects in the pipeline."
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
          mode === 'operations'
            ? 'bg-indigo-600 text-white'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        ⚙ Operations
      </button>
      <button
        onClick={() => onChange('full')}
        title="Full View: everything — adds scoping (pre-sale), on-hold context, and closed projects."
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
          mode === 'full'
            ? 'bg-indigo-600 text-white'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        ◉ Full View
      </button>
    </div>
  )
}
