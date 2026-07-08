// Helpers shared by server actions.

import { api, type ApiClient } from './api';
import { currentUserEmail } from './auth';

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
