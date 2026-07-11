// HTTP client for the FastAPI backend.
//
// All CRUD, validation and balance maths live in the backend. This
// module is the only place the frontend talks to it. Responses are
// returned in camelCase, and ISO date strings are revived into `Date`
// objects so the formatters in lib/format.ts keep working unchanged.

import { cookies, headers as nextHeaders } from 'next/headers';

import type {
  Balance,
  BalanceHealthRow,
  BalanceRow,
  Client,
  ClientUser,
  ContactStudies,
  ContractTransaction,
  ContractListRow,
  CreditRequest,
  Family,
  Ledger,
  RenewalRow,
  Salesperson,
  SearchResults,
  StudyListRow,
  SoccStatus,
  SoccSyncResult,
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

// Service secret proving requests come from this trusted frontend; the
// backend accepts X-User-Email in production only when this matches its
// INTERNAL_API_SECRET. Server-only (this module imports next/headers).
const SHARED_SECRET = process.env.BACKEND_SHARED_SECRET || '';

// Keys that hold timestamps in the API payloads. Revived to `Date` so
// templates calling isoDate()/fmtDateTime() behave as before.
const DATE_KEYS = new Set([
  'becameClientOn',
  'createdAt',
  'occurredOn',
  'renewalOn',
  'cyRenewal',
  'nextRenewal',
  'decidedAt',
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
  if (SHARED_SECRET) headers['X-Internal-Auth'] = SHARED_SECRET;
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  // Propagate the impersonation marker (set by middleware only for an admin
  // with an active "view as user" session). The backend rejects writes while
  // it is present, so an admin can never mutate data as someone else.
  const impersonatedBy = (await nextHeaders()).get('x-impersonated-by') || '';
  if (impersonatedBy) headers['X-Impersonated-By'] = impersonatedBy;
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

/**
 * A `.catch` handler that swallows ONLY a 404 (returning `fallback`) and
 * rethrows everything else. Use when a page fetches per-client data
 * optimistically: an archived/stale client id degrades to the empty state,
 * but a transient 5xx still surfaces as an error rather than silently
 * rendering fabricated data (e.g. a fake $0 balance for a real client).
 */
export function onlyNotFound<T>(fallback: T) {
  return (e: unknown): T => {
    if (e instanceof ApiError && e.status === 404) return fallback;
    throw e;
  };
}

export interface ApiClient {
  listClients(): Promise<Client[]>;
  listClientsWithUsers(): Promise<Client[]>;
  getClient(id: number): Promise<Client | null>;
  createClient(d: Record<string, unknown>): Promise<Client>;
  updateClient(id: number, d: Record<string, unknown>): Promise<Client>;
  deleteClient(id: number): Promise<{ name: string }>;

  listSalespeople(includeAll?: boolean): Promise<Salesperson[]>;
  createSalesperson(d: { name: string; email?: string | null }): Promise<Salesperson>;
  updateSalesperson(id: number, d: { name: string; email?: string | null; active?: boolean }): Promise<Salesperson>;
  deleteSalesperson(id: number): Promise<{ id: number; name: string }>;

  listClientUsers(clientId: number): Promise<ClientUser[]>;
  createClientUser(clientId: number, d: Record<string, unknown>): Promise<ClientUser>;
  getClientUser(id: number): Promise<ClientUser | null>;
  updateClientUser(id: number, d: Record<string, unknown>): Promise<ClientUser>;
  deleteClientUser(id: number): Promise<{ name: string; clientId: number }>;
  listUsersFiltered(opts: { clientId: number | null; q: string }): Promise<UserListRow[]>;
  contactStudies(id: number): Promise<ContactStudies | null>;

  getTransaction(id: number): Promise<Transaction | null>;

  listAllStudies(): Promise<StudyListRow[]>;
  listAllContracts(): Promise<ContractListRow[]>;
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
  clientFamily(clientId: number): Promise<Family>;
  allBalances(): Promise<BalanceRow[]>;
  listRenewals(): Promise<RenewalRow[]>;
  balanceHealth(): Promise<BalanceHealthRow[]>;
  listTransactionsByClient(clientId: number): Promise<Transaction[]>;
  clientLedger(clientId: number): Promise<Ledger>;
  search(q: string, limit?: number): Promise<SearchResults>;

  createAdjustment(d: Record<string, unknown>): Promise<AdjustmentResult>;

  listCreditRequests(status?: string): Promise<CreditRequest[]>;
  submitCreditRequest(d: Record<string, unknown>): Promise<CreditRequest>;
  approveCreditRequest(id: number, note?: string): Promise<CreditRequest>;
  rejectCreditRequest(id: number, note?: string): Promise<CreditRequest>;
  cancelCreditRequest(id: number): Promise<CreditRequest>;

  listAuditLogs(filters: AuditLogFilters): Promise<AuditLogPage>;

  listArchived(): Promise<ArchiveList>;
  restoreArchived(d: {
    type: ArchivedRecordType;
    id: number;
  }): Promise<{ type: ArchivedRecordType; id: number; name: string }>;

  soccSync(updates: SoccStatus[]): Promise<SoccSyncResult>;

  listTeam(): Promise<TeamList>;
  inviteTeamMember(d: { email: string; is_admin: boolean }): Promise<unknown>;
  setTeamAdmin(d: { email: string; is_admin: boolean }): Promise<unknown>;
  setTeamEnabled(d: { email: string; enabled: boolean }): Promise<unknown>;
}

// Adjustment rows come back shaped like transactions but with
// kind 'adjustment'; only the fields the UI needs are typed here.
export interface AdjustmentResult {
  id: number;
  clientId: number;
  clientName?: string | null;
  name: string;
  creditsDelta: number | string;
  dollarsDelta: number | string;
  note?: string | null;
  reversesTransactionId?: number | null;
}

export type ArchivedRecordType = 'client' | 'user' | 'transaction';

export interface ArchivedRecord {
  id: number;
  name: string;
  kind?: string; // transactions only: contract | study | adjustment
  deletedAt: string | null;
  updatedByEmail: string | null;
  clientName?: string | null; // users & transactions only
}

export interface ArchiveList {
  clients: ArchivedRecord[];
  users: ArchivedRecord[];
  transactions: ArchivedRecord[];
}

export interface TeamMember {
  email: string;
  status: string | null;
  enabled: boolean;
  isAdmin: boolean;
  adminSource: 'allowlist' | 'group' | null;
  createdAt: string | null;
}

export interface TeamList {
  configured: boolean;
  allowlistAdmins: string[];
  allowedGroup: string;
  adminGroup: string;
  allowedDomain: string;
  members: TeamMember[];
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

    listSalespeople: (includeAll = false) =>
      r('GET', `/api/salespeople${includeAll ? '?include=all' : ''}`),
    createSalesperson: d => r('POST', '/api/salespeople', d),
    updateSalesperson: (id, d) => r('PATCH', `/api/salespeople/${id}`, d),
    deleteSalesperson: id => r('DELETE', `/api/salespeople/${id}`),

    listClientUsers: clientId => r('GET', `/api/clients/${clientId}/users`),
    createClientUser: (clientId, d) => r('POST', `/api/clients/${clientId}/users`, d),
    getClientUser: id => orNull(r('GET', `/api/users/${id}`)),
    updateClientUser: (id, d) => r('PATCH', `/api/users/${id}`, d),
    deleteClientUser: id => r('DELETE', `/api/users/${id}`),
    contactStudies: id => orNull(r('GET', `/api/users/${id}/studies`)),
    listUsersFiltered: ({ clientId, q }) => {
      const qs = new URLSearchParams();
      if (clientId) qs.set('client_id', String(clientId));
      if (q) qs.set('q', q);
      const s = qs.toString();
      return r('GET', `/api/users${s ? `?${s}` : ''}`);
    },

    getTransaction: id => orNull(r('GET', `/api/transactions/${id}`)),

    listAllStudies: () => r('GET', '/api/studies'),
    listAllContracts: () => r('GET', '/api/contracts'),
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
    clientFamily: clientId => r('GET', `/api/clients/${clientId}/family`),
    allBalances: () => r('GET', '/api/reports/balances'),
    listRenewals: () => r('GET', '/api/reports/renewals'),
    balanceHealth: () => r('GET', '/api/reports/balance-health'),
    listTransactionsByClient: clientId => r('GET', `/api/clients/${clientId}/transactions`),
    clientLedger: clientId => r('GET', `/api/clients/${clientId}/ledger`),
    search: (q, limit = 6) => r('GET', `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),

    createAdjustment: d => r('POST', '/api/adjustments', d),

    listCreditRequests: status =>
      r('GET', `/api/credit-requests${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    submitCreditRequest: d => r('POST', '/api/credit-requests', d),
    approveCreditRequest: (id, note) =>
      r('POST', `/api/credit-requests/${id}/approve`, note != null ? { decision_note: note } : {}),
    rejectCreditRequest: (id, note) =>
      r('POST', `/api/credit-requests/${id}/reject`, note != null ? { decision_note: note } : {}),
    cancelCreditRequest: id => r('POST', `/api/credit-requests/${id}/cancel`),

    listArchived: () => r('GET', '/api/admin/archive'),
    restoreArchived: d => r('POST', '/api/admin/archive/restore', d),

    listAuditLogs: filters => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v) qs.set(k, String(v));
      }
      const s = qs.toString();
      return r('GET', `/api/admin/audit-logs${s ? `?${s}` : ''}`);
    },

    soccSync: updates =>
      r('POST', '/api/admin/socc-sync', {
        updates: updates.map(u => ({
          pr_code: u.prCode,
          board_column: u.boardColumn,
          project_name: u.projectName,
          client_name: u.clientName,
        })),
      }),

    listTeam: () => r('GET', '/api/admin/team'),
    inviteTeamMember: d => r('POST', '/api/admin/team', d),
    setTeamAdmin: d => r('POST', '/api/admin/team/set-admin', d),
    setTeamEnabled: d => r('POST', '/api/admin/team/set-enabled', d),
  };
}
