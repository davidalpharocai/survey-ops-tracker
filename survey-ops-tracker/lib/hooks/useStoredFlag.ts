'use client'
import { useEffect, useState } from 'react'

/**
 * A boolean persisted in localStorage — per-browser, per-user preferences
 * like collapsed sections. Reads after mount so SSR markup stays stable.
 */
export function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const stored = localStorage.getItem(key)
    if (stored != null) setValue(stored === 'true')
  }, [key])
  function set(v: boolean) {
    setValue(v)
    localStorage.setItem(key, String(v))
  }
  return [value, set]
}
