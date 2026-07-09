'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

// Light/dark toggle. The actual pre-paint theme is applied by the inline
// script in the layout <head> (no flash of the wrong theme); this button
// just flips and persists the choice. Renders a stable placeholder until
// mounted so server and client markup match.
export default function ThemeToggle() {
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
      /* private mode / storage disabled — session-only is fine */
    }
  }

  if (theme === null) {
    return <button className="theme-toggle" aria-hidden="true" tabIndex={-1} />;
  }
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
