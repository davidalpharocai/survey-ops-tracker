// GET /reports/transactions/pdf?client_id=N — download a client's credit
// usage snapshot as a PDF: balance summary + full transaction ledger.
//
// Client-facing output ("clients will want an output of their credit
// usage"), generated internally. jsPDF is pure JS (no font files or
// native deps) so this route works the same in dev and on Amplify's
// bundled SSR Lambda.

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

export const dynamic = 'force-dynamic';

const INK = '#111827';
const MUTED = '#6b7280';
const ACCENT = '#1d4ed8';
const RULE = '#e5e7eb';

// This PDF is handed to clients, so never print raw internal staff email
// addresses on it. Show a human display name derived from the local part
// (e.g. "jane.doe@alpharoc.ai" -> "Jane Doe") instead of the full address.
function staffName(email: string | null | undefined): string {
  if (!email) return '';
  const local = email.split('@')[0] || '';
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return name || email;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const email = await currentUserEmail();
  if (!email) {
    return NextResponse.json({ detail: 'Not signed in.' }, { status: 401 });
  }
  const clientId = parseId(req.nextUrl.searchParams.get('client_id'));
  if (clientId == null) {
    return NextResponse.json({ detail: 'client_id is required.' }, { status: 400 });
  }

  const api = await apiForRequest();
  const client = await api.getClient(clientId);
  if (!client) {
    return NextResponse.json({ detail: 'Client not found.' }, { status: 404 });
  }
  const [bal, transactions] = await Promise.all([
    api.clientBalances(clientId),
    api.listTransactionsByClient(clientId),
  ]);

  const now = new Date();
  const generatedOn = now.toISOString().slice(0, 10);
  const currentYear = now.getUTCFullYear();

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  // Header
  doc.setTextColor(ACCENT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('ALPHAROC', margin, 42);
  doc.setTextColor(INK);
  doc.setFontSize(19);
  doc.text('Client Credit Usage', margin, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text(client.name, margin, 82);

  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  const metaRight = [
    `Generated ${generatedOn}`,
    `Prepared by ${staffName(email)}`,
    client.relationshipManager
      ? `Relationship manager: ${client.relationshipManager}`
      : '',
    `Client since ${isoDate(client.becameClientOn)}`,
  ].filter(Boolean);
  metaRight.forEach((line, i) => {
    doc.text(line, pageW - margin, 42 + i * 13, { align: 'right' });
  });

  doc.setDrawColor(RULE);
  doc.line(margin, 94, pageW - margin, 94);

  // Balance summary cards (as a compact one-row table)
  autoTable(doc, {
    startY: 106,
    margin: { left: margin, right: margin },
    head: [[
      'Credits remaining',
      'Dollars remaining',
      `${currentYear} contract value`,
      'Next renewal',
    ]],
    body: [[
      creditsFmt(bal.credits),
      dollars(bal.dollars),
      contractValue(bal.cyCredits, bal.cyValue),
      bal.cyRenewal ? isoDate(bal.cyRenewal) : '—',
    ]],
    theme: 'grid',
    styles: { fontSize: 11, cellPadding: 8, textColor: INK, lineColor: RULE },
    headStyles: {
      fillColor: '#f3f4f6',
      textColor: MUTED,
      fontSize: 8,
      fontStyle: 'bold',
    },
  });

  // Transaction ledger
  const afterSummaryY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(INK);
  doc.text('Transaction history', margin, afterSummaryY + 28);

  autoTable(doc, {
    startY: afterSummaryY + 36,
    margin: { left: margin, right: margin },
    head: [['Date', 'Type', 'Name', 'For user', 'Credits', 'Dollars', 'Renewal', 'Recorded by']],
    body: transactions.map(t => [
      isoDate(t.occurredOn),
      t.kind === 'contract' ? 'Contract' : 'Study',
      t.name,
      t.clientUser ? t.clientUser.name : '',
      creditsSigned(t.creditsDelta),
      dollarsSigned(t.dollarsDelta),
      t.renewalOn ? isoDate(t.renewalOn) : '',
      staffName(t.actorEmail),
    ]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 6, textColor: INK, lineColor: RULE },
    headStyles: { fillColor: ACCENT, textColor: '#ffffff', fontStyle: 'bold' },
    alternateRowStyles: { fillColor: '#f9fafb' },
    columnStyles: {
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    didParseCell: data => {
      // Red for consumption, green for top-ups, matching the web UI.
      if (data.section === 'body' && (data.column.index === 4 || data.column.index === 5)) {
        const raw = String(data.cell.raw || '');
        if (raw.startsWith('-')) data.cell.styles.textColor = '#b91c1c';
        else if (raw.startsWith('+')) data.cell.styles.textColor = '#15803d';
      }
    },
    didDrawPage: () => {
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(MUTED);
      doc.text(
        `AlphaROC Client Credit Management — ${client.name} — generated ${generatedOn}`,
        margin,
        pageH - 20,
      );
      doc.text(
        `Page ${doc.getNumberOfPages()}`,
        pageW - margin,
        pageH - 20,
        { align: 'right' },
      );
    },
  });

  if (transactions.length === 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED);
    doc.text('No transactions recorded yet.', margin, afterSummaryY + 56);
  }

  const safeName = client.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'client';
  const filename = `AlphaROC Credit Usage - ${safeName} - ${generatedOn}.pdf`;

  return new NextResponse(Buffer.from(doc.output('arraybuffer')), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
