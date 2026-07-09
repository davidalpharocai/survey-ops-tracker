// Vitest suite for lib/importer.ts (buildPlan / applyPlan).
//
// Workbooks are built in-memory with exceljs; the ApiClient is an
// in-memory mock backed by plain arrays that records every call.
// Assertions follow what the importer actually does today — where the
// behavior looks questionable it is called out with a comment.

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { applyPlan, buildPlan, type ImportPlan } from '../importer';
import type { ApiClient } from '../api';

// ------------------------------------------------------------ workbook helper

type Cell = string | number | null;

async function makeWorkbook(
  tabs: Array<{ name: string; rows: Cell[][] }>,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const t of tabs) {
    const ws = wb.addWorksheet(t.name);
    for (const r of t.rows) ws.addRow(r);
  }
  const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// Template-format headers (normalised by the importer to lowercase alnum).
const CLIENT_HEADERS: Cell[] = [
  'Client Name', 'SOCC Code', 'Became Client On', 'Relationship Manager',
  'Primary Contact Name', 'Primary Contact Cell', 'Primary Contact Email',
];
const USER_HEADERS: Cell[] = ['Client', 'Name', 'Email'];
const CONTRACT_HEADERS: Cell[] = [
  'Client', 'Contract Name', 'Contract Date', 'Renewal Date', 'Credits', 'Dollars',
  'SOCC Project Code',
];
const STUDY_HEADERS: Cell[] = [
  'Client', 'Study Name', 'Study Date', 'For User', 'Cost Type', 'Cadence', 'Cost',
  'Setup Cost', 'Project Code',
];

// SOCC-export headers.
const SOCC_CLIENT_HEADERS: Cell[] = ['ID', 'Name', 'Code', 'Created At', 'Deleted At'];
const SOCC_PROJECT_HEADERS: Cell[] = [
  'Project Name', 'Project Code', 'Client ID', 'Client', 'Salesperson',
  'Requested By Name', 'Launch Date', 'Submitted Date', 'Created At', 'Deleted At',
];
const SOCC_CONTACT_HEADERS: Cell[] = ['Client ID', 'First Name', 'Last Name', 'Email', 'Archived'];

// ----------------------------------------------------------------- API mock

type Rec = Record<string, unknown>;

interface SeedUser { id: number; name: string; email?: string }
interface SeedClient {
  id: number; name: string; soccCode?: string; becameClientOn?: string;
  relationshipManager?: string; primaryContactName?: string;
  primaryContactCell?: string; primaryContactEmail?: string; users?: SeedUser[];
}
interface SeedContract {
  id: number; client: string; name: string; occurredOn: string; renewalOn?: string;
  creditsAmount?: number; dollarsAmount?: number;
}
interface SeedStudy {
  id: number; client: string; name: string; occurredOn: string;
  cadence?: string; costType?: string; costPerRun?: number; costAnnual?: number;
  setupCost?: number; userIds?: number[]; userObjs?: Array<{ id: number; name: string }>;
}
interface Seed { clients?: SeedClient[]; contracts?: SeedContract[]; studies?: SeedStudy[] }

