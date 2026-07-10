'use server';

import { cookies } from 'next/headers';

import { redirectTo } from '../../../lib/action';
import { currentUserIsAdmin } from '../../../lib/auth';

// Must match middleware.ts COOKIE_IMPERSONATE.
const COOKIE_IMPERSONATE = 'ccm_imp';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'alpharoc.ai';

/**
 * Start viewing the app AS another user. Admin-only; the value is stored in
 * an httpOnly cookie the middleware honours only while the real user is an
 * admin. The backend rejects all writes during impersonation.
 */
export async function startImpersonationAction(formData: FormData): Promise<void> {
  if (!(await currentUserIsAdmin())) redirectTo('/');
  const email = (formData.get('email') || '').toString().trim().toLowerCase();
  const valid =
    email.length <= 254 &&
    email.endsWith('@' + ALLOWED_DOMAIN) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!valid) redirectTo('/admin/impersonate?error=1');
  (await cookies()).set(COOKIE_IMPERSONATE, email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 2, // 2 hours — a QA session, not a standing grant
  });
  redirectTo('/');
}

/** Stop impersonating and return to your own identity. */
export async function stopImpersonationAction(_formData: FormData): Promise<void> {
  (await cookies()).set(COOKIE_IMPERSONATE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  redirectTo('/');
}
