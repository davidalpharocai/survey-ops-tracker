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
  resolveRole,
  verifyIdToken,
  type Role,
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
  return { email, isAdmin: isAdminIdentity(email, []), role: resolveRole(email, []), claims: {} };
}

// Basic-Auth fallback, mirroring middleware.ts's gate: the browser
// resends the Authorization header on every request in the realm, so
// pages the middleware matcher misses (the bare basePath root) can still
// resolve the signed-in user. Same rules: shared password + @domain email.
async function basicAuthFallbackUser(): Promise<VerifiedUser | null> {
  const password = process.env.BASIC_AUTH_PASSWORD || '';
  if (COGNITO_ENABLED || !password) return null;
  const header = (await headers()).get('authorization') || '';
  if (!header.toLowerCase().startsWith('basic ')) return null;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return null;
  const email = decoded.slice(0, sep).trim().toLowerCase();
  const given = decoded.slice(sep + 1);
  if (given !== password) return null;
  const domain = process.env.ALLOWED_DOMAIN || 'alpharoc.ai';
  if (!email.endsWith('@' + domain)) return null;
  return { email, isAdmin: isAdminIdentity(email, []), role: resolveRole(email, []), claims: {} };
}

async function userFromCookie(): Promise<VerifiedUser | null> {
  const token = (await cookies()).get(COOKIE_ID_TOKEN)?.value;
  return (
    (await verifyIdToken(token)) ??
    (await basicAuthFallbackUser()) ??
    devFallbackUser()
  );
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

// The caller's role, set by middleware as `x-user-role` (falls back to the
// cookie-derived identity). Drives UI gating; the backend stays authoritative.
export async function currentUserRole(): Promise<Role> {
  const h = await headers();
  const fromHeader = h.get('x-user-role');
  if (fromHeader) return fromHeader as Role;
  return (await userFromCookie())?.role ?? 'restricted';
}

/** Whether the caller may approve credit requests (approver or admin). */
export async function currentUserIsApprover(): Promise<boolean> {
  const role = await currentUserRole();
  return role === 'approver' || role === 'admin';
}

/** Whether the caller is a restricted salesperson (scoped to their clients). */
export async function currentUserIsRestricted(): Promise<boolean> {
  return (await currentUserRole()) === 'restricted';
}

// The real admin's email when an admin is viewing the app AS another user,
// otherwise null. Set by middleware as `x-impersonated-by` — while it is
// present, currentUserEmail()/Role()/IsAdmin() all reflect the IMPERSONATED
// user, so the whole UI renders exactly as that user sees it.
export async function currentImpersonatedBy(): Promise<string | null> {
  const h = await headers();
  return h.get('x-impersonated-by');
}