function makeApi(seed: Seed = {}) {
  let nextId = 1000;
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const failures = new Map<string, (args: unknown[]) => boolean>();

  const clients = (seed.clients ?? []).map(c => ({
    id: c.id,
    name: c.name,
    soccCode: c.soccCode ?? '',
    becameClientOn: c.becameClientOn ?? '2024-01-01',
    relationshipManager: c.relationshipManager ?? '',
    primaryContactName: c.primaryContactName ?? '',
    primaryContactCell: c.primaryContactCell ?? '',
    primaryContactEmail: c.primaryContactEmail ?? '',
    users: (c.users ?? []).map(u => ({ id: u.id, name: u.name, email: u.email ?? '' })),
  }));
  const byName = (name: string) => {
    const c = clients.find(x => x.name === name);
    if (!c) throw new Error(`seed references unknown client "${name}"`);
    return c;
  };
  const contracts = (seed.contracts ?? []).map(t => ({
    id: t.id, clientId: byName(t.client).id, name: t.name,
    occurredOn: t.occurredOn, renewalOn: t.renewalOn ?? null,
    creditsAmount: t.creditsAmount ?? 0, dollarsAmount: t.dollarsAmount ?? 0,
  }));
  const studies = (seed.studies ?? []).map(t => ({
    id: t.id, clientId: byName(t.client).id, name: t.name,
    occurredOn: t.occurredOn, cadence: t.cadence ?? 'single',
    costType: t.costType ?? 'credits', costPerRun: t.costPerRun ?? 0,
    costAnnual: t.costAnnual ?? 0, setupCost: t.setupCost ?? 0,
    userIds: t.userIds ?? [], userObjs: t.userObjs ?? [],
  }));

  function record(method: string, args: unknown[]) {
    calls.push({ method, args });
    const fail = failures.get(method);
    if (fail && fail(args)) throw new Error(`mock failure: ${method}`);
  }

  const impl = {
    async listClients() {
      record('listClients', []);
      return clients.map(c => ({ id: c.id, name: c.name }));
    },
    async listClientsWithUsers() {
      record('listClientsWithUsers', []);
      return clients.map(c => ({ ...c, users: c.users.map(u => ({ ...u })) }));
    },
    async listContractsByClient(clientId: number) {
      record('listContractsByClient', [clientId]);
      return contracts.filter(t => t.clientId === clientId).map(t => ({ ...t }));
    },
    async listStudiesByClient(clientId: number) {
      record('listStudiesByClient', [clientId]);
      return studies.filter(t => t.clientId === clientId).map(t => ({ ...t }));
    },
    async listClientUsers(clientId: number) {
      record('listClientUsers', [clientId]);
      const c = clients.find(x => x.id === clientId);
      return (c ? c.users : []).map(u => ({ ...u }));
    },
    async createClient(d: Rec) {
      record('createClient', [d]);
      const made = {
        id: nextId++,
        name: String(d.name),
        soccCode: String(d.socc_code ?? ''),
        becameClientOn: String(d.became_on ?? ''),
        relationshipManager: String(d.relationship_manager ?? ''),
        primaryContactName: String(d.primary_contact_name ?? ''),
        primaryContactCell: String(d.primary_contact_cell ?? ''),
        primaryContactEmail: String(d.primary_contact_email ?? ''),
        users: [] as Array<{ id: number; name: string; email: string }>,
      };
      clients.push(made);
      return { id: made.id, name: made.name };
    },
    async updateClient(id: number, d: Rec) { record('updateClient', [id, d]); return { id }; },
    async createClientUser(clientId: number, d: Rec) {
      record('createClientUser', [clientId, d]);
      const c = clients.find(x => x.id === clientId);
      const u = { id: nextId++, name: String(d.name), email: String(d.email ?? '') };
      c?.users.push(u);
      return { ...u, clientId };
    },
    async updateClientUser(id: number, d: Rec) { record('updateClientUser', [id, d]); return { id }; },
    async createContract(d: Rec) {
      record('createContract', [d]);
      const t = {
        id: nextId++, clientId: d.client_id as number, name: String(d.name),
        occurredOn: String(d.occurred_on ?? ''), renewalOn: (d.renewal_on as string) || null,
        creditsAmount: Number(d.credits_amount ?? 0), dollarsAmount: Number(d.dollars_amount ?? 0),
      };
      contracts.push(t);
      return { id: t.id };
    },
    async updateContract(id: number, d: Rec) { record('updateContract', [id, d]); return { id }; },
    async createStudy(d: Rec) {
      record('createStudy', [d]);
      const t = {
        id: nextId++, clientId: d.client_id as number, name: String(d.name),
        occurredOn: String(d.occurred_on ?? ''), cadence: String(d.cadence ?? 'single'),
        costType: String(d.cost_type ?? 'credits'), costPerRun: 0, costAnnual: 0,
        setupCost: Number(d.setup_cost ?? 0),
        userIds: (d.client_user_ids as number[]) ?? [], userObjs: [],
      };
      studies.push(t);
      return { id: t.id };
    },
    async updateStudy(id: number, d: Rec) { record('updateStudy', [id, d]); return { id }; },
  };

  return {
    api: impl as unknown as ApiClient,
    calls,
    state: { clients, contracts, studies },
    callsTo: (method: string) => calls.filter(c => c.method === method),
    failOn(method: string, pred: (args: unknown[]) => boolean = () => true) {
      failures.set(method, pred);
    },
  };
}

// ---------------------------------------------------------------- utilities

function findRow(plan: ImportPlan, tab: string, name: string) {
  const row = plan.rows.find(r => r.tab === tab && r.name === name);
  if (!row) {
    throw new Error(
      `no plan row for ${tab}/${name}; have: ${plan.rows.map(r => `${r.tab}/${r.name}`).join(', ')}`,
    );
  }
  return row;
}

const GOLDENTREE: SeedClient = {
  id: 1, name: 'Goldentree', soccCode: 'Cl00042', becameClientOn: '2024-05-01',
  relationshipManager: 'Alex',
  users: [{ id: 11, name: 'Jane Doe', email: 'jane@x.com' }],
};

// =========================================================== format detection

