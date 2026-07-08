// Seed clients + contracts from data/Contract Management.xlsx.
//
// Reads two sheets — occam2025 and occam2026 — which between them are the
// clean contract register. Each row becomes one contract Transaction,
// unique client names become Clients, and each Contact name becomes a
// ClientUser. The earliest contract date becomes becameClientOn.
//
// Usage:
//   node scripts/seed-from-spreadsheet.js              # wipe + reseed
//   node scripts/seed-from-spreadsheet.js --dry-run    # show what would be inserted
//   node scripts/seed-from-spreadsheet.js --keep-existing
//
// CLI takes the xlsx path as the last positional arg, defaulting to
// "data/Contract Management.xlsx".

import path from 'node:path';
import process from 'node:process';

import ExcelJS from 'exceljs';

import { pool } from '../src/lib/db.js';
import {
  deleteAllTransactions,
  deleteAllClientUsers,
  deleteAllClients,
  findClientByName,
  createClient,
  createClientUser,
  createTransaction,
} from '../src/lib/repo.js';
import { addYear } from '../src/lib/dates.js';

const SEED_ACTOR = 'seed@alpharoc.ai';

// Map of source-spreadsheet name -> cleaned canonical name. Applied AFTER
// trimming whitespace. Fixes typos and merges duplicates.
const NAME_FIXES = {
  'American Property Casulty Insurance':
    'American Property Casualty Insurance',
  'Holocine Advisors': 'Holocene Advisors',
  'Electron Capial': 'Electron Capital',
  'New Prespective Senior Living (Argentum)':
    'New Perspective Senior Living (Argentum)',
  'Gingrich360': 'Gingrich 360',
  'Bain': 'Bain & Company',
  'BNP': 'BNP Paribas',
  'BNPP': 'BNP Paribas',
};

function norm(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}
function canonicalName(raw) {
  const s = norm(raw);
  if (!s) return null;
  return NAME_FIXES[s] || s;
}
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function toMoney(v) {
  if (v == null) return null;
  // ExcelJS sometimes returns rich-text/result objects for cells with formulas.
  if (typeof v === 'object' && 'result' in v) v = v.result;
  if (typeof v === 'object' && 'text' in v) v = v.text;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ExcelJS row.values is 1-indexed (index 0 is null). Helper for clarity.
function cell(row, col) {
  return row.values[col];
}

function parseOccam2026(ws) {
  // Cols: 1=Client, 2=Contact, 3=Start Date, 4=Amount, 5=Product,
  //       6=Invoiced, 7=Ringing Bell, 8=Inv Sent, 9=Sales, 10=Type, 11=Notes
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const client = canonicalName(cell(row, 1));
    if (!client) return;
    const contact = norm(cell(row, 2));
    const d = toDate(cell(row, 3));
    const amt = toMoney(cell(row, 4));
    const product = norm(cell(row, 5));
    const sales = norm(cell(row, 9));
    if (!d || !amt || amt <= 0) return;
    out.push({
      source: 'occam2026',
      client,
      contact,
      date: d,
      renewal: addYear(d), // 2026 sheet has no Renewal column
      amount: amt,
      product,
      sales,
    });
  });
  return out;
}

function parseOccam2025(ws) {
  // Cols: 1=Fund, 2=Group, 3=Contact, 4=Start Date, 5=Amount,
  //       6=Renewal, 7=Product, 8=Invoiced, 9=Notes, 10=Licences
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const client = canonicalName(cell(row, 1));
    if (!client) return;
    const contact = norm(cell(row, 3));
    const d = toDate(cell(row, 4));
    const amt = toMoney(cell(row, 5));
    const product = norm(cell(row, 7));
    if (!d || !amt || amt <= 0) return;
    const renewal = toDate(cell(row, 6)) || addYear(d);
    out.push({
      source: 'occam2025',
      client,
      contact,
      date: d,
      renewal,
      amount: amt,
      product,
      sales: null,
    });
  });
  return out;
}

