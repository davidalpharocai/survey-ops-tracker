import './globals.css';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { apiForRequest } from '../lib/action';
import {
  currentImpersonatedBy,
  currentUserEmail,
  currentUserIsAdmin,
  currentUserIsApprover,
} from '../lib/auth';
import ImpersonationBanner from './_components/ImpersonationBanner';
import NavRibbon from './_components/NavRibbon';
import SearchBox from './_components/SearchBox';
import ThemeToggle from './_components/ThemeToggle';
import UserMenu from './_components/UserMenu';

export const metadata = {
  title: 'AlphaROC Credit Management',
};

// Apply the saved theme before first paint so there's no flash of the
// wrong palette. Runs inline in <head>; CSP allows 'unsafe-inline' scripts.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('ccm-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [userEmail, isAdmin, isApprover, impersonatedBy] = await Promise.all([
    currentUserEmail(),
    currentUserIsAdmin(),
    currentUserIsApprover(),
    currentImpersonatedBy(),
  ]);
  // Pending-approvals count for the nav badge — the only "work is waiting"
  // signal an approver gets (no email/Slack yet). Approvers only; a failure
  // degrades to no badge rather than breaking the layout.
  let pendingApprovals = 0;
  if (isApprover) {
    try {
      const api = await apiForRequest();
      pendingApprovals = (await api.listCreditRequests('pending')).length;
    } catch {
      pendingApprovals = 0;
    }
  }
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <header className="topbar">
          <Link className="brand" href="/">
            <img
              className="brand-logo"
              src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/alpharoc-logo.png`}
              alt="AlphaROC"
              width={54}
              height={24}
            />
            <span className="brand-text">Credit Management</span>
          </Link>
          {/* Persistent primary nav; Admin entry only for admins. Also the
              future home of the global search box (roadmap ②). */}
          {userEmail && <NavRibbon isAdmin={isAdmin} isApprover={isApprover} pendingApprovals={pendingApprovals} />}
          {userEmail && <SearchBox />}
          {userEmail ? (
            <UserMenu userEmail={userEmail} />
          ) : (
            <>
              <span className="who">not signed in</span>
              <ThemeToggle />
            </>
          )}
        </header>
        {impersonatedBy && userEmail && (
          <ImpersonationBanner viewingAs={userEmail} by={impersonatedBy} />
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
