// Cognito Hosted UI (OAuth 2.0 authorization code flow) helpers.
//
// The browser is sent to the Cognito Hosted UI to sign in; Cognito
// redirects back to /api/auth/callback with a `code`, which the server
// exchanges for tokens (confidential client, secret kept server-side).
// Tokens are stored in httpOnly cookies. Both this app's middleware and
// the backend independently verify the ID token.
//
// This module avoids `next/headers` so it can be imported from edge
// middleware as well as node route handlers; cookie access lives in the
// callers.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const DOMAIN = (process.env.COGNITO_DOMAIN || '').replace(/\/+$/, '');
const ISSUER = (process.env.COGNITO_ISSUER || '').replace(/\/+$/, '');
const CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';
// COGNITO_CLIENT_CREDENTIAL avoids Amplify's SSM-secret filtering that
// silences env vars containing the word "SECRET" during builds.
const CLIENT_SECRET = process.env.COGNITO_CLIENT_CREDENTIAL || process.env.COGNITO_CLIENT_SECRET || '';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'alpharoc.ai';
const ALLOWED_GROUP = process.env.COGNITO_ALLOWED_GROUP || 'ccm-users';
const ADMIN_GROUP = process.env.COGNITO_ADMIN_GROUP || 'ccm-admins';

// Emails granted admin regardless of Cognito group. Mirrors the
// backend's CCM_ADMIN_EMAILS so both tiers agree on who is an admin.
const ADMIN_EMAILS = new Set(
  (process.env.CCM_ADMIN_EMAILS ||
    'david@alpharoc.ai,tedi@alpharoc.ai,nachi@alpharoc.ai')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
);

/** Whether an identity is an admin (allow-list email OR admin group). */
export function isAdminIdentity(email: string, groups: string[]): boolean {
  return ADMIN_EMAILS.has(email.trim().toLowerCase()) || groups.includes(ADMIN_GROUP);
}

// CLIENT_SECRET is only used server-side (token exchange); do not gate
// COGNITO_ENABLED on it — Edge middleware never has access to the secret.
export const COGNITO_ENABLED = Boolean(DOMAIN && ISSUER && CLIENT_ID);

// Cookie names. Short, httpOnly, set by the callback route.
export const COOKIE_ID_TOKEN = 'ccm_id';
export const COOKIE_REFRESH_TOKEN = 'ccm_rt';
export const COOKIE_OAUTH_STATE = 'ccm_oauth_state';

// Lazily-built JWKS verifier; jose caches and refreshes keys itself.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
  return jwks;
}

export interface VerifiedUser {
  email: string;
  isAdmin: boolean;
  claims: JWTPayload;
}

/**
 * Verify a Cognito ID token: signature (JWKS), issuer, audience, expiry,
 * `token_use`, group membership and email domain. Returns the user on
 * success, or null if the token is missing/invalid/unauthorized.
 */
export async function verifyIdToken(token: string | undefined): Promise<VerifiedUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: ISSUER,
      audience: CLIENT_ID,
      algorithms: ['RS256'],
    });
    if (payload.token_use !== 'id') return null;
    if (String(payload.email_verified) !== 'true') return null;

    const groups = (payload['cognito:groups'] as string[] | undefined) || [];
    if (!groups.includes(ALLOWED_GROUP)) return null;

    const email = String(payload.email || '').toLowerCase();
    if (!email || !email.endsWith('@' + ALLOWED_DOMAIN)) return null;

    return { email, isAdmin: isAdminIdentity(email, groups), claims: payload };
  } catch {
    return null;
  }
}

/**
 * Return `next` only if it is a safe in-app, path-absolute destination.
 * Rejects protocol-relative (`//host`) and backslash-tricked (`/\host`)
 * values, and anything not starting with `/`, to prevent open redirects.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/')) return '/';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

/** Build the Hosted UI authorize URL that starts the login flow. */
export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    state,
  });
  return `${DOMAIN}/oauth2/authorize?${params.toString()}`;
}

/** Build the Hosted UI logout URL (clears the Cognito session too). */
export function buildLogoutUrl(logoutRedirectUri: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: logoutRedirectUri,
  });
  return `${DOMAIN}/logout?${params.toString()}`;
}

export interface TokenSet {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** Exchange an authorization code for tokens at the Cognito token endpoint. */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<TokenSet> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
    }).toString(),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as TokenSet;
}
