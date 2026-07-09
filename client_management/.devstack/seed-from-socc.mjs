// Seed the local CMS from the Survey Ops Command Center export.
//
// Reads the first tabs of survey-ops-export-*.xlsx (Clients, Projects,
// Client Contacts) and loads them through the backend API so the demo
// shows real client/study names. Costs are deliberately left at 0 —
// the tracker has no credit pricing; sales fills costs in via the
// study bulk-edit flow. Studies must be attributed to a client user,
// so the project's "requested by" contact is used when present and a
// per-client "(Unassigned)" user otherwise.
//
// Usage:  node seed-from-socc.mjs [path-to-xlsx] [--dry-run]
// Rerunnable: existing clients are reused (409 -> lookup), studies are
// skipped when the client already has one with the same name.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const XLSX =
  process.argv.find(a => a.endsWith('.xlsx')) ||
  'C:/Users/david/Claude Code Projects/survey-ops-tracker/exports/survey-ops-export-2026-07-06.xlsx';
const DRY = process.argv.includes('--dry-run');
const BASE = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
const EMAIL = process.env.SEED_USER_EMAIL || 'david@alpharoc.ai';

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User-Email': EMAIL },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${data?.detail ?? text}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- read the export ----
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX);

function rows(sheetName) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`tab not found: ${sheetName}`);
  const header = ws.getRow(1).values.map(v => (v == null ? '' : String(v)));
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    header.forEach((h, i) => {
      if (!h) return;
      let v = row.values[i];
      if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
      if (v && typeof v === 'object' && v.text !== undefined) v = v.text;
      o[h] = v instanceof Date ? v.toISOString() : v;
    });
    out.push(o);
  });
  return out;
}

const isoDay = v => (v ? String(v).slice(0, 10) : null);

const clientsTab = rows('Clients').filter(c => c.name && !c.deleted_at);
const projectsTab = rows('Projects').filter(p => p.project_name && !p.deleted_at);
const contactsTab = rows('Client Contacts').filter(
  c => !c.archived || String(c.archived).toUpperCase() === 'FALSE',
);

// Earliest activity date + modal salesperson per client UUID.
const perClient = new Map();
for (const p of projectsTab) {
  const key = p.client_id;
  if (!key) continue;
  const entry = perClient.get(key) || { dates: [], salespeople: new Map() };
  for (const d of [p.launch_date, p.submitted_date, p.created_at]) {
    const day = isoDay(d);
    if (day) entry.dates.push(day);
  }
  if (p.salesperson) {
    const s = String(p.salesperson).trim();
    if (s) entry.salespeople.set(s, (entry.salespeople.get(s) || 0) + 1);
  }
  perClient.set(key, entry);
}

console.log(
  `export: ${clientsTab.length} clients, ${projectsTab.length} projects, ${contactsTab.length} contacts${DRY ? ' (DRY RUN)' : ''}`,
);

