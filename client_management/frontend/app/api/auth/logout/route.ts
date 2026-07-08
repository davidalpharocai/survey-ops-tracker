// Logout: clears the session cookies and ends the Cognito Hosted UI
// session, returning the user to /login.

import { NextRequest, NextResponse } from 'next/server';

import {
  buildLogoutUrl,
  COOKIE_ID_TOKEN,
  COOKIE_REFRESH_TOKEN,
} from '../../../../lib/cognito';

function baseUrl(req: NextRequest): string {
  return process.env.APP_BASE_URL || req.nextUrl.origin;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.redirect(buildLogoutUrl(`${baseUrl(req)}/login`));
  const clear = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 0 };
  res.cookies.set(COOKIE_ID_TOKEN, '', clear);
  res.cookies.set(COOKIE_REFRESH_TOKEN, '', clear);
  return res;
}
