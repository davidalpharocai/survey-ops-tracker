import './globals.css';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { currentUserEmail } from '../lib/auth';

export const metadata = {
  title: 'AlphaROC Client Credit Management',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const userEmail = await currentUserEmail();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">AlphaROC Client Credit Management</Link>
          {/* Admin functions live in the Administration section on the home
              page; no separate top-bar Admin link (it only duplicated the
              Audit Log shortcut). */}
          <span className="who">{userEmail || 'not signed in'}</span>
          {userEmail && (
            <Link className="signout" href="/api/auth/logout">Sign out</Link>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
