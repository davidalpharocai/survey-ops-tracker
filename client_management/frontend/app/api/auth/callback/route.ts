// Cognito OAuth callback.
//
// Validates the CSRF `state`, exchanges the authorization `code` for
// tokens (server-side, with the client secret), stores the ID and
// refresh tokens in httpOnly cookies, and redirects to the originally
// requested page.

import { NextRequest, NextResponse } from 'next/server';

import {
  COOKIE_ID_TOKEN,
  COOKIE_OAUTH_STATE,
  COOKIE_REFRESH_TOKEN,
  exchangeCodeForTokens,
  safeNext,
  verifyIdToken,
} from '../../../../lib/cognito';

const COOKIE_NEXT = 'ccm_next';

function baseUrl(req: NextRequest): string {
  return process.env.APP_BASE_URL || (req.nextUrl.origin + req.nextUrl.basePath);
}

function loginError(req: NextRequest, reason: string): NextResponse {
  const url = new URL(baseUrl(req) + '/login');
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const state = params.get('state');

  if (params.get('error')) return loginError(req, params.get('error') as string);
  if (!code || !state) return loginError(req, 'missing_code');

  const expectedState = req.cookies.get(COOKIE_OAUTH_STATE)?.value;
  if (!expectedState || expectedState !== state) {
    console.error('[auth/callback] bad_state: expected=%s got=%s', expectedState, state);
    return loginError(req, 'bad_state');
  }

  const redirectUri = `${baseUrl(req)}/api/auth/callback`;
  console.log('[auth/callback] attempting exchange — redirectUri=%s', redirectUri);
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, redirectUri);
  } catch (err) {
    console.error('[auth/callback] token exchange failed — redirectUri=%s error=%s', redirectUri, err);
    return loginError(req, 'exchange_failed');
  }

  // Defence in depth: confirm the issued token passes our own checks
  // (group membership + domain) before accepting the session.
  const user = await verifyIdToken(tokens.id_token);
  if (!user) {
    console.error('[auth/callback] verifyIdToken returned null — unauthorized');
    return loginError(req, 'unauthorized');
  }

  const next = safeNext(req.cookies.get(COOKIE_NEXT)?.value);
  const res = NextResponse.redirect(new URL(baseUrl(req) + next));

  // Explicitly set the cookie domain to the public hostname so the browser
  // stores it for tools.alpharoc.ai, not for the upstream Amplify domain.
  const cookieDomain = (() => {
    try { return new URL(process.env.APP_BASE_URL || '').hostname || undefined; }
    catch { return undefined; }
  })();

  const secureCookie = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
  // ID token gates app access; lifetime tracks the token's own expiry.
  res.cookies.set(COOKIE_ID_TOKEN, tokens.id_token, {
    ...secureCookie,
    maxAge: tokens.expires_in,
  });
  if (tokens.refresh_token) {
    res.cookies.set(COOKIE_REFRESH_TOKEN, tokens.refresh_token, {
      ...secureCookie,
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  // Clear the one-shot flow cookies.
  res.cookies.set(COOKIE_OAUTH_STATE, '', { ...secureCookie, maxAge: 0 });
  res.cookies.set(COOKIE_NEXT, '', { ...secureCookie, maxAge: 0 });
  return res;
}
