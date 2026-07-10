'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { useTheme } from '../../lib/useTheme';

// The signed-in account menu: the email is a button that opens a dropdown
// with the light/dark toggle and Sign out — keeps the top bar uncluttered.
export default function UserMenu({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const themeLabel = theme === 'dark' ? '☀  Light mode' : '☾  Dark mode';

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="user-menu-email">{userEmail}</span>
        <span className="user-menu-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="user-menu-pop" role="menu">
          <Link className="user-menu-item" role="menuitem" href="/guide" onClick={() => setOpen(false)}>
            User guide
          </Link>
          <button type="button" className="user-menu-item" role="menuitem" onClick={toggle}>
            {themeLabel}
          </button>
          <Link className="user-menu-item" role="menuitem" href="/api/auth/logout">
            Sign out
          </Link>
        </div>
      )}
    </div>
  );
}
