'use client';

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

// Shared light/dark state. The pre-paint theme is applied by the inline
// script in the layout <head>; this hook reads the current value and flips
// it, persisting to localStorage. Returns null until mounted so callers can
// render a stable placeholder and avoid hydration mismatch.
export function useTheme(): { theme: Theme | null; toggle: () => void } {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme') as Theme | null;
    const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setTheme(attr || system);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('ccm-theme', next);
    } catch {
      /* storage disabled — session-only is fine */
    }
  }

  return { theme, toggle };
}