describe('format detection', () => {
  it('detects the SOCC export from Projects + Clients tabs', async () => {
    const wb = await makeWorkbook([
      { name: 'Projects', rows: [SOCC_PROJECT_HEADERS] },
      { name: 'Clients', rows: [SOCC_CLIENT_HEADERS] },
    ]);
    const m = makeApi();
    const plan = await buildPlan(m.api, 'socc.xlsx', wb);
    expect(plan.format).toBe('socc');
    expect(plan.fileName).toBe('socc.xlsx');
    expect(plan.rows).toEqual([]);
  });

  it('detects the CMS template from any of Clients/Users/Contracts/Studies tabs', async () => {
    const wb = await makeWorkbook([{ name: 'Studies', rows: [STUDY_HEADERS] }]);
    const plan = await buildPlan(makeApi().api, 't.xlsx', wb);
    expect(plan.format).toBe('template');
  });

  it('throws a helpful error for an unrecognized workbook', async () => {
    const wb = await makeWorkbook([{ name: 'Random Stuff', rows: [['a', 'b']] }]);
    await expect(buildPlan(makeApi().api, 'x.xlsx', wb)).rejects.toThrow(
      /Unrecognized workbook.*SOCC export.*template/,
    );
  });
});

// =========================================================== template: creates

describe('template creates', () => {
  it('plans a new client with code, became date and relationship manager', async () => {
    const wb = await makeWorkbook([{
      name: 'Clients',
      rows: [
        CLIENT_HEADERS,
        ['NewCo', 'Cl00100', '2026-01-01', 'Alex', 'Pat Smith', '555-1234', 'pat@newco.com'],
      ],
    }]);
    const plan = await buildPlan(makeApi().api, 't.xlsx', wb);
    expect(plan.counts).toEqual({ create: 1, update: 0, unchanged: 0, error: 0 });
    const row = findRow(plan, 'clients', 'NewCo');
    expect(row.action).toBe('create');
    expect(row.payload).toEqual({
      name: 'NewCo',
      socc_code: 'Cl00100',
      became_on: '2026-01-01',
      relationship_manager: 'Alex',
      primary_contact_name: 'Pat Smith',
      primary_contact_cell: '555-1234',
      primary_contact_email: 'pat@newco.com',
    });
    expect(row.changes).toEqual([
      { field: 'code', from: '', to: 'Cl00100' },
      { field: 'became client on', from: '', to: '2026-01-01' },
      { field: 'relationship manager', from: '', to: 'Alex' },
      { field: 'primary contact name', from: '', to: 'Pat Smith' },
      { field: 'primary contact cell', from: '', to: '555-1234' },
      { field: 'primary contact email', from: '', to: 'pat@newco.com' },
    ]);
  });

  it('plans a new user under an existing client', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Users',
      rows: [USER_HEADERS, ['Goldentree', 'Sam Roe', 'sam@x.com']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'users', 'Sam Roe');
    expect(row.action).toBe('create');
    expect(row.payload).toEqual({ name: 'Sam Roe', email: 'sam@x.com' });
    expect(row.changes).toEqual([{ field: 'email', from: '', to: 'sam@x.com' }]);
  });

  it('plans a new contract: default renewal note, money strings parsed from "$1,500"/"1,500"', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Contracts',
      rows: [
        CONTRACT_HEADERS,
        ['Goldentree', '2026 Retainer', '2026-01-15', '', '$1,500', '1,500', 'PR00007'],
      ],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'contracts', '2026 Retainer');
    expect(row.action).toBe('create');
    // Money-ish cells are parsed ($ and , stripped) into string amounts.
    expect(row.payload).toEqual({
      name: '2026 Retainer',
      socc_project_code: 'PR00007',
      occurred_on: '2026-01-15',
      renewal_on: '',
      credits_amount: '1500',
      dollars_amount: '1500',
    });
    // Change list shows the raw sheet strings and the "(date + 1 year)"
    // default-renewal note. (The `occurred.slice(0, 4) ? ... : ''` ternary in
    // importer.ts is always truthy for a valid date — dead conditional.)
    expect(row.changes).toEqual([
      { field: 'date', from: '', to: '2026-01-15' },
      { field: 'renewal', from: '', to: '(date + 1 year)' },
      { field: 'credits', from: '', to: '$1,500' },
      { field: 'dollars', from: '', to: '1,500' },
    ]);
  });

  it('plans a new study with cadence, costs, project code and ensureUser attribution', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Studies',
      rows: [
        STUDY_HEADERS,
        ['Goldentree', 'Kickoff', '2026-02-01', 'Sam', 'dollars', 'monthly', '250', '50', 'PR00042'],
      ],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'studies', 'Kickoff');
    expect(row.action).toBe('create');
    expect(row.payload).toEqual({
      name: 'Kickoff',
      socc_project_code: 'PR00042',
      occurred_on: '2026-02-01',
      cost_type: 'dollars',
      cadence: 'monthly',
      cost: '250',
      setup_cost: '50',
    });
    expect(row.ensureUser).toBe('Sam');
    expect(row.changes).toEqual([
      { field: 'date', from: '', to: '2026-02-01' },
      { field: 'cadence', from: '', to: 'monthly' },
      { field: 'cost', from: '', to: '250 dollars' },
      { field: 'setup cost', from: '', to: '50' },
      { field: 'for user', from: '', to: 'Sam' },
    ]);
  });

  it('defaults a new study to single cadence / credits / (Unassigned)', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Studies',
      rows: [STUDY_HEADERS, ['Goldentree', 'Bare Study', '', '', '', '', '', '', '']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'studies', 'Bare Study');
    expect(row.action).toBe('create');
    expect(row.payload).toMatchObject({ cadence: 'single', cost_type: 'credits', cost: '0', setup_cost: '0' });
    expect(row.ensureUser).toBe('(Unassigned)');
  });
});

