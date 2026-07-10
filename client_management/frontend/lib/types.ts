// Domain types mirroring the FastAPI backend's response shapes.
// camelCase matches what `lib/api.ts` returns after JSON revive.

export type Cadence = 'single' | 'weekly' | 'monthly' | 'quarterly';
export type CostType = 'credits' | 'dollars';
export type TransactionKind = 'contract' | 'study';

export interface Client {
  id: number;
  name: string;
  soccCode?: string | null;
  becameClientOn: Date;
  primaryContactName?: string | null;
  primaryContactCell?: string | null;
  primaryContactEmail?: string | null;
  relationshipManager?: string | null;
  salespersonId?: number | null;
  salespersonName?: string | null;
  salespersonEmail?: string | null;
  users?: ClientUser[];
}

export interface Salesperson {
  id: number;
  name: string;
  email?: string | null;
  active: boolean;
}

export interface ClientUser {
  id: number;
  name: string;
  email?: string | null;
  clientId: number;
}

export interface Balance {
  credits: number;
  dollars: number;
  cyCredits: number;
  cyValue: number;
  cyRenewal: Date | null;
}

export interface BalanceRow extends Balance {
  client: Client;
}

export interface UserListRow {
  id: number;
  name: string;
  email?: string | null;
  client: { id: number; name: string };
}

export type CreditRequestStatus = 'pending' | 'approved' | 'rejected' | 'canceled';

// Credit-approval queue row (GET /api/credit-requests).
export interface CreditRequest {
  id: number;
  clientId: number;
  transactionId?: number | null;
  creditsDelta: number;
  dollarsDelta: number;
  note: string;
  status: CreditRequestStatus;
  requestedByEmail: string;
  createdAt: Date;
  decidedByEmail?: string | null;
  decidedAt?: Date | null;
  decisionNote?: string | null;
  resultingTransactionId?: number | null;
  client?: Client;
}

// GET /api/users/{id}/studies — a contact and the surveys they requested.
export interface ContactStudies {
  contact: ClientUser;
  client: Client | null;
  studies: StudyTransaction[];
}

interface TransactionBase {
  id: number;
  clientId: number;
  clientName?: string;
  name: string;
  occurredOn: Date;
  renewalOn?: Date | null;
  creditsDelta: number | string;
  dollarsDelta: number | string;
  actorEmail: string;
  soccProjectCode?: string | null;
  contractId?: number | null;
  soccBoardColumn?: string | null;
  soccSyncedAt?: string | null;
  createdAt: Date;
  clientUser?: ClientUser | null;
}

export interface ContractTransaction extends TransactionBase {
  kind: 'contract';
  creditsAmount: number | string;
  dollarsAmount: number | string;
}

export interface StudyTransaction extends TransactionBase {
  kind: 'study';
  cadence: Cadence;
  costType: CostType;
  costPerRun: number | string;
  setupCost: number | string;
  costAnnual: number | string;
  userIds: number[];
  userObjs: ClientUser[];
  isImported?: boolean;
}

export type Transaction = ContractTransaction | StudyTransaction;

// Global list rows (GET /api/studies, /api/contracts) — the per-row client is
// embedded (with its salesperson) so the screens can filter to "mine".
export interface StudyListRow extends StudyTransaction { client: Client; }
export interface ContractListRow extends ContractTransaction { client: Client; }

// Contract-grouped ledger (GET /api/clients/{id}/ledger).
export interface LedgerContract extends ContractTransaction {
  remainingCredits: number;
  remainingDollars: number;
  studies: StudyTransaction[];
}
export interface LedgerAdjustment extends TransactionBase {
  kind: 'adjustment';
  note?: string | null;
}
export interface Ledger {
  contracts: LedgerContract[];
  unassigned: StudyTransaction[];
  adjustments: LedgerAdjustment[];
  totals: { credits: number; dollars: number };
}

// Global search (omnibox) result groups.
export interface SearchClientHit { id: number; name: string; code?: string | null; }
export interface SearchTxnHit { id: number; name: string; code?: string | null; clientId: number; clientName: string; }
export interface SearchContactHit { id: number; name: string; email?: string | null; clientId: number; clientName: string; }
export interface SearchResults {
  clients: SearchClientHit[];
  contracts: SearchTxnHit[];
  studies: SearchTxnHit[];
  contacts: SearchContactHit[];
}

// CCM <- SOCC manual status sync.
export interface SoccStatus { prCode: string; boardColumn: string; projectName: string; clientName: string; }
export interface SoccSyncMatched { prCode: string; studyId: number; name: string; boardColumn: string; clientId: number; clientName: string; }
export interface SoccSyncUnmatched { prCode: string; boardColumn: string; projectName: string; clientName: string; }
export interface SoccSyncResult {
  matched: SoccSyncMatched[];
  unmatched: SoccSyncUnmatched[];
  matchedCount: number;
  unmatchedCount: number;
}

export interface BulkUpdateStudiesResult {
  updated: number;
  errors: string[];
}

export interface AuditLog {
  occurredAt: string;
  actorEmail: string | null;
  method: string;
  path: string;
  route: string | null;
  resourceType: string | null;
  resourceId: string | null;
  action: string | null;
  statusCode: number | null;
  outcome: string | null;
  durationMs: number | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestBody: string | null;
}

export interface AuditLogFilters {
  actor?: string;
  action?: string;
  resource_type?: string;
  status_code?: string;
  outcome?: string;
  q?: string;
  from?: string;
  to?: string;
  queryId?: string;
  nextToken?: string;
}

export interface AuditLogPage {
  rows: AuditLog[];
  queryId: string | null;
  nextToken: string | null;
  athena?: boolean;
}

export type RenewalBucket = '30' | '60' | '90' | 'later';

export interface RenewalRow {
  client: Client;
  contractId: number;
  contractName: string;
  renewalOn: Date;
  daysUntil: number;
  creditsAmount: number;
  dollarsAmount: number;
  bucket: RenewalBucket;
}

export type BalanceHealthStatus = 'negative' | 'low' | 'ok';

export interface BalanceHealthRow {
  client: Client;
  credits: number;
  dollars: number;
  monthlyCreditBurn: number;
  monthlyDollarBurn: number;
  /** YYYY-MM-DD, or null when there is no burn / no positive balance. */
  creditsRunOutOn: string | null;
  dollarsRunOutOn: string | null;
  status: BalanceHealthStatus;
}