function groupByClient(rows) {
  const out = new Map();
  // Sort by date so "last seen Sales wins" is deterministic
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const r of rows) {
    let cd = out.get(r.client);
    if (!cd) {
      cd = {
        name: r.client,
        firstDate: r.date,
        contactsCount: new Map(),
        sales: null,
        rows: [],
      };
      out.set(r.client, cd);
    }
    if (r.date.getTime() < cd.firstDate.getTime()) cd.firstDate = r.date;
    if (r.contact) {
      cd.contactsCount.set(r.contact, (cd.contactsCount.get(r.contact) || 0) + 1);
    }
    if (r.sales) cd.sales = r.sales;
    cd.rows.push(r);
  }
  return out;
}

function pickPrimaryContact(contactsCount) {
  if (contactsCount.size === 0) return null;
  let best = null;
  let bestCount = -1;
  for (const [name, n] of contactsCount.entries()) {
    if (n > bestCount) {
      best = name;
      bestCount = n;
    }
  }
  return best;
}

function fmtMoney(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const keepExisting = args.includes('--keep-existing');
  const xlsxPath =
    args.find(a => !a.startsWith('--')) || 'data/Contract Management.xlsx';

  console.log(`Loading ${xlsxPath}...`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);

  let rows = [];
  const ws2026 = wb.getWorksheet('occam2026');
  if (ws2026) {
    const r = parseOccam2026(ws2026);
    console.log(`  occam2026: ${r.length} contract rows`);
    rows = rows.concat(r);
  }
  const ws2025 = wb.getWorksheet('occam2025');
  if (ws2025) {
    const r = parseOccam2025(ws2025);
    console.log(`  occam2025: ${r.length} contract rows`);
    rows = rows.concat(r);
  }
  console.log(`Total: ${rows.length} contract rows.`);

  const grouped = groupByClient(rows);
  console.log(`Unique clients: ${grouped.size}`);

  if (dryRun) {
    console.log('\nDry-run preview:');
    const names = Array.from(grouped.keys()).sort();
    for (const name of names) {
      const cd = grouped.get(name);
      const total = cd.rows.reduce((s, r) => s + r.amount, 0);
      const primary = pickPrimaryContact(cd.contactsCount) || '—';
      console.log(
        `  ${name.padEnd(55)} contracts=${String(cd.rows.length).padStart(2)}  total=${fmtMoney(total).padStart(13)}  RM=${(cd.sales || '—').padEnd(3)}  primary=${primary}`,
      );
    }
    return;
  }

  if (!keepExisting) {
    console.log('Wiping existing data...');
    const t = await deleteAllTransactions();
    const u = await deleteAllClientUsers();
    const c = await deleteAllClients();
    console.log(`  removed ${c} clients, ${u} users, ${t} transactions`);
  }

  let nClients = 0;
  let nUsers = 0;
  let nContracts = 0;
  const skipped = [];

  for (const [name, cd] of [...grouped.entries()].sort()) {
    if (keepExisting) {
      const existing = await findClientByName(name);
      if (existing) {
        skipped.push(name);
        continue;
      }
    }
    const primaryContact = pickPrimaryContact(cd.contactsCount);
    const client = await createClient({
      name,
      becameClientOn: cd.firstDate,
      relationshipManager: cd.sales,
      primaryContactName: primaryContact,
      createdByEmail: SEED_ACTOR,
    });
    nClients++;

    for (const contact of cd.contactsCount.keys()) {
      await createClientUser({
        clientId: client.id,
        name: contact,
        createdByEmail: SEED_ACTOR,
      });
      nUsers++;
    }

    for (const r of cd.rows) {
      const yearMonth = `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, '0')}`;
      const title = r.product ? `${r.product} ${yearMonth}` : `Contract ${yearMonth}`;
      await createTransaction({
        clientId: client.id,
        kind: 'contract',
        name: title,
        occurredOn: r.date,
        renewalOn: r.renewal,
        creditsDelta: 0,
        dollarsDelta: r.amount,
        actorEmail: SEED_ACTOR,
      });
      nContracts++;
    }
  }

  console.log(`\nInserted: ${nClients} clients, ${nUsers} users, ${nContracts} contracts.`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} clients already in DB: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ' …' : ''}`);
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