// =========================================================== template: updates

describe('template updates', () => {
  it('updates a client matched by name with only the changed field (RM)', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Clients',
      rows: [CLIENT_HEADERS, ['Goldentree', '', '', 'Jenna', '', '', '']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'clients', 'Goldentree');
    expect(row.action).toBe('update');
    expect(row.targetId).toBe(1);
    expect(row.changes).toEqual([{ field: 'relationship manager', from: 'Alex', to: 'Jenna' }]);
    // Merged payload keeps every live value the sheet left empty.
    expect(row.payload).toEqual({
      name: 'Goldentree',
      became_on: '2024-05-01',
      relationship_manager: 'Jenna',
      primary_contact_name: '',
      primary_contact_cell: '',
      primary_contact_email: '',
    });
  });

  it('matches by socc_code first: a re-spelled name is unchanged, not a duplicate create', async () => {
    // THE key regression: "GOLDEN TREE" vs live "Goldentree" but same Cl code.
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Clients',
      rows: [CLIENT_HEADERS, ['GOLDEN TREE', 'Cl00042', '', '', '', '', '']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    expect(plan.counts.create).toBe(0);
    const row = findRow(plan, 'clients', 'GOLDEN TREE');
    expect(row.action).toBe('unchanged');
  });

  it('code-matched re-spelled client with a changed field becomes an update of the existing record', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Clients',
      rows: [CLIENT_HEADERS, ['GOLDEN TREE', 'Cl00042', '', 'Jenna', '', '', '']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    expect(plan.counts).toMatchObject({ create: 0, update: 1 });
    const row = findRow(plan, 'clients', 'GOLDEN TREE');
    expect(row.action).toBe('update');
    expect(row.targetId).toBe(1);
    expect(row.changes).toEqual([{ field: 'relationship manager', from: 'Alex', to: 'Jenna' }]);
    // The import never renames: merged payload keeps the live spelling.
    expect(row.payload).toMatchObject({ name: 'Goldentree' });
  });

  it('child rows under a code-matched re-spelled client resolve to the live client', async () => {
    // The code-first client match extends to child tabs via the plan's
    // alias map: a Users/Contracts/Studies row referencing the sheet's
    // spelling resolves to the code-matched live client (and carries its
    // id for apply), instead of erroring or duplicating.
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([
      { name: 'Clients', rows: [CLIENT_HEADERS, ['GOLDEN TREE', 'Cl00042', '', '', '', '', '']] },
      { name: 'Users', rows: [USER_HEADERS, ['GOLDEN TREE', 'New User', 'nu@x.com']] },
    ]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    expect(findRow(plan, 'clients', 'GOLDEN TREE').action).toBe('unchanged');
    const user = findRow(plan, 'users', 'New User');
    expect(user.action).toBe('create');
    expect(user.clientId).toBe(GOLDENTREE.id);
  });

  it('never overwrites with empty cells: a Client+Cost-only study row updates cost and keeps the rest', async () => {
    const m = makeApi({
      clients: [GOLDENTREE],
      studies: [{
        id: 21, client: 'Goldentree', name: 'Brand Tracker', occurredOn: '2025-01-01',
        cadence: 'monthly', costType: 'credits', costPerRun: 10, costAnnual: 120,
        setupCost: 5, userIds: [11], userObjs: [{ id: 11, name: 'Jane Doe' }],
      }],
    });
    const wb = await makeWorkbook([{
      name: 'Studies',
      rows: [STUDY_HEADERS, ['Goldentree', 'Brand Tracker', '', '', '', '', '12', '', '']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'studies', 'Brand Tracker');
    expect(row.action).toBe('update');
    expect(row.targetId).toBe(21);
    expect(row.changes).toEqual([{ field: 'cost', from: '10', to: '12' }]);
    // Date, cadence, cost type, setup and user attribution all preserved.
    expect(row.payload).toEqual({
      name: 'Brand Tracker',
      occurred_on: '2025-01-01',
      cost_type: 'credits',
      cadence: 'monthly',
      cost: '12',
      setup_cost: '5',
      client_user_ids: [11],
    });
    expect(row.ensureUser).toBeUndefined();
  });

  it('updates a user email matched within its client', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Users',
      rows: [USER_HEADERS, ['Goldentree', 'Jane Doe', 'jane@new.com']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'users', 'Jane Doe');
    expect(row.action).toBe('update');
    expect(row.targetId).toBe(11);
    expect(row.changes).toEqual([{ field: 'email', from: 'jane@x.com', to: 'jane@new.com' }]);
    expect(row.payload).toEqual({ name: 'Jane Doe', email: 'jane@new.com' });
  });

  it('updates only the changed contract money field, keeping dates from live state', async () => {
    const m = makeApi({
      clients: [GOLDENTREE],
      contracts: [{
        id: 31, client: 'Goldentree', name: '2025 Contract', occurredOn: '2025-01-01',
        renewalOn: '2026-01-01', creditsAmount: 100, dollarsAmount: 0,
      }],
    });
    const wb = await makeWorkbook([{
      name: 'Contracts',
      rows: [CONTRACT_HEADERS, ['Goldentree', '2025 Contract', '', '', '$250', '', '']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'contracts', '2025 Contract');
    expect(row.action).toBe('update');
    expect(row.targetId).toBe(31);
    expect(row.changes).toEqual([{ field: 'credits', from: '100', to: '250' }]);
    expect(row.payload).toEqual({
      name: '2025 Contract',
      occurred_on: '2025-01-01',
      renewal_on: '2026-01-01',
      credits_amount: '250',
      dollars_amount: '0',
    });
  });

  it('treats formatted money equal to the live number as unchanged ("$1,500" == 1500)', async () => {
    const m = makeApi({
      clients: [GOLDENTREE],
      contracts: [{
        id: 32, client: 'Goldentree', name: 'Big Contract', occurredOn: '2025-03-01',
        renewalOn: '2026-03-01', creditsAmount: 1500, dollarsAmount: 1500,
      }],
    });
    const wb = await makeWorkbook([{
      name: 'Contracts',
      rows: [CONTRACT_HEADERS, ['Goldentree', 'Big Contract', '2025-03-01', '2026-03-01', '$1,500', '1,500', '']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    expect(findRow(plan, 'contracts', 'Big Contract').action).toBe('unchanged');
  });

  it('re-importing an identical file yields all-unchanged rows', async () => {
    const m = makeApi({
      clients: [GOLDENTREE],
      contracts: [{
        id: 31, client: 'Goldentree', name: '2025 Contract', occurredOn: '2025-01-01',
        renewalOn: '2026-01-01', creditsAmount: 100, dollarsAmount: 0,
      }],
      studies: [{
        id: 21, client: 'Goldentree', name: 'Brand Tracker', occurredOn: '2025-01-01',
        cadence: 'monthly', costType: 'credits', costPerRun: 10, costAnnual: 120,
        setupCost: 5, userIds: [11], userObjs: [{ id: 11, name: 'Jane Doe' }],
      }],
    });
    const wb = await makeWorkbook([
      { name: 'Clients', rows: [CLIENT_HEADERS, ['Goldentree', 'Cl00042', '2024-05-01', 'Alex', '', '', '']] },
      { name: 'Users', rows: [USER_HEADERS, ['Goldentree', 'Jane Doe', 'jane@x.com']] },
      { name: 'Contracts', rows: [CONTRACT_HEADERS, ['Goldentree', '2025 Contract', '2025-01-01', '2026-01-01', 100, 0, '']] },
      { name: 'Studies', rows: [STUDY_HEADERS, ['Goldentree', 'Brand Tracker', '2025-01-01', 'Jane Doe', 'credits', 'monthly', 10, 5, '']] },
    ]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    expect(plan.counts).toEqual({ create: 0, update: 0, unchanged: 4, error: 0 });
    expect(plan.rows.every(r => r.action === 'unchanged')).toBe(true);
  });

  it('flags child rows for an unknown client as errors', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([
      { name: 'Users', rows: [USER_HEADERS, ['Nobody Inc', 'A Person', 'a@b.com']] },
      { name: 'Contracts', rows: [CONTRACT_HEADERS, ['Nobody Inc', 'Some Deal', '2026-01-01', '', '10', '', '']] },
      { name: 'Studies', rows: [STUDY_HEADERS, ['Nobody Inc', 'Some Study', '', '', '', '', '', '', '']] },
    ]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    expect(plan.counts).toEqual({ create: 0, update: 0, unchanged: 0, error: 3 });
    expect(findRow(plan, 'users', 'A Person').error).toMatch(/Client "Nobody Inc" not found/);
    expect(findRow(plan, 'contracts', 'Some Deal').error).toMatch(/not found/);
    expect(findRow(plan, 'studies', 'Some Study').error).toMatch(/not found/);
  });

  it('accepts child rows for a client created on the Clients tab of the same file', async () => {
    const m = makeApi();
    const wb = await makeWorkbook([
      { name: 'Clients', rows: [CLIENT_HEADERS, ['NewCo', '', '2026-01-01', '', '', '', '']] },
      { name: 'Users', rows: [USER_HEADERS, ['NewCo', 'Sam', 'sam@newco.com']] },
    ]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    expect(plan.counts).toEqual({ create: 2, update: 0, unchanged: 0, error: 0 });
    expect(findRow(plan, 'users', 'Sam').action).toBe('create');
  });
});

// ======================================================= template: validation

describe('template validation errors', () => {
  it('requires a Contract Date for new contracts', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Contracts',
      rows: [CONTRACT_HEADERS, ['Goldentree', 'No Date Deal', '', '', '50', '', '']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'contracts', 'No Date Deal');
    expect(row.action).toBe('error');
    expect(row.error).toMatch(/Contract Date is required/);
  });

  it('rejects an unknown cadence', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Studies',
      rows: [STUDY_HEADERS, ['Goldentree', 'Odd Study', '', '', '', 'yearly', '', '', '']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'studies', 'Odd Study');
    expect(row.action).toBe('error');
    expect(row.error).toMatch(/Unknown cadence "yearly"/);
  });

  it('rejects a garbage contract date', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([{
      name: 'Contracts',
      rows: [CONTRACT_HEADERS, ['Goldentree', 'Bad Date Deal', 'sometime soon', '', '', '', '']],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    const row = findRow(plan, 'contracts', 'Bad Date Deal');
    expect(row.action).toBe('error');
    expect(row.error).toMatch(/Unreadable date/);
  });
});

// ==================================================================== dates

describe('date parsing', () => {
  it('accepts both "2026-07-08" and "7/8/2026" and rejects garbage', async () => {
    const m = makeApi();
    const wb = await makeWorkbook([{
      name: 'Clients',
      rows: [
        CLIENT_HEADERS,
        ['A Corp', '', '2026-07-08', '', '', '', ''],
        ['B Corp', '', '7/8/2026', '', '', '', ''],
        ['C Corp', '', 'next tuesday', '', '', '', ''],
      ],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    expect(plan.counts).toEqual({ create: 2, update: 0, unchanged: 0, error: 1 });
    expect(findRow(plan, 'clients', 'A Corp').payload).toMatchObject({ became_on: '2026-07-08' });
    expect(findRow(plan, 'clients', 'B Corp').payload).toMatchObject({ became_on: '2026-07-08' });
    const bad = findRow(plan, 'clients', 'C Corp');
    expect(bad.action).toBe('error');
    expect(bad.error).toMatch(/Unreadable date "next tuesday"/);
  });
});

// ==================================================================== SOCC

function soccTabs(opts: {
  clients?: Cell[][];
  projects?: Cell[][];
  contacts?: Cell[][];
}): Array<{ name: string; rows: Cell[][] }> {
  const tabs = [
    { name: 'Clients', rows: [SOCC_CLIENT_HEADERS, ...(opts.clients ?? [])] },
    { name: 'Projects', rows: [SOCC_PROJECT_HEADERS, ...(opts.projects ?? [])] },
  ];
  if (opts.contacts) {
    tabs.push({ name: 'Client Contacts', rows: [SOCC_CONTACT_HEADERS, ...opts.contacts] });
  }
  return tabs;
}

describe('SOCC export (create-only)', () => {
  it('marks an existing client unchanged — never an update', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook(soccTabs({
      clients: [['uuid-1', 'Goldentree', 'Cl00042', '2024-01-01', '']],
    }));
    const plan = await buildPlan(m.api, 's.xlsx', wb);
    const row = findRow(plan, 'clients', 'Goldentree');
    expect(row.action).toBe('unchanged');
    expect(plan.counts.update).toBe(0);
  });

  it('marks an existing study unchanged — matched rows are never touched', async () => {
    const m = makeApi({
      clients: [GOLDENTREE],
      studies: [{ id: 21, client: 'Goldentree', name: 'Brand Tracker', occurredOn: '2025-01-01' }],
    });
    const wb = await makeWorkbook(soccTabs({
      clients: [['uuid-1', 'Goldentree', 'Cl00042', '2024-01-01', '']],
      projects: [['Brand Tracker', 'PR00001', 'uuid-1', 'Goldentree', 'Alex', 'Jane Doe', '2026-05-01', '', '2026-04-01', '']],
    }));
    const plan = await buildPlan(m.api, 's.xlsx', wb);
    expect(findRow(plan, 'studies', 'Brand Tracker').action).toBe('unchanged');
    expect(plan.counts).toMatchObject({ create: 0, update: 0 });
  });

  it('creates a 0-cost study for a new project, carrying the project code', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook(soccTabs({
      clients: [['uuid-1', 'Goldentree', 'Cl00042', '2024-01-01', '']],
      projects: [['New Pulse Survey', 'PR00123', 'uuid-1', 'Goldentree', 'Alex', 'Sam Roe', '2026-03-01', '2026-02-15', '2026-02-01', '']],
    }));
    const plan = await buildPlan(m.api, 's.xlsx', wb);
    const row = findRow(plan, 'studies', 'New Pulse Survey');
    expect(row.action).toBe('create');
    expect(row.payload).toEqual({
      name: 'New Pulse Survey',
      socc_project_code: 'PR00123',
      occurred_on: '2026-03-01', // launch date wins
      cost_type: 'credits',
      cadence: 'single',
      cost: '0',
      setup_cost: '0',
    });
    expect(row.ensureUser).toBe('Sam Roe');
    expect(row.changes).toContainEqual({ field: 'cost', from: '', to: '0 credits (price via bulk edit)' });
  });

  it('errors a project whose client_id is missing from the Clients tab', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook(soccTabs({
      clients: [['uuid-1', 'Goldentree', 'Cl00042', '2024-01-01', '']],
      projects: [['Ghost Study', '', 'uuid-x', 'Ghost Co', '', '', '', '', '2026-01-01', '']],
    }));
    const plan = await buildPlan(m.api, 's.xlsx', wb);
    const row = findRow(plan, 'studies', 'Ghost Study');
    expect(row.action).toBe('error');
    expect(row.client).toBe('Ghost Co');
    expect(row.error).toMatch(/missing from the Clients tab/);
  });

  it('dedupes duplicate project names within one client: second occurrence is unchanged', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook(soccTabs({
      clients: [['uuid-1', 'Goldentree', 'Cl00042', '2024-01-01', '']],
      projects: [
        ['Dup Study', '', 'uuid-1', 'Goldentree', '', '', '2026-01-01', '', '', ''],
        ['Dup Study', '', 'uuid-1', 'Goldentree', '', '', '2026-02-01', '', '', ''],
      ],
    }));
    const plan = await buildPlan(m.api, 's.xlsx', wb);
    const dups = plan.rows.filter(r => r.tab === 'studies' && r.name === 'Dup Study');
    expect(dups.map(r => r.action)).toEqual(['create', 'unchanged']);
  });

  it('derives a new client\'s became-on (earliest project date) and RM (modal salesperson)', async () => {
    const m = makeApi();
    const wb = await makeWorkbook(soccTabs({
      clients: [['uuid-2', 'Fresh Capital', 'Cl00099', '2025-06-15T10:00:00Z', '']],
      projects: [
        ['P1', '', 'uuid-2', 'Fresh Capital', 'Alex', '', '2025-07-01', '', '2025-07-02', ''],
        ['P2', '', 'uuid-2', 'Fresh Capital', 'Alex', '', '2025-06-20', '', '2025-06-21', ''],
        ['P3', '', 'uuid-2', 'Fresh Capital', 'Jenna', '', '2025-08-01', '', '2025-08-02', ''],
      ],
    }));
    const plan = await buildPlan(m.api, 's.xlsx', wb);
    const row = findRow(plan, 'clients', 'Fresh Capital');
    expect(row.action).toBe('create');
    expect(row.payload).toEqual({
      name: 'Fresh Capital',
      socc_code: 'Cl00099',
      became_on: '2025-06-20',
      relationship_manager: 'Alex',
    });
  });

  it('imports non-archived contacts as users; existing ones unchanged, archived skipped', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook(soccTabs({
      clients: [['uuid-1', 'Goldentree', 'Cl00042', '2024-01-01', '']],
      contacts: [
        ['uuid-1', 'Jane', 'Doe', 'jane@x.com', ''],
        ['uuid-1', 'Bob', 'New', 'bob@x.com', 'FALSE'],
        ['uuid-1', 'Old', 'Guy', 'old@x.com', 'TRUE'],
      ],
    }));
    const plan = await buildPlan(m.api, 's.xlsx', wb);
    const userRows = plan.rows.filter(r => r.tab === 'users');
    expect(userRows).toHaveLength(2); // archived contact produces no row at all
    expect(findRow(plan, 'users', 'Jane Doe').action).toBe('unchanged');
    const bob = findRow(plan, 'users', 'Bob New');
    expect(bob.action).toBe('create');
    expect(bob.payload).toEqual({ name: 'Bob New', email: 'bob@x.com' });
  });
});

// ================================================================= applyPlan

describe('applyPlan', () => {
  it('applies clients before children and resolves the newly created client id', async () => {
    const m = makeApi();
    const wb = await makeWorkbook([
      { name: 'Clients', rows: [CLIENT_HEADERS, ['NewCo', 'Cl00100', '2026-01-01', 'Alex', '', '', '']] },
      { name: 'Users', rows: [USER_HEADERS, ['NewCo', 'Sam', 'sam@newco.com']] },
      { name: 'Contracts', rows: [CONTRACT_HEADERS, ['NewCo', '2026 Deal', '2026-01-15', '', '1,000', '', '']] },
      { name: 'Studies', rows: [STUDY_HEADERS, ['NewCo', 'Kickoff Study', '2026-02-01', 'Sam', '', '', '250', '', '']] },
    ]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    expect(plan.counts.create).toBe(4);

    m.calls.length = 0; // only observe the apply phase
    const result = await applyPlan(m.api, plan);

    expect(m.calls.map(c => c.method)).toEqual([
      'listClients',
      'createClient',
      'createClientUser', // Users tab row
      'createContract',
      'listClientUsers', // ensureUser('Sam') — finds the user created above
      'createStudy',
    ]);
    const newClient = m.state.clients.find(c => c.name === 'NewCo')!;
    const sam = newClient.users.find(u => u.name === 'Sam')!;
    expect((m.callsTo('createClientUser')[0].args[0])).toBe(newClient.id);
    expect((m.callsTo('createContract')[0].args[0] as Rec).client_id).toBe(newClient.id);
    const studyBody = m.callsTo('createStudy')[0].args[0] as Rec;
    expect(studyBody.client_id).toBe(newClient.id);
    expect(studyBody.client_user_ids).toEqual([sam.id]); // no duplicate "Sam" created
    expect(m.callsTo('createClientUser')).toHaveLength(1);

    expect(result.applied).toBe(4);
    expect(result.failed).toBe(0);
    expect(result.rows.every(r => r.ok)).toBe(true);
  });

  it('creates "(Unassigned)" once and reuses it across studies', async () => {
    const m = makeApi({ clients: [{ id: 1, name: 'Acme' }] });
    const wb = await makeWorkbook([{
      name: 'Studies',
      rows: [
        STUDY_HEADERS,
        ['Acme', 'Study A', '2026-01-01', '', '', '', '100', '', ''],
        ['Acme', 'Study B', '2026-01-02', '', '', '', '200', '', ''],
      ],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    m.calls.length = 0;
    const result = await applyPlan(m.api, plan);

    const created = m.callsTo('createClientUser');
    expect(created).toHaveLength(1);
    expect(created[0].args[1]).toEqual({ name: '(Unassigned)', email: '' });
    expect(m.callsTo('listClientUsers')).toHaveLength(1); // cached after first ensureUser

    const unassignedId = m.state.clients[0].users.find(u => u.name === '(Unassigned)')!.id;
    const studyCalls = m.callsTo('createStudy').map(c => c.args[0] as Rec);
    expect(studyCalls).toHaveLength(2);
    for (const body of studyCalls) expect(body.client_user_ids).toEqual([unassignedId]);
    expect(result.applied).toBe(2);
  });

  it('records a failed row as ok:false and keeps applying the rest', async () => {
    const m = makeApi({ clients: [{ id: 1, name: 'Acme' }] });
    const wb = await makeWorkbook([{
      name: 'Contracts',
      rows: [
        CONTRACT_HEADERS,
        ['Acme', 'Bad Contract', '2026-01-01', '', '10', '', ''],
        ['Acme', 'Good Contract', '2026-01-02', '', '20', '', ''],
      ],
    }]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    m.failOn('createContract', args => (args[0] as Rec).name === 'Bad Contract');

    const result = await applyPlan(m.api, plan);
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    const bad = result.rows.find(r => r.name === 'Bad Contract')!;
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/mock failure: createContract/);
    const good = result.rows.find(r => r.name === 'Good Contract')!;
    expect(good.ok).toBe(true);
    expect(good.message).toBe('Created.');
    expect(m.state.contracts.map(c => c.name)).toEqual(['Good Contract']);
  });

  it('skips a planned client create that already exists at apply time', async () => {
    // Plan built against an empty CMS...
    const empty = makeApi();
    const wb = await makeWorkbook([{
      name: 'Clients',
      rows: [CLIENT_HEADERS, ['NewCo', '', '2026-01-01', '', '', '', '']],
    }]);
    const plan = await buildPlan(empty.api, 't.xlsx', wb);
    // ...but applied after someone already created NewCo.
    const m = makeApi({ clients: [{ id: 5, name: 'NewCo' }] });
    const result = await applyPlan(m.api, plan);
    expect(m.callsTo('createClient')).toHaveLength(0);
    expect(result.rows[0].message).toBe('Already existed — skipped.');
    // Note: a skipped duplicate still counts as "applied" (ok: true).
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('only applies create/update rows: unchanged and error rows are ignored', async () => {
    const m = makeApi({ clients: [GOLDENTREE] });
    const wb = await makeWorkbook([
      { name: 'Clients', rows: [CLIENT_HEADERS, ['Goldentree', 'Cl00042', '2024-05-01', 'Alex', '', '', '']] },
      { name: 'Users', rows: [USER_HEADERS, ['Nobody Inc', 'A Person', 'a@b.com']] },
    ]);
    const plan = await buildPlan(m.api, 't.xlsx', wb);
    expect(plan.counts).toEqual({ create: 0, update: 0, unchanged: 1, error: 1 });
    m.calls.length = 0;
    const result = await applyPlan(m.api, plan);
    expect(m.calls.map(c => c.method)).toEqual(['listClients']);
    expect(result.rows).toEqual([]);
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(0);
  });
});
