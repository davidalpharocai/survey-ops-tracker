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
  users?: ClientUser[];
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
