// Impersonation start/stop as a route handler (not a server action) so the
// browser does a FULL-PAGE navigation. Changing the effective identity mid-
// session via a server-action soft-redirect left the client router cache
// stale and rendered a spurious 404 on the home route; a real HTTP redirect
// rebuilds the client from scratch as the new identity.

import { NextRequest, NextResponse } from 'next/server';

const COOKIE_IMPERSONATE = 'ccm_imp'; // must match middleware.ts
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'alpharoc.ai';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

function cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData();
  const intent = String(form.get('intent') || '');
  const home = new URL(BASE_PATH || '/', req.url);

  if (intent === 'stop') {
    const res = NextResponse.redirect(home, { status: 303 });
    res.cookies.set(COOKIE_IMPERSONATE, '', cookieOpts(0));
    return res;
  }

  // start — only a real admin may begin impersonating. While not yet
  // impersonating there is no ccm_imp cookie, so middleware sets
  // x-user-admin from the real identity.
  const isAdmin = req.headers.get('x-user-admin') === '1';
  const email = String(form.get('email') || '').trim().toLowerCase();
  const valid =
    isAdmin &&
    email.length <= 254 &&
    email.endsWith('@' + ALLOWED_DOMAIN) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!valid) {
    return NextResponse.redirect(
      new URL(`${BASE_PATH}/admin/impersonate?error=1`, req.url),
      { status: 303 },
    );
  }
  const res = NextResponse.redirect(home, { status: 303 });
  res.cookies.set(COOKIE_IMPERSONATE, email, cookieOpts(60 * 60 * 2)); // 2h
  return res;
}
