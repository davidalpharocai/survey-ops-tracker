// Starts the Cognito Hosted UI login flow.
//
// Generates a CSRF `state`, stores it (and the post-login destination)
// in short-lived httpOnly cookies, then redirects the browser to the
// Hosted UI authorize endpoint.

import { NextRequest, NextResponse } from 'next/server';

import { buildAuthorizeUrl, COOKIE_OAUTH_STATE, safeNext } from '../../../../lib/cognito';

const COOKIE_NEXT = 'ccm_next';

function baseUrl(req: NextRequest): string {
  return process.env.APP_BASE_URL || (req.nextUrl.origin + req.nextUrl.basePath);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const state = crypto.randomUUID();
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  const redirectUri = `${baseUrl(req)}/api/auth/callback`;

  const res = NextResponse.redirect(buildAuthorizeUrl(redirectUri, state));
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600,
  };
  res.cookies.set(COOKIE_OAUTH_STATE, state, cookieOpts);
  // `next` is already sanitized by safeNext() to a same-site path.
  res.cookies.set(COOKIE_NEXT, next, cookieOpts);
  return res;
}