// ---- clients ----
const liveClients = await api('GET', '/api/clients');
const existing = new Map(liveClients.map(c => [c.name.toLowerCase(), c]));
const existingByCode = new Map(
  liveClients.filter(c => c.soccCode).map(c => [c.soccCode, c]),
);
const idByUuid = new Map(); // tracker client UUID -> CMS client id
let created = 0;
let codeBackfilled = 0;
for (const c of clientsTab) {
  const meta = perClient.get(c.id);
  const becameOn =
    (meta && meta.dates.sort()[0]) || isoDay(c.created_at) || '2026-06-10';
  const rm = meta
    ? [...meta.salespeople.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    : null;
  // Match on the stable Cl##### code first, then by name.
  const found = (c.code && existingByCode.get(c.code)) || existing.get(c.name.toLowerCase());
  if (found) {
    idByUuid.set(c.id, found.id);
    // Backfill the code onto a pre-existing client that lacks one.
    if (c.code && !found.soccCode && !DRY) {
      await api('PATCH', `/api/clients/${found.id}`, {
        name: found.name,
        socc_code: c.code,
        became_on: (found.becameClientOn || '').slice(0, 10),
        relationship_manager: found.relationshipManager,
        primary_contact_name: found.primaryContactName,
        primary_contact_cell: found.primaryContactCell,
        primary_contact_email: found.primaryContactEmail,
      });
      found.soccCode = c.code;
      codeBackfilled += 1;
    }
    continue;
  }
  if (DRY) {
    console.log(`would create client: ${c.name} [${c.code || 'no code'}] (since ${becameOn}, RM ${rm ?? '—'})`);
    idByUuid.set(c.id, -(idByUuid.size + 1)); // fake id so study joins preview
    continue;
  }
  const madeClient = await api('POST', '/api/clients', {
    name: c.name,
    socc_code: c.code || null,
    became_on: becameOn,
    relationship_manager: rm,
  });
  idByUuid.set(c.id, madeClient.id);
  created += 1;
}
console.log(`clients: ${created} created, ${existing.size} already present, ${codeBackfilled} codes backfilled`);

// ---- client users from Client Contacts ----
const usersByClient = new Map(); // CMS client id -> Map(lower name -> user id)
async function loadUsers(cmsClientId) {
  if (!usersByClient.has(cmsClientId)) {
    const us = cmsClientId < 0 ? [] : await api('GET', `/api/clients/${cmsClientId}/users`);
    usersByClient.set(cmsClientId, new Map(us.map(u => [u.name.toLowerCase(), u.id])));
  }
  return usersByClient.get(cmsClientId);
}
async function ensureUser(cmsClientId, name, email) {
  const users = await loadUsers(cmsClientId);
  const key = name.toLowerCase();
  if (users.has(key)) return users.get(key);
  if (DRY) {
    console.log(`would create user: ${name} @ client ${cmsClientId}`);
    users.set(key, -1);
    return -1;
  }
  const u = await api('POST', `/api/clients/${cmsClientId}/users`, { name, email: email || '' });
  users.set(key, u.id);
  return u.id;
}

let userCount = 0;
for (const ct of contactsTab) {
  const cmsClientId = idByUuid.get(ct.client_id);
  if (!cmsClientId) continue;
  const name = [ct.first_name, ct.last_name].filter(Boolean).join(' ').trim();
  if (!name) continue;
  await ensureUser(cmsClientId, name, ct.email);
  userCount += 1;
}
console.log(`contacts processed: ${userCount}`);

// ---- studies from Projects ----
const studiesSeen = new Map(); // CMS client id -> Set(lower study name)
async function loadStudies(cmsClientId) {
  if (!studiesSeen.has(cmsClientId)) {
    const st = cmsClientId < 0 ? [] : await api('GET', `/api/clients/${cmsClientId}/studies`);
    studiesSeen.set(cmsClientId, new Set(st.map(s => s.name.toLowerCase())));
  }
  return studiesSeen.get(cmsClientId);
}

let made = 0;
let skippedNoClient = 0;
let skippedDup = 0;
for (const p of projectsTab) {
  const cmsClientId = idByUuid.get(p.client_id);
  if (!cmsClientId) {
    skippedNoClient += 1;
    console.log(`  skip (no client in Clients tab): ${p.project_name} [client="${p.client ?? ''}"]`);
    continue;
  }
  const seen = await loadStudies(cmsClientId);
  const nameKey = String(p.project_name).toLowerCase();
  if (seen.has(nameKey)) {
    skippedDup += 1;
    continue;
  }
  const occurred =
    isoDay(p.launch_date) || isoDay(p.submitted_date) || isoDay(p.created_at) || '2026-06-10';
  const attributee = (p.requested_by_name && String(p.requested_by_name).trim()) || '(Unassigned)';
  if (DRY) {
    console.log(`would create study: ${p.project_name} @ ${occurred} for '${attributee}'`);
    seen.add(nameKey);
    continue;
  }
  const userId = await ensureUser(cmsClientId, attributee, '');
  await api('POST', '/api/studies', {
    client_id: cmsClientId,
    name: p.project_name,
    socc_project_code: p.project_code || null,
    occurred_on: occurred,
    cost_type: 'credits',
    cadence: 'single',
    cost: '0',
    client_user_ids: [userId],
  });
  seen.add(nameKey);
  made += 1;
}
console.log(
  `studies: ${made} created, ${skippedDup} already present, ${skippedNoClient} skipped (client not in Clients tab)`,
);
console.log('done.');
