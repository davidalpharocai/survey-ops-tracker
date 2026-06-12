'use client'
import { useEffect, useState } from 'react'

export function PortalThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('portal-theme')
      if (stored === 'dark') setTheme('dark')
    } catch {}
  }, [])

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    try {
      localStorage.setItem('portal-theme', next)
    } catch {}
    const root = document.getElementById('portal-root')
    if (root) {
      root.classList.toggle('dark', next === 'dark')
    }
  }

  return (
    <button
      onClick={toggle}
      className="text-xs border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 px-2.5 py-1 rounded-lg transition-colors"
    >
      {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
    </button>
  )
}
