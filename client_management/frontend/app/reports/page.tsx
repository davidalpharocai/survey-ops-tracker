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
          <h3>Contracts &amp; Studies (per client)</h3>
          <p>Pick a client and see their contracts with each one&apos;s studies and remaining balance.</p>
        </Link>
        <Link className="report-card" href="/reports/renewals">
          <h3>Renewal Radar</h3>
          <p>Every upcoming contract renewal grouped into 30 / 60 / 90-day windows, so nothing sneaks up.</p>
        </Link>
        <Link className="report-card" href="/reports/health">
          <h3>Balance Health</h3>
          <p>Each client&apos;s monthly burn over the last 90 days, the projected date their balance runs out, and who needs attention.</p>
        </Link>
      </div>
    </>
  );
}
