// Read the authenticated user identity for server components/actions.
//
// Primary path: middleware.ts sets `x-user-email` / `x-user-admin` on the
// request after verifying the Cognito ID token. Server components read them
// back via next/headers.
//
// Fallback path: AWS Amplify Hosting does not reliably forward middleware-
// mutated *request* headers to the SSR render, so when those headers are
// absent we re-derive identity directly from the verified ID-token cookie
// (the same token middleware validated). This keeps the home page, layout
// topbar and admin gate working on Amplify.

import { cookies, headers } from 'next/headers';

import {
  COGNITO_ENABLED,
  COOKIE_ID_TOKEN,
  isAdminIdentity,
  verifyIdToken,
  type VerifiedUser,
} from './cognito';

// Local-dev shim, mirroring middleware.ts: when Cognito is not configured
// (and never in production) treat DEV_USER_EMAIL as a signed-in user.
// Admin rights follow the same allow-list as production, so the dev user
// is admin only if their email is listed in CCM_ADMIN_EMAILS.
function devFallbackUser(): VerifiedUser | null {
  if (COGNITO_ENABLED || process.env.NODE_ENV === 'production') return null;
  const email = (process.env.DEV_USER_EMAIL || '').toLowerCase();
  const domain = process.env.ALLOWED_DOMAIN || 'alpharoc.ai';
  if (!email.endsWith('@' + domain)) return null;
  return { email, isAdmin: isAdminIdentity(email, []), claims: {} };
}

async function userFromCookie(): Promise<VerifiedUser | null> {
  const token = (await cookies()).get(COOKIE_ID_TOKEN)?.value;
  return (await verifyIdToken(token)) ?? devFallbackUser();
}

export async function currentUserEmail(): Promise<string> {
  const h = await headers();
  const fromHeader = h.get('x-user-email');
  if (fromHeader) return fromHeader;
  return (await userFromCookie())?.email || '';
}

// Whether the authenticated user is in the admin group. Set by
// middleware.ts as `x-user-admin` ('1' / '0'); falls back to the cookie.
export async function currentUserIsAdmin(): Promise<boolean> {
  const h = await headers();
  const fromHeader = h.get('x-user-admin');
  if (fromHeader !== null) return fromHeader === '1';
  return (await userFromCookie())?.isAdmin ?? false;
}
