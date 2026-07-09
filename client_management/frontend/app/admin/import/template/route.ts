// GET /admin/import/template — blank CMS import template (.xlsx).

import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

import { currentUserIsAdmin } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1D4ED8' },
};

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: { key: string; width: number }[],
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name);
  ws.columns = headers.map(h => ({ header: h.key, width: h.width }));
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell(c => {
    c.fill = HEADER_FILL;
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

export async function GET(): Promise<NextResponse> {
  if (!(await currentUserIsAdmin())) {
    return NextResponse.json({ detail: 'Admin access required.' }, { status: 403 });
  }

  const wb = new ExcelJS.Workbook();

  const readme = wb.addWorksheet('Read Me');
  readme.getColumn(1).width = 110;
  const lines = [
    'CMS import template — fill any or all of the four tabs, then upload at Admin → Import Data.',
    '',
    'Rules:',
    '• Rows are matched by name (client name; contract/study name within their client), case-insensitive.',
    '• A matched row UPDATES only the columns you fill — empty cells never overwrite existing values.',
    '• Unmatched rows are CREATED. The importer never deletes anything.',
    '• You will see a full preview (creates / updates / unchanged) before anything is applied.',
    '• Dates: YYYY-MM-DD (e.g. 2026-07-08).',
    '',
    'Tab notes:',
    '• Clients — "Became Client On" is required for NEW clients (defaults to today if blank).',
    '• Users — the people at the client; studies are attributed to them.',
    '• Contracts — add credits and/or dollars. Renewal Date defaults to Contract Date + 1 year.',
    '• Studies — Cost Type is credits or dollars. Cadence is single, weekly, monthly, or quarterly.',
    '  For weekly/monthly/quarterly, Cost is PER RUN (annual total = cost × runs/year) and Setup Cost',
    '  (credits) is added once. For single, Cost is the total. "For User" attributes the study;',
    '  new names are created under the client automatically.',
  ];
  lines.forEach((t, i) => {
    const c = readme.getCell(i + 1, 1);
    c.value = t;
    if (i === 0) c.font = { bold: true };
  });

  addSheet(wb, 'Clients', [
    { key: 'Client Name', width: 32 },
    { key: 'Client Code', width: 14 },
    { key: 'Became Client On', width: 18 },
    { key: 'Relationship Manager', width: 22 },
    { key: 'Primary Contact Name', width: 22 },
    { key: 'Primary Contact Cell', width: 18 },
    { key: 'Primary Contact Email', width: 28 },
  ]);
  addSheet(wb, 'Users', [
    { key: 'Client', width: 32 },
    { key: 'Name', width: 26 },
    { key: 'Email', width: 30 },
  ]);
  addSheet(wb, 'Contracts', [
    { key: 'Client', width: 32 },
    { key: 'Contract Name', width: 34 },
    { key: 'Project Code', width: 14 },
    { key: 'Contract Date', width: 16 },
    { key: 'Renewal Date', width: 16 },
    { key: 'Credits', width: 12 },
    { key: 'Dollars', width: 12 },
  ]);
  addSheet(wb, 'Studies', [
    { key: 'Client', width: 32 },
    { key: 'Study Name', width: 40 },
    { key: 'Project Code', width: 14 },
    { key: 'Study Date', width: 16 },
    { key: 'For User', width: 24 },
    { key: 'Cost Type', width: 12 },
    { key: 'Cadence', width: 12 },
    { key: 'Cost', width: 12 },
    { key: 'Setup Cost', width: 12 },
  ]);

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="ccm-import-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
