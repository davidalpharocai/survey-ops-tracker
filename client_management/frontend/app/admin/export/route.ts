// GET /admin/export — admin-only full-data export as a ZIP.
//
// The mirror of the importer: bundles everything in the CMS as a ZIP
// containing
//   - ccm-data-<date>.xlsx : the 4-tab CMS template (Clients/Users/
//     Contracts/Studies) populated with all data — re-importable via
//     Admin → Import Data, so export→import round-trips.
//   - transactions-ledger-<date>.csv : the raw transaction ledger with
//     ids, signed deltas, attribution and server timestamps (a faithful
//     backup that the template format doesn't fully capture).
//   - README.txt : what this is, when/by whom generated, and row counts.

import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import { apiForRequest } from '../../../lib/action';
import { currentUserEmail, currentUserIsAdmin } from '../../../lib/auth';
import { isoDate } from '../../../lib/format';
import type { Client, ContractTransaction, StudyTransaction, Transaction } from '../../../lib/types';

export const dynamic = 'force-dynamic';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1D4ED8' },
};

function headerRow(ws: ExcelJS.Worksheet, headers: string[], widths: number[]) {
  ws.columns = headers.map((h, i) => ({ header: h, width: widths[i] }));
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell(c => { c.fill = HEADER_FILL; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(): Promise<NextResponse> {
  if (!(await currentUserIsAdmin())) {
    return NextResponse.json({ detail: 'Admin access required.' }, { status: 403 });
  }
  const actor = await currentUserEmail();
  const api = await apiForRequest();

  const clients = (await api.listClientsWithUsers()) as Client[];

  // Pull contracts, studies and the raw ledger for every client.
  const perClient = await Promise.all(
    clients.map(async c => {
      const [contracts, studies, ledger] = await Promise.all([
        api.listContractsByClient(c.id) as Promise<ContractTransaction[]>,
        api.listStudiesByClient(c.id) as Promise<StudyTransaction[]>,
        api.listTransactionsByClient(c.id) as Promise<Transaction[]>,
      ]);
      return { client: c, contracts, studies, ledger };
    }),
  );

  // ---- re-importable workbook ----
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AlphaROC CMS export';

  const clientsWs = wb.addWorksheet('Clients');
  headerRow(clientsWs,
    ['Client Name', 'Became Client On', 'Relationship Manager', 'Primary Contact Name', 'Primary Contact Cell', 'Primary Contact Email'],
    [32, 18, 22, 22, 18, 28]);
  for (const { client: c } of perClient) {
    clientsWs.addRow([
      c.name, isoDate(c.becameClientOn), c.relationshipManager || '',
      c.primaryContactName || '', c.primaryContactCell || '', c.primaryContactEmail || '',
    ]);
  }

  const usersWs = wb.addWorksheet('Users');
  headerRow(usersWs, ['Client', 'Name', 'Email'], [32, 26, 30]);
  let userCount = 0;
  for (const { client: c } of perClient) {
    for (const u of c.users || []) {
      usersWs.addRow([c.name, u.name, u.email || '']);
      userCount += 1;
    }
  }

  const contractsWs = wb.addWorksheet('Contracts');
  headerRow(contractsWs,
    ['Client', 'Contract Name', 'Contract Date', 'Renewal Date', 'Credits', 'Dollars'],
    [32, 34, 16, 16, 12, 12]);
  let contractCount = 0;
  for (const { client: c, contracts } of perClient) {
    for (const t of contracts) {
      contractsWs.addRow([
        c.name, t.name, isoDate(t.occurredOn), t.renewalOn ? isoDate(t.renewalOn) : '',
        Number(t.creditsAmount ?? 0), Number(t.dollarsAmount ?? 0),
      ]);
      contractCount += 1;
    }
  }

  const studiesWs = wb.addWorksheet('Studies');
  headerRow(studiesWs,
    ['Client', 'Study Name', 'Study Date', 'For User', 'Cost Type', 'Cadence', 'Cost', 'Setup Cost'],
    [32, 40, 16, 24, 12, 12, 12, 12]);
  let studyCount = 0;
  for (const { client: c, studies } of perClient) {
    for (const t of studies) {
      const cadence = t.cadence || 'single';
      const isTracker = ['weekly', 'monthly', 'quarterly'].includes(cadence);
      const cost = isTracker ? Number(t.costPerRun ?? 0) : Number(t.costAnnual ?? 0);
      const forUser = (t.userObjs && t.userObjs[0]?.name) || '';
      studiesWs.addRow([
        c.name, t.name, isoDate(t.occurredOn), forUser,
        t.costType || 'credits', cadence, cost, Number(t.setupCost ?? 0),
      ]);
      studyCount += 1;
    }
  }

  const xlsxBuf = await wb.xlsx.writeBuffer();

  // ---- raw ledger CSV ----
  const cols = ['transaction_id', 'client', 'kind', 'name', 'occurred_on', 'renewal_on', 'credits_delta', 'dollars_delta', 'cadence', 'attributed_users', 'recorded_by', 'recorded_at'];
  const lines = [cols.join(',')];
  let txnCount = 0;
  for (const { client: c, ledger } of perClient) {
    for (const t of ledger) {
      const st = t as Partial<StudyTransaction>;
      const users = (st.userObjs || []).map(u => u.name).join('; ');
      lines.push([
        t.id, c.name, t.kind, t.name, isoDate(t.occurredOn), t.renewalOn ? isoDate(t.renewalOn) : '',
        t.creditsDelta ?? 0, t.dollarsDelta ?? 0, st.cadence || '', users, t.actorEmail,
        t.createdAt ? new Date(t.createdAt).toISOString() : '',
      ].map(csvCell).join(','));
      txnCount += 1;
    }
  }
  const ledgerCsv = lines.join('\r\n');

  const generatedOn = new Date().toISOString();
  const day = generatedOn.slice(0, 10);
  const readme = [
    'AlphaROC Client Credit Management — data export',
    '',
    `Generated: ${generatedOn}`,
    `By: ${actor}`,
    '',
    'Contents:',
    `  ccm-data-${day}.xlsx           Re-importable workbook (Admin → Import Data).`,
    `  transactions-ledger-${day}.csv Raw transaction ledger (full detail).`,
    '',
    'Counts:',
    `  Clients:      ${perClient.length}`,
    `  Client users: ${userCount}`,
    `  Contracts:    ${contractCount}`,
    `  Studies:      ${studyCount}`,
    `  Ledger rows:  ${txnCount}`,
    '',
    'The .xlsx uses the CMS import template layout, so re-uploading it via',
    'Admin → Import Data reproduces this dataset (matched by name; existing',
    'rows update only changed fields; nothing is deleted).',
  ].join('\n');

  const zip = new JSZip();
  zip.file(`ccm-data-${day}.xlsx`, xlsxBuf);
  zip.file(`transactions-ledger-${day}.csv`, ledgerCsv);
  zip.file('README.txt', readme);
  const zipBuf = await zip.generateAsync({ type: 'arraybuffer' });

  return new NextResponse(zipBuf, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="ccm-export-${day}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
