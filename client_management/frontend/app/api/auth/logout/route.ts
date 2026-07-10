// Logout: clears the session cookies and ends the Cognito Hosted UI
// session, returning the user to /login.

import { NextRequest, NextResponse } from 'next/server';

import {
  buildLogoutUrl,
  COGNITO_ENABLED,
  COOKIE_ID_TOKEN,
  COOKIE_REFRESH_TOKEN,
} from '../../../../lib/cognito';

function baseUrl(req: NextRequest): string {
  // Include the basePath (/ccm) so the post-logout redirect lands on the app,
  // not the bare origin root (which 404s), when APP_BASE_URL is unset.
  return process.env.APP_BASE_URL || req.nextUrl.origin + req.nextUrl.basePath;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const base = baseUrl(req);
  // When Cognito isn't configured (e.g. the Basic-Auth preview), there is
  // no Hosted UI session to end. buildLogoutUrl would return a *relative*
  // URL (empty COGNITO_DOMAIN), which NextResponse.redirect rejects with a
  // 500 — so fall back to clearing cookies and returning to the app root.
  const target = COGNITO_ENABLED ? buildLogoutUrl(`${base}/login`) : `${base}/`;
  const res = NextResponse.redirect(target);
  const clear = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 0 };
  res.cookies.set(COOKIE_ID_TOKEN, '', clear);
  res.cookies.set(COOKIE_REFRESH_TOKEN, '', clear);
  return res;
}
