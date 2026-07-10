// GET /reports/transactions/pdf?client_id=N — "Export Credits Summary":
// a client-facing credit statement. Configurable by the caller:
//   scope = all | contract | survey   (which records)
//   id    = target contract/survey id (when scope != all)
//   from,to = YYYY-MM-DD time-range filter (optional; all-time if absent)
//   cols  = comma-separated column keys (optional; sensible default set)
//
// jsPDF is pure JS (no font files / native deps) so it runs the same in
// dev and on the bundled SSR Lambda.

import { NextRequest, NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { apiForRequest, parseId } from '../../../../lib/action';
import { currentUserEmail } from '../../../../lib/auth';
import {
  contractValue,
  credits as creditsFmt,
  creditsSigned,
  dollars,
  dollarsSigned,
  isoDate,
} from '../../../../lib/format';
import type { Transaction } from '../../../../lib/types';

export const dynamic = 'force-dynamic';

const INK = '#111827';
const MUTED = '#6b7280';
const ACCENT = '#1d4ed8';
const RULE = '#e5e7eb';

// Never print raw internal staff emails on a client-facing PDF — show a
// display name derived from the local part instead.
function staffName(email: string | null | undefined): string {
  if (!email) return '';
  const local = email.split('@')[0] || '';
  const name = local.split(/[._-]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return name || email;
}

function typeLabel(kind: string): string {
  if (kind === 'contract') return 'Contract';
  if (kind === 'adjustment') return 'Adjustment';
  return 'Survey';
}

interface Column {
  key: string;
  label: string;
  get: (t: Transaction) => string;
  num?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'date', label: 'Date', get: t => isoDate(t.occurredOn) },
  { key: 'type', label: 'Type', get: t => typeLabel(t.kind) },
  { key: 'name', label: 'Name', get: t => t.name },
  { key: 'contact', label: 'For user', get: t => (t.clientUser ? t.clientUser.name : '') },
  { key: 'credits', label: 'Credits', get: t => creditsSigned(t.creditsDelta), num: true },
  { key: 'dollars', label: 'Dollars', get: t => dollarsSigned(t.dollarsDelta), num: true },
  { key: 'renewal', label: 'Renewal', get: t => (t.renewalOn ? isoDate(t.renewalOn) : '') },
  { key: 'recordedBy', label: 'Recorded by', get: t => staffName(t.actorEmail) },
  { key: 'soccStage', label: 'SOCC stage', get: t => t.soccBoardColumn || '' },
];
const DEFAULT_COLS = ['date', 'type', 'name', 'contact', 'credits', 'dollars', 'renewal', 'recordedBy'];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ detail: 'Not signed in.' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const clientId = parseId(sp.get('client_id'));
  if (clientId == null) return NextResponse.json({ detail: 'client_id is required.' }, { status: 400 });

  const scope = (sp.get('scope') || 'all').toLowerCase();
  const targetId = parseId(sp.get('id'));
  const from = (sp.get('from') || '').slice(0, 10);
  const to = (sp.get('to') || '').slice(0, 10);
  const colsParam = (sp.get('cols') || '').split(',').map(s => s.trim()).filter(Boolean);
  const chosen = colsParam.length
    ? COLUMNS.filter(c => colsParam.includes(c.key))
    : COLUMNS.filter(c => DEFAULT_COLS.includes(c.key));
  const columns = chosen.length ? chosen : COLUMNS.filter(c => DEFAULT_COLS.includes(c.key));

  const api = await apiForRequest();
  const client = await api.getClient(clientId);
  if (!client) return NextResponse.json({ detail: 'Client not found.' }, { status: 404 });
  const [bal, transactions] = await Promise.all([
    api.clientBalances(clientId),
    api.listTransactionsByClient(clientId),
  ]);

  const inRange = (t: Transaction): boolean => {
    const d = isoDate(t.occurredOn);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  // Scope selection.
  let rows: Transaction[];
  let scopeLabel = 'All contracts & surveys';
  if (scope === 'survey' && targetId != null) {
    // Respect the selected date range like the "all" scope does; keep a
    // separate lookup so the label still names the survey even if it falls
    // outside the range.
    const survey = transactions.find(t => t.id === targetId);
    rows = survey && inRange(survey) ? [survey] : [];
    scopeLabel = `Survey: ${survey?.name ?? targetId}`;
  } else if (scope === 'contract' && targetId != null) {
    const contract = transactions.find(t => t.id === targetId);
    const contractRow = contract && inRange(contract) ? [contract] : [];
    const linked = transactions.filter(t => t.contractId === targetId && inRange(t));
    rows = [...contractRow, ...linked];
    scopeLabel = `Contract: ${contract?.name ?? targetId}`;
  } else {
    rows = transactions.filter(inRange);
  }

  const rangeLabel = from && to ? `${from} – ${to}` : from ? `Since ${from}` : to ? `Through ${to}` : 'All time';

  const now = new Date();
  const generatedOn = now.toISOString().slice(0, 10);
  const currentYear = now.getUTCFullYear();

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  doc.setTextColor(ACCENT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('ALPHAROC', margin, 42);
  doc.setTextColor(INK);
  doc.setFontSize(19);
  doc.text('Credit Summary', margin, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text(client.name, margin, 82);
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(`${scopeLabel}  ·  ${rangeLabel}`, margin, 96);

  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  const metaRight = [
    `Generated ${generatedOn}`,
    `Prepared by ${staffName(email)}`,
    client.relationshipManager ? `Relationship manager: ${client.relationshipManager}` : '',
    `Client since ${isoDate(client.becameClientOn)}`,
  ].filter(Boolean);
  metaRight.forEach((line, i) => doc.text(line, pageW - margin, 42 + i * 13, { align: 'right' }));

  doc.setDrawColor(RULE);
  doc.line(margin, 104, pageW - margin, 104);

  // Client credit standing (always — it's the "summary").
  autoTable(doc, {
    startY: 116,
    margin: { left: margin, right: margin },
    head: [['Credits remaining', 'Dollars remaining', `${currentYear} contract value`, 'Next renewal']],
    body: [[
      creditsFmt(bal.credits),
      dollars(bal.dollars),
      contractValue(bal.cyCredits, bal.cyValue),
      bal.cyRenewal ? isoDate(bal.cyRenewal) : '—',
    ]],
    theme: 'grid',
    styles: { fontSize: 11, cellPadding: 8, textColor: INK, lineColor: RULE },
    headStyles: { fillColor: '#f3f4f6', textColor: MUTED, fontSize: 8, fontStyle: 'bold' },
  });

  const afterSummaryY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(INK);
  doc.text('Detail', margin, afterSummaryY + 28);

  const numCols = new Set(columns.map((c, i) => (c.num ? i : -1)).filter(i => i >= 0));

  autoTable(doc, {
    startY: afterSummaryY + 36,
    margin: { left: margin, right: margin },
    head: [columns.map(c => c.label)],
    body: rows.map(t => columns.map(c => c.get(t))),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 6, textColor: INK, lineColor: RULE },
    headStyles: { fillColor: ACCENT, textColor: '#ffffff', fontStyle: 'bold' },
    alternateRowStyles: { fillColor: '#f9fafb' },
    columnStyles: Object.fromEntries([...numCols].map(i => [i, { halign: 'right' as const }])),
    didParseCell: data => {
      if (data.section === 'body' && numCols.has(data.column.index)) {
        const raw = String(data.cell.raw || '');
        if (raw.startsWith('-')) data.cell.styles.textColor = '#b91c1c';
        else if (raw.startsWith('+')) data.cell.styles.textColor = '#15803d';
      }
    },
    didDrawPage: () => {
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(MUTED);
      doc.text(`AlphaROC Credit Summary — ${client.name} — generated ${generatedOn}`, margin, pageH - 20);
      doc.text(`Page ${doc.getNumberOfPages()}`, pageW - margin, pageH - 20, { align: 'right' });
    },
  });

  if (rows.length === 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED);
    doc.text('No matching records for this selection.', margin, afterSummaryY + 56);
  }

  const safeName = client.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'client';
  const filename = `AlphaROC Credit Summary - ${safeName} - ${generatedOn}.pdf`;

  return new NextResponse(Buffer.from(doc.output('arraybuffer')), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
