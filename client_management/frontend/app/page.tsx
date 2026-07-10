import Link from 'next/link';
import { Suspense } from 'react';

import {
  currentUserEmail,
  currentUserIsApprover,
  currentUserIsRestricted,
  currentUserReadOnly,
} from '../lib/auth';
import ClientPulse from './_components/ClientPulse';
import LinkPending from './_components/LinkPending';

export const metadata = { title: 'AlphaROC Credit Management' };

export default async function HomePage() {
  const [userEmail, isRestricted, isApprover, readOnly] = await Promise.all([
    currentUserEmail(),
    currentUserIsRestricted(),
    currentUserIsApprover(),
    currentUserReadOnly(),
  ]);

  return (
    <div className="hub">
      <h1 className="hub-title">AlphaROC Credit Management</h1>

      {userEmail ? (
        <>
          {/* Tiles use default <Link> prefetch + per-route loading.tsx for an
              instant shell; LinkPending gives immediate click feedback. Do
              not set prefetch={false} (it would kill the instant shell). */}
          {!readOnly && (
            <div className="hub-actions">
              <Link className="hub-action" href="/studies/new">
                <span className="hub-link-title">Record a Study</span>
                <span className="hub-link-sub">Log a survey that draws down a client&apos;s credits or dollars, attributed to one of their contacts.</span>
                <LinkPending />
              </Link>
              {isRestricted ? (
                <Link className="hub-action" href="/credit-requests/new">
                  <span className="hub-link-title">Request Credits</span>
                  <span className="hub-link-sub">Ask an approver to add credits or dollars to one of your clients.</span>
                  <LinkPending />
                </Link>
              ) : (
                <Link className="hub-action" href="/contracts/new">
                  <span className="hub-link-title">Add a Contract</span>
                  <span className="hub-link-sub">Top up a client&apos;s available credits and/or dollars — funds their studies.</span>
                  <LinkPending />
                </Link>
              )}
            </div>
          )}

          {/* Client Pulse dashboard — reuses the existing report endpoints;
              defaults to the signed-in salesperson's clients (no restriction).
              In its own Suspense boundary so the action tiles + panels stream
              immediately instead of waiting on the three report queries. */}
          <Suspense fallback={<div className="pulse-skeleton skeleton-block" aria-hidden="true" />}>
            <ClientPulse email={userEmail} />
          </Suspense>

          <div className="hub-panels">
            <section className="panel">
              <h2>Balances &amp; Reports</h2>
              <Link className="hub-link" href="/reports">
                <span className="hub-link-title">Client Balances</span>
                <span className="hub-link-sub">Any client&apos;s current balance — credits and dollars — plus full transaction history.</span>
                <LinkPending />
              </Link>
            </section>

            <section className="panel">
              <h2>Clients &amp; Contacts</h2>
              <Link className="hub-link" href="/clients">
                <span className="hub-link-title">Manage Client List</span>
                <span className="hub-link-sub">Add, edit, or remove clients · edit each client&apos;s contacts inline.</span>
                <LinkPending />
              </Link>
              <Link className="hub-link" href="/users">
                <span className="hub-link-title">Client Contacts</span>
                <span className="hub-link-sub">Search and browse every contact across all clients.</span>
                <LinkPending />
              </Link>
              {!isRestricted && (
                <Link className="hub-link" href="/salespeople">
                  <span className="hub-link-title">Salespeople</span>
                  <span className="hub-link-sub">Manage the salespeople clients are assigned to · set emails to power the &ldquo;my clients&rdquo; dashboard view.</span>
                  <LinkPending />
                </Link>
              )}
            </section>

            {isApprover && (
              <section className="panel">
                <h2>Approvals</h2>
                <Link className="hub-link" href="/approvals">
                  <span className="hub-link-title">Credit Approvals</span>
                  <span className="hub-link-sub">Review and approve the sales team&apos;s requests to add credits to clients.</span>
                  <LinkPending />
                </Link>
              </section>
            )}
          </div>
        </>
      ) : (
        <p className="muted">
          <Link href="/login">Sign in</Link> to access the application.
        </p>
      )}
    </div>
  );
}
