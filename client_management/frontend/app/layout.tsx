import './globals.css';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { currentUserEmail, currentUserIsAdmin } from '../lib/auth';
import NavRibbon from './_components/NavRibbon';

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
          <Link className="brand" href="/">
            <img
              className="brand-logo"
              src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/alpharoc-logo.png`}
              alt="AlphaROC"
              width={70}
              height={26}
            />
            <span className="brand-text">Client Credit Management</span>
          </Link>
          {/* Persistent primary nav; Admin entry only for admins. Also the
              future home of the global search box (roadmap ②). */}
          {userEmail && <NavRibbon isAdmin={isAdmin} />}
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
