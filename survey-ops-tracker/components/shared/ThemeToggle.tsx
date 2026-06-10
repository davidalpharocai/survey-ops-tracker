'use client'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

const OPTIONS = [
  { value: 'light', label: '☀', title: 'Light' },
  { value: 'system', label: '⛭', title: 'System' },
  { value: 'dark', label: '☾', title: 'Dark' },
] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="w-[88px] h-7" />

  return (
    <div className="flex items-center rounded-lg border border-border overflow-hidden">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          title={`${opt.title} theme`}
          aria-label={`${opt.title} theme`}
          className={`px-2.5 py-1 text-sm transition-colors ${
            theme === opt.value
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
