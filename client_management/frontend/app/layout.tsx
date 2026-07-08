import './globals.css';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { currentUserEmail, currentUserIsAdmin } from '../lib/auth';

export const metadata = {
  title: 'AlphaROC Client Credit Management',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [userEmail, isAdmin] = await Promise.all([
    currentUserEmail(),
    currentUserIsAdmin(),
  ]);
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">AlphaROC Client Credit Management</Link>
          {isAdmin && (
            <Link className="signout" href="/admin">Admin</Link>
          )}
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
