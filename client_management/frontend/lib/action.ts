// Helpers shared by server actions.

import { redirect as nextRedirect } from 'next/navigation';

import { api, type ApiClient } from './api';
import { currentUserEmail } from './auth';

// next/navigation's redirect() does not prepend basePath (unlike <Link>),
// so a bare redirect('/clients') escapes /ccm and lands on a 404. All
// server actions must redirect through this wrapper instead.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** basePath-aware redirect for server actions (throws, like redirect()). */
export function redirectTo(path: string): never {
  nextRedirect(BASE_PATH + path);
}

/** Build a request-scoped API client for the acting user. */
export async function apiForRequest(): Promise<ApiClient> {
  const email = await currentUserEmail();
  return api(email);
}

/** String → integer (returns null when the input is missing/empty). */
export function parseId(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}
