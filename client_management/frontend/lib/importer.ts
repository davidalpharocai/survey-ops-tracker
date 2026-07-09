// Spreadsheet import: parse an uploaded .xlsx, diff it against the live
// CMS state, and produce a serializable plan of creates/updates that the
// apply step executes through the existing backend API.
//
// Two accepted formats, auto-detected from tab names:
// - "template": Clients / Users / Contracts / Studies tabs with CMS-native
//   columns (the only format that carries money). Matched rows become
//   updates of ONLY the columns the sheet fills.
// - "socc": the Survey Ops Command Center export (Projects/Clients/
//   Client Contacts tabs). Create-only — the tracker has no pricing, so
//   matched rows are never touched.
//
// Matching is by name, case-insensitive: client name globally; user /
// contract / study name within their client. The importer never deletes.

import ExcelJS from 'exceljs';

import type { ApiClient } from './api';
import { isoDate } from './format';

export type ImportTab = 'clients' | 'users' | 'contracts' | 'studies';
export type RowAction = 'create' | 'update' | 'unchanged' | 'error';

export interface Change {
  field: string;
  from: string;
  to: string;
}

export interface PlanRow {
  tab: ImportTab;
  action: RowAction;
  client: string;
  name: string;
  changes: Change[];
  error?: string;
  /** Body for the API call. `client_id` is resolved at apply time. */
  payload?: Record<string, unknown>;
  /** For updates: the existing record's id. */
  targetId?: number;
  /** Resolved owning-client id (set when the client was matched by code
   * under a different live name; apply must not re-resolve by name). */
  clientId?: number;
  /** Study attribution to resolve/create at apply time (user name). */
  ensureUser?: string;
}

export interface ImportPlan {
  format: 'socc' | 'template';
  fileName: string;
  rows: PlanRow[];
  counts: Record<RowAction, number>;
}

export interface ApplyRowResult {
  tab: ImportTab;
  client: string;
  name: string;
  action: RowAction;
  ok: boolean;
  message: string;
}

export interface ApplyResult {
  applied: number;
  failed: number;
  rows: ApplyRowResult[];
}

// ---------------------------------------------------------------- parsing

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellToString(v.result as ExcelJS.CellValue);
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map(r => r.text).join('').trim();
    }
    return '';
  }
  return String(v).trim();
}

/** Accepts YYYY-MM-DD or M/D/YYYY; returns YYYY-MM-DD or null. */
function toIsoDay(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

type SheetRow = Record<string, string>;

function sheetRows(ws: ExcelJS.Worksheet): SheetRow[] {
  const headerRow = ws.getRow(1);
  const keys: (string | null)[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    const h = cellToString(cell.value);
    keys[col] = h ? normHeader(h) : null;
  });
  const out: SheetRow[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o: SheetRow = {};
    let any = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = keys[col];
      if (!key) return;
      const val = cellToString(cell.value);
      if (val) any = true;
      // first matching header wins
      if (o[key] === undefined) o[key] = val;
    });
    if (any) out.push(o);
  });
  return out;
}

/** First non-empty value among alias header keys. */
function pick(row: SheetRow, ...aliases: string[]): string {
  for (const a of aliases) {
    const v = row[a];
    if (v) return v;
  }
  return '';
}

// ------------------------------------------------------------- live state

interface LiveClient {
  id: number;
  name: string;
  soccCode: string;
  becameClientOn: string; // ISO day
  relationshipManager: string;
  primaryContactName: string;
  primaryContactCell: string;
  primaryContactEmail: string;
  users: Map<string, { id: number; name: string; email: string }>;
}

interface LiveState {
  clients: Map<string, LiveClient>; // key: lower name
  clientsByCode: Map<string, LiveClient>; // key: socc_code (Cl#####)
  contracts: Map<number, Map<string, Record<string, unknown>>>; // clientId -> lower name -> decorated
  studies: Map<number, Map<string, Record<string, unknown>>>;
}

