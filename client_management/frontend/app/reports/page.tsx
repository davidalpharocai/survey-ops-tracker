import Link from 'next/link';

export const metadata = { title: 'Transaction Reports · AlphaROC' };

export default function ReportsIndexPage() {
  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Transaction Reports</h1>
      <p className="muted">Pick a report. More reports can be added here as we define them.</p>

      <div className="report-grid">
        <Link className="report-card" href="/reports/balances">
          <h3>Credits and dollars remaining by client</h3>
          <p>Every client&apos;s current credits balance, dollars balance, current-year contract value, and next renewal date.</p>
        </Link>
        <Link className="report-card" href="/reports/transactions">
          <h3>Per-client transaction log</h3>
          <p>Pick a client and see every contract and study, who recorded it, and when.</p>
        </Link>
        <div className="report-card disabled">
          <h3>More reports — coming soon</h3>
          <p className="muted">Suggested next: spend by relationship manager · monthly burn rate · low-balance flagging · contract value vs. consumed.</p>
        </div>
      </div>
    </>
  );
}
