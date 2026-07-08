// Authentication gate (Cognito).
//
// Production: the user signs in via the Cognito Hosted UI; the callback
// route stores the ID token in an httpOnly cookie. This middleware
// verifies that token (signature via JWKS, issuer, audience, expiry,
// group membership, @alpharoc.ai domain) on every request. Unauthenticated
// requests are redirected to /login. The verified email is forwarded to
// server components and actions via the `x-user-email` request header.
//
// Local development (Cognito not configured): falls back to
// DEV_USER_EMAIL so the app is usable without an IdP.

import { NextRequest, NextResponse } from 'next/server';

import { COGNITO_ENABLED, COOKIE_ID_TOKEN, verifyIdToken } from './lib/cognito';

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'alpharoc.ai';

// Paths reachable without authentication.
function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/healthz' ||
    pathname === '/login' ||
    pathname.startsWith('/api/auth/')
  );
}

function forward(req: NextRequest, email: string, isAdmin: boolean): NextResponse {
  const headers = new Headers(req.headers);
  headers.set('x-user-email', email);
  headers.set('x-user-admin', isAdmin ? '1' : '0');
  return NextResponse.next({ request: { headers } });
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  if (!COGNITO_ENABLED) {
    // Local development shim — never honoured in production, so a
    // misconfigured prod deploy fails closed rather than open.
    const devEmail = process.env.DEV_USER_EMAIL || '';
    if (
      process.env.NODE_ENV !== 'production' &&
      devEmail &&
      devEmail.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)
    ) {
      // Local dev has no IdP; treat the dev user as an admin so the
      // admin page is reachable without Cognito.
      return forward(req, devEmail, true);
    }
    return new NextResponse(
      'Auth not configured. Set Cognito env vars, or DEV_USER_EMAIL for local dev.',
      { status: 401 },
    );
  }

  const token = req.cookies.get(COOKIE_ID_TOKEN)?.value;
  const user = await verifyIdToken(token);
  if (!user) {
const loginUrl = new URL(req.nextUrl.basePath + '/login', req.url);
    // Preserve where the user was headed so we can return there.
    loginUrl.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return forward(req, user.email, user.isAdmin);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