async function fetchLiveState(api: ApiClient, clientNames: Set<string>): Promise<LiveState> {
  const raw = (await api.listClientsWithUsers()) as unknown as Array<Record<string, unknown>>;
  const clients = new Map<string, LiveClient>();
  const clientsByCode = new Map<string, LiveClient>();
  for (const c of raw) {
    const users = new Map<string, { id: number; name: string; email: string }>();
    for (const u of (c.users as Array<Record<string, unknown>>) || []) {
      users.set(String(u.name).toLowerCase(), {
        id: u.id as number,
        name: String(u.name),
        email: (u.email as string) || '',
      });
    }
    const live: LiveClient = {
      id: c.id as number,
      name: String(c.name),
      soccCode: (c.soccCode as string) || '',
      becameClientOn: isoDate(c.becameClientOn as Date | string),
      relationshipManager: (c.relationshipManager as string) || '',
      primaryContactName: (c.primaryContactName as string) || '',
      primaryContactCell: (c.primaryContactCell as string) || '',
      primaryContactEmail: (c.primaryContactEmail as string) || '',
      users,
    };
    clients.set(live.name.toLowerCase(), live);
    if (live.soccCode) clientsByCode.set(live.soccCode, live);
  }
  // Contracts/studies only for the clients the sheet references.
  const contracts = new Map<number, Map<string, Record<string, unknown>>>();
  const studies = new Map<number, Map<string, Record<string, unknown>>>();
  for (const nameLower of clientNames) {
    const c = clients.get(nameLower);
    if (!c) continue;
    const [cs, ss] = await Promise.all([
      api.listContractsByClient(c.id) as unknown as Promise<Array<Record<string, unknown>>>,
      api.listStudiesByClient(c.id) as unknown as Promise<Array<Record<string, unknown>>>,
    ]);
    contracts.set(c.id, new Map(cs.map(t => [String(t.name).toLowerCase(), t])));
    studies.set(c.id, new Map(ss.map(t => [String(t.name).toLowerCase(), t])));
  }
  return { clients, clientsByCode, contracts, studies };
}

// ------------------------------------------------------------ plan builders

const CADENCES = new Set(['single', 'weekly', 'monthly', 'quarterly']);

