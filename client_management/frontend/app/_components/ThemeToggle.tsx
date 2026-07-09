'use client';

import { useTheme } from '../../lib/useTheme';

// Standalone icon toggle (used on the signed-out top bar). When signed in,
// the theme control lives inside the user menu instead.
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
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
