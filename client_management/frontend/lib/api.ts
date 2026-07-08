// HTTP client for the FastAPI backend.
//
// All CRUD, validation and balance maths live in the backend. This
// module is the only place the frontend talks to it. Responses are
// returned in camelCase, and ISO date strings are revived into `Date`
// objects so the formatters in lib/format.ts keep working unchanged.

import { cookies } from 'next/headers';

import type {
  Balance,
  BalanceRow,
  Client,
  ClientUser,
  ContractTransaction,
  StudyTransaction,
  Transaction,
  UserListRow,
  BulkUpdateStudiesResult,
  AuditLogFilters,
  AuditLogPage,
} from './types';

import { COOKIE_ID_TOKEN } from './cognito';

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:8000').replace(
  /\/+$/,
  '',
);

// Keys that hold timestamps in the API payloads. Revived to `Date` so
// templates calling isoDate()/fmtDateTime() behave as before.
const DATE_KEYS = new Set([
  'becameClientOn',
  'createdAt',
  'occurredOn',
  'renewalOn',
  'cyRenewal',
]);

/** Error carrying the backend's HTTP status and human-readable detail. */
export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
    this.status = status;
    this.detail = this.message;
  }
}

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v && typeof v === 'object') out[k] = revive(v);
      else if (typeof v === 'string' && DATE_KEYS.has(k)) out[k] = new Date(v);
      else out[k] = v;
    }
    return out;
  }
  return value;
}

async function request<T>(
  userEmail: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  // Forward the user's Cognito ID token; the backend verifies it
  // independently (signature, issuer, audience, group). X-User-Email is
  // kept for the local-dev path where Cognito is not configured.
  const idToken = (await cookies()).get(COOKIE_ID_TOKEN)?.value || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-User-Email': userEmail || '',
  };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const detailFromData =
      data && typeof data === 'object' && 'detail' in data
        ? (data as { detail: unknown }).detail
        : undefined;
    const detail =
      (typeof detailFromData === 'string' && detailFromData) ||
      (text && text.slice(0, 500)) ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, detail);
  }
  return revive(data) as T;
}

// Resolve to null on 404 (mirrors the legacy repo.js getters).
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export interface ApiClient {
  listClients(): Promise<Client[]>;
  listClientsWithUsers(): Promise<Client[]>;
  getClient(id: number): Promise<Client | null>;
  createClient(d: Record<string, unknown>): Promise<Client>;
  updateClient(id: number, d: Record<string, unknown>): Promise<Client>;
  deleteClient(id: number): Promise<{ name: string }>;

  listClientUsers(clientId: number): Promise<ClientUser[]>;
  createClientUser(clientId: number, d: Record<string, unknown>): Promise<ClientUser>;
  getClientUser(id: number): Promise<ClientUser | null>;
  updateClientUser(id: number, d: Record<string, unknown>): Promise<ClientUser>;
  deleteClientUser(id: number): Promise<{ name: string; clientId: number }>;
  listUsersFiltered(opts: { clientId: number | null; q: string }): Promise<UserListRow[]>;

  getTransaction(id: number): Promise<Transaction | null>;

  listContractsByClient(clientId: number): Promise<ContractTransaction[]>;
  createContract(d: Record<string, unknown>): Promise<ContractTransaction & { clientName: string }>;
  updateContract(id: number, d: Record<string, unknown>): Promise<ContractTransaction>;
  deleteContract(id: number): Promise<{ name: string; clientId: number }>;

  listStudiesByClient(clientId: number): Promise<StudyTransaction[]>;
  createStudy(d: Record<string, unknown>): Promise<StudyTransaction & { clientName: string }>;
  updateStudy(id: number, d: Record<string, unknown>): Promise<StudyTransaction>;
  deleteStudy(id: number): Promise<{ name: string; clientId: number }>;
  markStudyReviewed(id: number): Promise<{ name: string; clientId: number }>;
  bulkUpdateStudies(d: Record<string, unknown>): Promise<BulkUpdateStudiesResult>;

  clientBalances(clientId: number): Promise<Balance>;
  allBalances(): Promise<BalanceRow[]>;
  listTransactionsByClient(clientId: number): Promise<Transaction[]>;

  listAuditLogs(filters: AuditLogFilters): Promise<AuditLogPage>;
}

/**
 * Build a request-scoped API client bound to the acting user's email
 * (sent to the backend for attribution and authorisation).
 */
export function api(userEmail: string): ApiClient {
  const r = <T>(m: string, p: string, b?: unknown) => request<T>(userEmail, m, p, b);
  return {
    listClients: () => r('GET', '/api/clients'),
    listClientsWithUsers: () => r('GET', '/api/clients?include=users'),
    getClient: id => orNull(r('GET', `/api/clients/${id}`)),
    createClient: d => r('POST', '/api/clients', d),
    updateClient: (id, d) => r('PATCH', `/api/clients/${id}`, d),
    deleteClient: id => r('DELETE', `/api/clients/${id}`),

    listClientUsers: clientId => r('GET', `/api/clients/${clientId}/users`),
    createClientUser: (clientId, d) => r('POST', `/api/clients/${clientId}/users`, d),
    getClientUser: id => orNull(r('GET', `/api/users/${id}`)),
    updateClientUser: (id, d) => r('PATCH', `/api/users/${id}`, d),
    deleteClientUser: id => r('DELETE', `/api/users/${id}`),
    listUsersFiltered: ({ clientId, q }) => {
      const qs = new URLSearchParams();
      if (clientId) qs.set('client_id', String(clientId));
      if (q) qs.set('q', q);
      const s = qs.toString();
      return r('GET', `/api/users${s ? `?${s}` : ''}`);
    },

    getTransaction: id => orNull(r('GET', `/api/transactions/${id}`)),

    listContractsByClient: clientId => r('GET', `/api/clients/${clientId}/contracts`),
    createContract: d => r('POST', '/api/contracts', d),
    updateContract: (id, d) => r('PATCH', `/api/contracts/${id}`, d),
    deleteContract: id => r('DELETE', `/api/contracts/${id}`),

    listStudiesByClient: clientId => r('GET', `/api/clients/${clientId}/studies`),
    createStudy: d => r('POST', '/api/studies', d),
    updateStudy: (id, d) => r('PATCH', `/api/studies/${id}`, d),
    deleteStudy: id => r('DELETE', `/api/studies/${id}`),
    markStudyReviewed: id => r('POST', `/api/studies/${id}/mark-reviewed`),
    bulkUpdateStudies: d => r('POST', '/api/studies/bulk-update', d),

    clientBalances: clientId => r('GET', `/api/clients/${clientId}/balances`),
    allBalances: () => r('GET', '/api/reports/balances'),
    listTransactionsByClient: clientId => r('GET', `/api/clients/${clientId}/transactions`),

    listAuditLogs: filters => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v) qs.set(k, String(v));
      }
      const s = qs.toString();
      return r('GET', `/api/admin/audit-logs${s ? `?${s}` : ''}`);
    },
  };
}