function numOr(v: string, fallback: number): number {
  if (v === '') return fallback;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Build the plan for the CMS template format. */
function planTemplate(
  wb: ExcelJS.Workbook,
  live: LiveState,
  plannedClients: Map<string, PlanRow>,
): PlanRow[] {
  const rows: PlanRow[] = [];
  // Sheet client name -> live client, including clients matched by CODE
  // whose live name is spelled differently than the sheet's. Child rows
  // (users/contracts/studies) reference clients by sheet name, so they
  // must resolve through this alias map, not just live.clients.
  const aliasToLive = new Map<string, LiveClient>();
  const resolveLive = (nameLower: string): LiveClient | undefined =>
    aliasToLive.get(nameLower) || live.clients.get(nameLower);
  const clientKnown = (nameLower: string) =>
    resolveLive(nameLower) !== undefined || plannedClients.has(nameLower);

  // -- Clients tab
  const clientsWs = wb.worksheets.find(w => normHeader(w.name) === 'clients');
  if (clientsWs) {
    for (const r of sheetRows(clientsWs)) {
      const name = pick(r, 'clientname', 'client', 'name');
      if (!name) continue;
      const key = name.toLowerCase();
      const code = pick(r, 'socccode', 'clientcode', 'code');
      const became = pick(r, 'becameclienton', 'clientsince', 'becameon', 'since');
      const becameIso = became ? toIsoDay(became) : null;
      if (became && !becameIso) {
        rows.push({ tab: 'clients', action: 'error', client: name, name, changes: [], error: `Unreadable date "${became}" — use YYYY-MM-DD.` });
        continue;
      }
      const provided: Record<string, string> = {
        relationship_manager: pick(r, 'relationshipmanager', 'rm'),
        primary_contact_name: pick(r, 'primarycontactname'),
        primary_contact_cell: pick(r, 'primarycontactcell'),
        primary_contact_email: pick(r, 'primarycontactemail'),
      };
      // Match on the stable code first, then name.
      const existing = (code && live.clientsByCode.get(code)) || live.clients.get(key);
      if (existing) aliasToLive.set(key, existing);
      if (!existing) {
        const row: PlanRow = {
          tab: 'clients',
          action: 'create',
          client: name,
          name,
          changes: [
            ...(code ? [{ field: 'code', from: '', to: code }] : []),
            { field: 'became client on', from: '', to: becameIso || '(today)' },
            ...Object.entries(provided).filter(([, v]) => v).map(([f, v]) => ({ field: f.replace(/_/g, ' '), from: '', to: v })),
          ],
          payload: {
            name,
            socc_code: code,
            became_on: becameIso || new Date().toISOString().slice(0, 10),
            ...provided,
          },
        };
        rows.push(row);
        plannedClients.set(key, row);
        continue;
      }
      // update: only provided fields
      const changes: Change[] = [];
      const merged: Record<string, unknown> = {
        name: existing.name,
        became_on: existing.becameClientOn,
        relationship_manager: existing.relationshipManager,
        primary_contact_name: existing.primaryContactName,
        primary_contact_cell: existing.primaryContactCell,
        primary_contact_email: existing.primaryContactEmail,
      };
      if (becameIso && becameIso !== existing.becameClientOn) {
        changes.push({ field: 'became client on', from: existing.becameClientOn, to: becameIso });
        merged.became_on = becameIso;
      }
      if (code && code !== existing.soccCode) {
        changes.push({ field: 'code', from: existing.soccCode || '', to: code });
        merged.socc_code = code;
      }
      const liveVals: Record<string, string> = {
        relationship_manager: existing.relationshipManager,
        primary_contact_name: existing.primaryContactName,
        primary_contact_cell: existing.primaryContactCell,
        primary_contact_email: existing.primaryContactEmail,
      };
      for (const [f, v] of Object.entries(provided)) {
        if (v && v !== liveVals[f]) {
          changes.push({ field: f.replace(/_/g, ' '), from: liveVals[f], to: v });
          merged[f] = v;
        }
      }
      rows.push(
        changes.length
          ? { tab: 'clients', action: 'update', client: name, name, changes, payload: merged, targetId: existing.id }
          : { tab: 'clients', action: 'unchanged', client: name, name, changes: [] },
      );
    }
  }

  // -- Users tab
  const usersWs = wb.worksheets.find(w => normHeader(w.name) === 'users');
  if (usersWs) {
    for (const r of sheetRows(usersWs)) {
      const clientName = pick(r, 'client', 'clientname');
      const name = pick(r, 'name', 'username', 'user');
      if (!clientName || !name) continue;
      const ckey = clientName.toLowerCase();
      if (!clientKnown(ckey)) {
        rows.push({ tab: 'users', action: 'error', client: clientName, name, changes: [], error: `Client "${clientName}" not found (add it to the Clients tab or create it first).` });
        continue;
      }
      const email = pick(r, 'email');
      const ownerLive = resolveLive(ckey);
      const existing = ownerLive?.users.get(name.toLowerCase());
      if (!existing) {
        rows.push({
          tab: 'users', action: 'create', client: clientName, name,
          changes: email ? [{ field: 'email', from: '', to: email }] : [],
          payload: { name, email },
          clientId: ownerLive?.id,
        });
      } else if (email && email !== existing.email) {
        rows.push({
          tab: 'users', action: 'update', client: clientName, name,
          changes: [{ field: 'email', from: existing.email, to: email }],
          payload: { name: existing.name, email },
          targetId: existing.id,
          clientId: ownerLive?.id,
        });
      } else {
        rows.push({ tab: 'users', action: 'unchanged', client: clientName, name, changes: [] });
      }
    }
  }

  // -- Contracts tab
  const contractsWs = wb.worksheets.find(w => normHeader(w.name) === 'contracts');
  if (contractsWs) {
    for (const r of sheetRows(contractsWs)) {
      const clientName = pick(r, 'client', 'clientname');
      const name = pick(r, 'contractname', 'name');
      if (!clientName || !name) continue;
      const ckey = clientName.toLowerCase();
      if (!clientKnown(ckey)) {
        rows.push({ tab: 'contracts', action: 'error', client: clientName, name, changes: [], error: `Client "${clientName}" not found.` });
        continue;
      }
      const occurredRaw = pick(r, 'contractdate', 'date', 'occurredon');
      const renewalRaw = pick(r, 'renewaldate', 'renewalon');
      const occurred = occurredRaw ? toIsoDay(occurredRaw) : null;
      const renewal = renewalRaw ? toIsoDay(renewalRaw) : null;
      if ((occurredRaw && !occurred) || (renewalRaw && !renewal)) {
        rows.push({ tab: 'contracts', action: 'error', client: clientName, name, changes: [], error: 'Unreadable date — use YYYY-MM-DD.' });
        continue;
      }
      const creditsRaw = pick(r, 'credits', 'creditsamount');
      const dollarsRaw = pick(r, 'dollars', 'dollarsamount');

      const liveClient = resolveLive(ckey);
      const existing = liveClient
        ? live.contracts.get(liveClient.id)?.get(name.toLowerCase())
        : undefined;

      if (!existing) {
        if (!occurred) {
          rows.push({ tab: 'contracts', action: 'error', client: clientName, name, changes: [], error: 'Contract Date is required for new contracts.' });
          continue;
        }
        rows.push({
          tab: 'contracts', action: 'create', client: clientName, name,
          changes: [
            { field: 'date', from: '', to: occurred },
            { field: 'renewal', from: '', to: renewal || `${occurred.slice(0, 4) ? '(date + 1 year)' : ''}` },
            { field: 'credits', from: '', to: creditsRaw || '0' },
            { field: 'dollars', from: '', to: dollarsRaw || '0' },
          ],
          payload: {
            name,
            socc_project_code: pick(r, 'soccprojectcode', 'projectcode'),
            occurred_on: occurred,
            renewal_on: renewal || '',
            credits_amount: String(numOr(creditsRaw, 0)),
            dollars_amount: String(numOr(dollarsRaw, 0)),
          },
        });
        continue;
      }
      const exOccurred = isoDate(existing.occurredOn as Date | string);
      const exRenewal = existing.renewalOn ? isoDate(existing.renewalOn as Date | string) : '';
      const exCredits = Number(existing.creditsAmount ?? 0);
      const exDollars = Number(existing.dollarsAmount ?? 0);
      const changes: Change[] = [];
      const merged: Record<string, unknown> = {
        name,
        occurred_on: exOccurred,
        renewal_on: exRenewal,
        credits_amount: String(exCredits),
        dollars_amount: String(exDollars),
      };
      if (occurred && occurred !== exOccurred) { changes.push({ field: 'date', from: exOccurred, to: occurred }); merged.occurred_on = occurred; }
      if (renewal && renewal !== exRenewal) { changes.push({ field: 'renewal', from: exRenewal, to: renewal }); merged.renewal_on = renewal; }
      if (creditsRaw !== '' && numOr(creditsRaw, exCredits) !== exCredits) { changes.push({ field: 'credits', from: fmtNum(exCredits), to: fmtNum(numOr(creditsRaw, exCredits)) }); merged.credits_amount = String(numOr(creditsRaw, exCredits)); }
      if (dollarsRaw !== '' && numOr(dollarsRaw, exDollars) !== exDollars) { changes.push({ field: 'dollars', from: fmtNum(exDollars), to: fmtNum(numOr(dollarsRaw, exDollars)) }); merged.dollars_amount = String(numOr(dollarsRaw, exDollars)); }
      rows.push(
        changes.length
          ? { tab: 'contracts', action: 'update', client: clientName, name, changes, payload: merged, targetId: existing.id as number }
          : { tab: 'contracts', action: 'unchanged', client: clientName, name, changes: [] },
      );
    }
  }

  // -- Studies tab
  const studiesWs = wb.worksheets.find(w => normHeader(w.name) === 'studies');
  if (studiesWs) {
    for (const r of sheetRows(studiesWs)) {
      const clientName = pick(r, 'client', 'clientname');
      const name = pick(r, 'studyname', 'name');
      if (!clientName || !name) continue;
      const ckey = clientName.toLowerCase();
      if (!clientKnown(ckey)) {
        rows.push({ tab: 'studies', action: 'error', client: clientName, name, changes: [], error: `Client "${clientName}" not found.` });
        continue;
      }
      const occurredRaw = pick(r, 'studydate', 'date', 'occurredon');
      const occurred = occurredRaw ? toIsoDay(occurredRaw) : null;
      if (occurredRaw && !occurred) {
        rows.push({ tab: 'studies', action: 'error', client: clientName, name, changes: [], error: `Unreadable date "${occurredRaw}" — use YYYY-MM-DD.` });
        continue;
      }
      const forUser = pick(r, 'foruser', 'user', 'attributedto');
      const costTypeRaw = pick(r, 'costtype').toLowerCase();
      const cadenceRaw = pick(r, 'cadence').toLowerCase();
      if (cadenceRaw && !CADENCES.has(cadenceRaw)) {
        rows.push({ tab: 'studies', action: 'error', client: clientName, name, changes: [], error: `Unknown cadence "${cadenceRaw}" — use single/weekly/monthly/quarterly.` });
        continue;
      }
      const costRaw = pick(r, 'cost');
      const setupRaw = pick(r, 'setupcost', 'setup');

      const liveClient = resolveLive(ckey);
      const existing = liveClient
        ? live.studies.get(liveClient.id)?.get(name.toLowerCase())
        : undefined;

      if (!existing) {
        const cadence = cadenceRaw || 'single';
        rows.push({
          tab: 'studies', action: 'create', client: clientName, name,
          changes: [
            { field: 'date', from: '', to: occurred || '(today)' },
            { field: 'cadence', from: '', to: cadence },
            { field: 'cost', from: '', to: `${costRaw || '0'} ${costTypeRaw || 'credits'}` },
            ...(setupRaw ? [{ field: 'setup cost', from: '', to: setupRaw }] : []),
            { field: 'for user', from: '', to: forUser || '(Unassigned)' },
          ],
          payload: {
            name,
            socc_project_code: pick(r, 'soccprojectcode', 'projectcode'),
            occurred_on: occurred || new Date().toISOString().slice(0, 10),
            cost_type: costTypeRaw === 'dollars' ? 'dollars' : 'credits',
            cadence,
            cost: String(numOr(costRaw, 0)),
            setup_cost: String(numOr(setupRaw, 0)),
          },
          ensureUser: forUser || '(Unassigned)',
        });
        continue;
      }
      // update: merge from the decorated existing study
      const exCadence = String(existing.cadence || 'single');
      const exCostType = String(existing.costType || 'credits');
      const exIsTracker = ['weekly', 'monthly', 'quarterly'].includes(exCadence);
      const exCost = exIsTracker ? Number(existing.costPerRun ?? 0) : Number(existing.costAnnual ?? 0);
      const exSetup = Number(existing.setupCost ?? 0);
      const exOccurred = isoDate(existing.occurredOn as Date | string);
      const exUserIds = (existing.userIds as number[]) || [];
      const exUserNames = ((existing.userObjs as Array<{ name: string }>) || []).map(u => u.name);

      const newCadence = cadenceRaw || exCadence;
      const newCostType = costTypeRaw ? (costTypeRaw === 'dollars' ? 'dollars' : 'credits') : exCostType;
      const newCost = costRaw !== '' ? numOr(costRaw, exCost) : exCost;
      const newSetup = setupRaw !== '' ? numOr(setupRaw, exSetup) : exSetup;
      const newOccurred = occurred || exOccurred;

      const changes: Change[] = [];
      if (newOccurred !== exOccurred) changes.push({ field: 'date', from: exOccurred, to: newOccurred });
      if (newCadence !== exCadence) changes.push({ field: 'cadence', from: exCadence, to: newCadence });
      if (newCostType !== exCostType) changes.push({ field: 'cost type', from: exCostType, to: newCostType });
      if (newCost !== exCost) changes.push({ field: 'cost', from: fmtNum(exCost), to: fmtNum(newCost) });
      if (newSetup !== exSetup) changes.push({ field: 'setup cost', from: fmtNum(exSetup), to: fmtNum(newSetup) });
      if (forUser && !exUserNames.some(n => n.toLowerCase() === forUser.toLowerCase())) {
        changes.push({ field: 'for user', from: exUserNames.join(', ') || '(none)', to: forUser });
      }
      if (!changes.length) {
        rows.push({ tab: 'studies', action: 'unchanged', client: clientName, name, changes: [] });
        continue;
      }
      rows.push({
        tab: 'studies', action: 'update', client: clientName, name, changes,
        payload: {
          name,
          occurred_on: newOccurred,
          cost_type: newCostType,
          cadence: newCadence,
          cost: String(newCost),
          setup_cost: String(newSetup),
          client_user_ids: forUser ? undefined : exUserIds,
        },
        targetId: existing.id as number,
        ensureUser: forUser || (exUserIds.length ? undefined : '(Unassigned)'),
      });
    }
  }

  return rows;
}

/** Build the plan for the SOCC export format (create-only). */
function planSocc(
  wb: ExcelJS.Workbook,
  live: LiveState,
  plannedClients: Map<string, PlanRow>,
): PlanRow[] {
  const rows: PlanRow[] = [];
  const clientsWs = wb.worksheets.find(w => normHeader(w.name) === 'clients');
  const projectsWs = wb.worksheets.find(w => normHeader(w.name) === 'projects');
  if (!clientsWs || !projectsWs) {
    throw new Error('SOCC export must contain both a Clients and a Projects tab.');
  }
  const clientsTab = sheetRows(clientsWs).filter(r => r.name && !r.deletedat);
  const projectsTab = sheetRows(projectsWs).filter(r => r.projectname && !r.deletedat);
  const contactsWs = wb.worksheets.find(w => normHeader(w.name) === 'clientcontacts');
  const contactsTab = contactsWs
    ? sheetRows(contactsWs).filter(r => !r.archived || r.archived.toUpperCase() === 'FALSE')
    : [];

  // Earliest activity + modal salesperson per tracker client UUID.
  const perClient = new Map<string, { dates: string[]; sales: Map<string, number> }>();
  for (const p of projectsTab) {
    if (!p.clientid) continue;
    const e = perClient.get(p.clientid) || {
      dates: [] as string[],
      sales: new Map<string, number>(),
    };
    for (const d of [p.launchdate, p.submitteddate, p.createdat]) {
      const day = d ? toIsoDay(d) || (d.length >= 10 ? d.slice(0, 10) : null) : null;
      if (day) e.dates.push(day);
    }
    if (p.salesperson) e.sales.set(p.salesperson, (e.sales.get(p.salesperson) || 0) + 1);
    perClient.set(p.clientid, e);
  }

  const nameByUuid = new Map<string, string>();
  // Sheet client name -> live client (covers code-matched clients whose
  // live name differs from the sheet spelling).
  const aliasToLive = new Map<string, LiveClient>();
  const resolveLive = (nameLower: string): LiveClient | undefined =>
    aliasToLive.get(nameLower) || live.clients.get(nameLower);
  for (const c of clientsTab) {
    nameByUuid.set(c.id, c.name);
    const key = c.name.toLowerCase();
    const code = (c.code || '').trim();
    // Match on the stable Cl##### code first, then fall back to name.
    // The code match is what stops a re-spelled client (GoldenTree vs
    // Goldentree) from creating a duplicate.
    const existing = (code && live.clientsByCode.get(code)) || live.clients.get(key);
    if (existing) {
      aliasToLive.set(key, existing);
      rows.push({ tab: 'clients', action: 'unchanged', client: c.name, name: c.name, changes: [] });
      continue;
    }
    const meta = perClient.get(c.id);
    const became = (meta && meta.dates.sort()[0]) || (c.createdat ? c.createdat.slice(0, 10) : new Date().toISOString().slice(0, 10));
    const rm = meta ? [...meta.sales.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '' : '';
    const row: PlanRow = {
      tab: 'clients', action: 'create', client: c.name, name: c.name,
      changes: [
        ...(code ? [{ field: 'code', from: '', to: code }] : []),
        { field: 'became client on', from: '', to: became },
        ...(rm ? [{ field: 'relationship manager', from: '', to: rm }] : []),
      ],
      payload: { name: c.name, socc_code: code, became_on: became, relationship_manager: rm },
    };
    rows.push(row);
    plannedClients.set(key, row);
  }

  for (const ct of contactsTab) {
    const clientName = nameByUuid.get(ct.clientid);
    if (!clientName) continue;
    const name = [ct.firstname, ct.lastname].filter(Boolean).join(' ').trim();
    if (!name) continue;
    const liveClient = resolveLive(clientName.toLowerCase());
    if (liveClient?.users.has(name.toLowerCase())) {
      rows.push({ tab: 'users', action: 'unchanged', client: clientName, name, changes: [] });
    } else {
      rows.push({
        tab: 'users', action: 'create', client: clientName, name,
        changes: ct.email ? [{ field: 'email', from: '', to: ct.email }] : [],
        payload: { name, email: ct.email || '' },
        clientId: liveClient?.id,
      });
    }
  }

  const seenPerClient = new Map<string, Set<string>>();
  for (const p of projectsTab) {
    const clientName = nameByUuid.get(p.clientid);
    if (!clientName) {
      rows.push({ tab: 'studies', action: 'error', client: p.client || '(unknown)', name: p.projectname, changes: [], error: 'Project references a client missing from the Clients tab.' });
      continue;
    }
    const ckey = clientName.toLowerCase();
    const nameKey = p.projectname.toLowerCase();
    const seen = seenPerClient.get(ckey) || new Set();
    const liveClient = resolveLive(ckey);
    const exists =
      seen.has(nameKey) ||
      (liveClient ? live.studies.get(liveClient.id)?.has(nameKey) : false);
    seen.add(nameKey);
    seenPerClient.set(ckey, seen);
    if (exists) {
      rows.push({ tab: 'studies', action: 'unchanged', client: clientName, name: p.projectname, changes: [] });
      continue;
    }
    const occurred =
      (p.launchdate && p.launchdate.slice(0, 10)) ||
      (p.submitteddate && p.submitteddate.slice(0, 10)) ||
      (p.createdat && p.createdat.slice(0, 10)) ||
      new Date().toISOString().slice(0, 10);
    const attributee = (p.requestedbyname || '').trim() || '(Unassigned)';
    rows.push({
      tab: 'studies', action: 'create', client: clientName, name: p.projectname,
      changes: [
        { field: 'date', from: '', to: occurred },
        { field: 'cost', from: '', to: '0 credits (price via bulk edit)' },
        { field: 'for user', from: '', to: attributee },
      ],
      payload: {
        name: p.projectname,
        socc_project_code: (p.projectcode || '').trim(),
        occurred_on: occurred,
        cost_type: 'credits',
        cadence: 'single',
        cost: '0',
        setup_cost: '0',
      },
      ensureUser: attributee,
      clientId: liveClient?.id,
    });
  }

  return rows;
}

// ------------------------------------------------------------------ public

export async function buildPlan(
  api: ApiClient,
  fileName: string,
  data: ArrayBuffer,
): Promise<ImportPlan> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);

  const tabNames = new Set(wb.worksheets.map(w => normHeader(w.name)));
  let format: ImportPlan['format'];
  if (tabNames.has('projects') && tabNames.has('clients')) format = 'socc';
  else if (['clients', 'users', 'contracts', 'studies'].some(t => tabNames.has(t))) format = 'template';
  else {
    throw new Error(
      'Unrecognized workbook: expected either a SOCC export (Projects + Clients tabs) or the CMS template (Clients / Users / Contracts / Studies tabs). Download the blank template for the expected layout.',
    );
  }

  // Which client names does the sheet reference? (bounds live-state fetch)
  const referenced = new Set<string>();
  for (const ws of wb.worksheets) {
    const t = normHeader(ws.name);
    if (format === 'socc') {
      if (t === 'clients') for (const r of sheetRows(ws)) if (r.name) referenced.add(r.name.toLowerCase());
    } else if (['clients', 'users', 'contracts', 'studies'].includes(t)) {
      for (const r of sheetRows(ws)) {
        const n = pick(r, 'client', 'clientname', 'name');
        if (n) referenced.add(n.toLowerCase());
      }
    }
  }

  const live = await fetchLiveState(api, referenced);
  const plannedClients = new Map<string, PlanRow>();
  const rows = format === 'socc' ? planSocc(wb, live, plannedClients) : planTemplate(wb, live, plannedClients);

  const counts: Record<RowAction, number> = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of rows) counts[r.action] += 1;
  return { format, fileName, rows, counts };
}

