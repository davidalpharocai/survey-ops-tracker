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

import {
  COGNITO_ENABLED,
  COOKIE_ID_TOKEN,
  resolveRole,
  verifyIdToken,
  type Role,
} from './lib/cognito';

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'alpharoc.ai';
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';
// Cookie holding the email an admin is currently "viewing as". Honoured
// ONLY when the real authenticated user is an admin (see forwardApplying).
const COOKIE_IMPERSONATE = 'ccm_imp';

// The validated impersonation target from the cookie, or null. Must be a
// well-formed @alpharoc.ai email; anything else is ignored.
function impersonationTarget(req: NextRequest): string | null {
  const v = (req.cookies.get(COOKIE_IMPERSONATE)?.value || '').trim().toLowerCase();
  if (!v || v.length > 254) return null;
  if (!v.endsWith('@' + ALLOWED_DOMAIN)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

// Paths reachable without authentication.
function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/healthz' ||
    pathname === '/login' ||
    pathname.startsWith('/api/auth/')
  );
}

// Constant-time string comparison (edge runtime has no node:crypto).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// HTTP Basic Auth gate — the documented production gate for deployments
// without Cognito (e.g. the shared preview). The username is the
// @alpharoc.ai email used for attribution; the password is the shared
// BASIC_AUTH_PASSWORD. Takes precedence over the dev shim when set.
function basicAuthGate(req: NextRequest): NextResponse | { email: string } {
  const challenge = () =>
    new NextResponse('Sign in with your @alpharoc.ai email and the shared password.', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="AlphaROC CCM", charset="UTF-8"' },
    });
  const header = req.headers.get('authorization') || '';
  if (!header.toLowerCase().startsWith('basic ')) return challenge();
  let decoded = '';
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return challenge();
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return challenge();
  const email = decoded.slice(0, sep).trim().toLowerCase();
  const password = decoded.slice(sep + 1);
  if (!safeEqual(password, BASIC_AUTH_PASSWORD)) return challenge();
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    return new NextResponse(`Access is restricted to @${ALLOWED_DOMAIN} accounts.`, { status: 403 });
  }
  return { email };
}

function forward(req: NextRequest, email: string, role: Role): NextResponse {
  const headers = new Headers(req.headers);
  headers.set('x-user-email', email);
  headers.set('x-user-admin', role === 'admin' ? '1' : '0');
  headers.set('x-user-role', role);
  // The middleware is the sole source of truth for identity headers — never
  // let a client inject its own impersonation marker.
  headers.delete('x-impersonated-by');
  return NextResponse.next({ request: { headers } });
}

// Forward the real identity, or — when the real user is an admin with an
// active "view as user" cookie — forward the impersonated identity plus the
// `x-impersonated-by` marker (which makes the backend reject all writes).
function forwardApplying(req: NextRequest, email: string, role: Role): NextResponse {
  if (role === 'admin') {
    const target = impersonationTarget(req);
    if (target && target !== email.trim().toLowerCase()) {
      const headers = new Headers(req.headers);
      const impRole = resolveRole(target, []);
      headers.set('x-user-email', target);
      headers.set('x-user-admin', impRole === 'admin' ? '1' : '0');
      headers.set('x-user-role', impRole);
      headers.set('x-impersonated-by', email.trim().toLowerCase());
      return NextResponse.next({ request: { headers } });
    }
  }
  return forward(req, email, role);
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // Basic Auth gate (shared preview deployments). When configured it is
  // the authentication method, in any environment.
  if (!COGNITO_ENABLED && BASIC_AUTH_PASSWORD) {
    const result = basicAuthGate(req);
    if (result instanceof NextResponse) return result;
    return forwardApplying(req, result.email, resolveRole(result.email, []));
  }

  if (!COGNITO_ENABLED) {
    // Local development shim — never honoured in production, so a
    // misconfigured prod deploy fails closed rather than open.
    const devEmail = process.env.DEV_USER_EMAIL || '';
    if (
      process.env.NODE_ENV !== 'production' &&
      devEmail &&
      devEmail.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)
    ) {
      // Local dev has no IdP; admin rights follow the CCM_ADMIN_EMAILS
      // allow-list (same as production), not an automatic grant.
      return forwardApplying(req, devEmail, resolveRole(devEmail, []));
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

  return forwardApplying(req, user.email, user.role);
}

export const config = {
  // The bare basePath root needs its own entry — the pattern below does
  // not match it (long-standing Next basePath quirk), which previously
  // left the home page outside the auth gate.
  matcher: ['/', '/((?!_next/static|_next/image|favicon.ico).*)'],
};