export async function applyPlan(api: ApiClient, plan: ImportPlan): Promise<ApplyResult> {
  const results: ApplyRowResult[] = [];
  // Fresh name -> id map (state may have moved since preview).
  const current = (await api.listClients()) as unknown as Array<{ id: number; name: string }>;
  const clientIds = new Map(current.map(c => [c.name.toLowerCase(), c.id]));
  const userIdCache = new Map<number, Map<string, number>>();

  async function ensureUser(clientId: number, name: string): Promise<number> {
    let users = userIdCache.get(clientId);
    if (!users) {
      const us = (await api.listClientUsers(clientId)) as unknown as Array<{ id: number; name: string }>;
      users = new Map(us.map(u => [u.name.toLowerCase(), u.id]));
      userIdCache.set(clientId, users);
    }
    const key = name.toLowerCase();
    const hit = users.get(key);
    if (hit) return hit;
    const u = (await api.createClientUser(clientId, { name, email: '' })) as unknown as { id: number };
    users.set(key, u.id);
    return u.id;
  }

  const order: ImportTab[] = ['clients', 'users', 'contracts', 'studies'];
  for (const tab of order) {
    for (const row of plan.rows) {
      if (row.tab !== tab || (row.action !== 'create' && row.action !== 'update')) continue;
      try {
        // Prefer the id resolved at plan time (covers clients matched by
        // code whose live name differs from the sheet's spelling).
        const clientId = row.clientId ?? clientIds.get(row.client.toLowerCase());
        if (tab === 'clients') {
          if (row.action === 'create') {
            if (clientId) {
              results.push({ ...rowKey(row), ok: true, message: 'Already existed — skipped.' });
              continue;
            }
            const made = (await api.createClient(row.payload!)) as unknown as { id: number };
            clientIds.set(row.client.toLowerCase(), made.id);
          } else {
            await api.updateClient(row.targetId!, row.payload!);
          }
        } else {
          if (!clientId) throw new Error(`Client "${row.client}" does not exist.`);
          if (tab === 'users') {
            if (row.action === 'create') await api.createClientUser(clientId, row.payload!);
            else await api.updateClientUser(row.targetId!, row.payload!);
          } else if (tab === 'contracts') {
            const body = { ...row.payload! };
            if (row.action === 'create') await api.createContract({ client_id: clientId, ...body });
            else await api.updateContract(row.targetId!, body);
          } else {
            const body = { ...row.payload! } as Record<string, unknown>;
            if (row.ensureUser) body.client_user_ids = [await ensureUser(clientId, row.ensureUser)];
            if (row.action === 'create') await api.createStudy({ client_id: clientId, ...body });
            else await api.updateStudy(row.targetId!, body);
          }
        }
        results.push({ ...rowKey(row), ok: true, message: row.action === 'create' ? 'Created.' : 'Updated.' });
      } catch (e) {
        results.push({
          ...rowKey(row),
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return {
    applied: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    rows: results,
  };
}

function rowKey(row: PlanRow): Pick<ApplyRowResult, 'tab' | 'client' | 'name' | 'action'> {
  return { tab: row.tab, client: row.client, name: row.name, action: row.action };
}
