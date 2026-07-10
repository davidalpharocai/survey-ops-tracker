import Link from 'next/link';

export const metadata = { title: 'User Guide · AlphaROC Credit Management' };

// Self-contained in-app copy of the user guide (mirrors USER_GUIDE.md).
// Authored as plain JSX so it renders reliably with no markdown/runtime deps.
export default function GuidePage() {
  return (
    <div className="guide">
      <Link className="back" href="/">← Home</Link>
      <h1>AlphaROC Credit Management — User Guide</h1>
      <p className="muted">For the sales and product team.</p>

      <p>
        CCM is where AlphaROC tracks what each client has <strong>bought</strong>{' '}
        (contracts that add credits and/or dollars) and what they&apos;ve{' '}
        <strong>used</strong> (studies — surveys — that draw that balance down). It is
        the source of truth for client balances, contract renewals, and credit usage.
      </p>

      <h2>Signing in</h2>
      <p>
        Open the app link. Enter your <strong>@alpharoc.ai email</strong> as the
        username and the shared team password. Your email is recorded on everything
        you do, so use your own — it also decides <strong>which clients you see</strong>.
      </p>

      <h2>What you can see and do (your role)</h2>
      <ul>
        <li><strong>Salespeople</strong> see <strong>only their own clients</strong> everywhere (dashboard, balances, search, reports). You can <strong>record studies</strong> and <strong>add contacts</strong> on your clients, but you can&apos;t add credits directly — you <strong>Request Credits</strong> and an approver applies them.</li>
        <li><strong>Approvers</strong> (Vineet, Shanu, David) and <strong>admins</strong> (David, Tedi, Nachi) see <strong>all</strong> clients; approvers review the credit requests.</li>
      </ul>
      <p className="muted">Can&apos;t find a client? It&apos;s almost always not assigned to you as salesperson — an admin can set that on Manage Client List.</p>

      <h2>The things you&apos;ll do every day</h2>

      <h3>Record a Study (money out)</h3>
      <p className="muted small">Home → Record a Study.</p>
      <ol>
        <li>Pick the <strong>client</strong>.</li>
        <li>Pick the <strong>contact(s)</strong> the study is for. If the right person isn&apos;t listed, click <strong>＋ Add a new contact</strong> right on this form — they&apos;re created and attached when you publish.</li>
        <li>Study title and date.</li>
        <li><strong>Cadence</strong>: &ldquo;Single&rdquo; for a one-time survey. Weekly/monthly/quarterly for recurring trackers.</li>
        <li><strong>Cost type</strong>: credits or dollars — whichever this study is billed in.</li>
        <li><strong>Cost</strong>: a single study takes the <strong>total</strong> cost; a tracker takes the cost of <strong>one run</strong> (billed yearly automatically — weekly ×52, monthly ×12, quarterly ×4), plus an optional one-time <strong>setup cost</strong> (always in credits).</li>
        <li><strong>Rolls up to contract (optional)</strong>: pick which contract this study draws from, so that contract shows its own remaining balance. Leave it as &ldquo;none&rdquo; to keep the study <strong>Unassigned</strong> — it still draws down the client&apos;s overall balance either way.</li>
        <li><strong>Audience, Target N, Actual N delivered, Description</strong> (all optional) — fill in now or later.</li>
        <li>Publish. The client&apos;s balance goes down immediately.</li>
      </ol>
      <p className="muted">Hover any <strong>(i)</strong> icon if you&apos;re unsure what a field means. To edit a study later, open Record a Study for that client and use the existing-studies table — click <strong>Details ▸</strong> on a row to edit its audience / target / actual / description, then <strong>Save all changes</strong>.</p>

      <h3>Add credits to a client</h3>
      <p><strong>Salespeople → Request Credits</strong> (Home → Request Credits): pick the client, enter the credits and/or dollars and a reason, and submit. It goes to the approval queue; once approved the credits land on the client&apos;s balance automatically. Track (or withdraw) your pending requests on the same page.</p>
      <p><strong>Contract managers / admins → Add a Contract</strong> (money in): pick the client, give it a title and date (<strong>renewal</strong> defaults to a year later), enter the <strong>credits</strong> and/or <strong>dollars</strong> (at least one) and an optional description, then <strong>Save Contract</strong>. The balance goes up immediately.</p>

      <h3>Approving credit requests (approvers only)</h3>
      <p className="muted small">Home → Approvals.</p>
      <p>Every pending request from the sales team is listed — client, who asked, amount, reason. <strong>Approve</strong> posts the credits to that client&apos;s balance right away; <strong>Reject</strong> declines it. Recently decided requests appear below.</p>

      <h2>Getting around</h2>
      <p>
        A <strong>navigation ribbon</strong> runs across the top of every page — Home,
        Studies, Contracts, Clients, Contacts, Reports (plus Approvals for approvers and
        Admin for admins). The section you&apos;re on is highlighted, and it stays pinned as
        you scroll. The <strong>search box</strong> finds any client, contract, survey, or
        contact.
      </p>

      <h2>Your home dashboard (Client Pulse)</h2>
      <p>When you sign in, the home page shows a <strong>Client Pulse</strong> dashboard under the two action tiles:</p>
      <ul>
        <li><strong>Four quick numbers</strong>: clients with a negative balance, clients running low (projected to run out within ~60 days), renewals due in the next 30 days, and this year&apos;s contract value.</li>
        <li><strong>Needs attention</strong>: the &ldquo;who do I call today&rdquo; list — clients negative or running low, worst first. Click a client to jump to their contracts &amp; surveys.</li>
        <li><strong>Renewals due</strong>: the soonest upcoming contract renewals.</li>
      </ul>
      <p>
        If you&apos;re an approver/admin, a <strong>My clients / All clients</strong> toggle
        narrows the dashboard to the clients whose <strong>salesperson</strong> is you, or
        shows everyone. Salespeople always see just their own clients.
      </p>

      <h2>Looking things up</h2>
      <ul>
        <li><strong>Client Balances</strong> (Home → Balances &amp; Reports): every client&apos;s remaining credits and dollars, this year&apos;s contract value, and their next renewal. Click a client for their transaction log, or <strong>Export Credits Summary</strong> for a client-ready PDF (choose the time frame, columns, and which records).</li>
        <li><strong>The transaction log is grouped by contract</strong>: each contract row shows its own <strong>remaining</strong> balance (funding minus the studies that roll up to it — red if over-drawn), with those studies indented beneath. Collapse/expand any contract. Unassigned studies and Adjustments have their own groups. A search box filters that client&apos;s rows instantly, and you can drag the column headers to reorder them.</li>
        <li><strong>Manage Client List</strong>: a client&apos;s full record — contact details, <strong>salesperson</strong>, contacts, and quick links. Every client must have a salesperson; pick one or add a new one right there.</li>
        <li><strong>A contact&apos;s surveys</strong>: click any contact — in the search box, on their client&apos;s record, or in the Contacts list — to see every survey they requested.</li>
        <li><strong>Salespeople</strong> (Home → Clients &amp; Contacts): the salesperson roster. Add a salesperson&apos;s <strong>email</strong> so their &ldquo;my clients&rdquo; view works when they sign in.</li>
      </ul>

      <h2>Fixing mistakes</h2>
      <ul>
        <li><strong>Edits</strong>: contracts and studies can be edited from the client&apos;s pages; every edit records who made it. The ledger&apos;s <em>Edit</em> jumps you to the exact row.</li>
        <li><strong>Corrections</strong>: on a client&apos;s transaction log, contract managers can record an <strong>adjustment</strong> (a new signed row) — history is never rewritten.</li>
        <li><strong>Deleting = archiving.</strong> Nothing is ever destroyed: &ldquo;deleting&rdquo; a client, contract, or study hides it and removes it from balances, but the history is kept and an admin can restore it.</li>
      </ul>

      <h2>Admin-only (David, Tedi, Nachi)</h2>
      <p>Click <strong>Admin</strong> in the top nav for the Administration hub:</p>
      <ul>
        <li><strong>Audit Log</strong> — every change and denied attempt, by whom, when.</li>
        <li><strong>Import Data</strong> — upload a spreadsheet (CCM template or Survey Ops export) with a full preview before anything applies. Empty cells never overwrite; nothing is deleted by an import.</li>
        <li><strong>Sync from SOCC</strong> — stamp each survey&apos;s current SOCC stage from a Survey Ops export. Status only; never touches money.</li>
        <li><strong>Export Data</strong> — a ZIP of everything: a re-importable workbook plus a raw ledger.</li>
        <li><strong>AlphaROC Team</strong> — invite @alpharoc.ai staff and manage who&apos;s an admin.</li>
        <li><strong>Salespeople</strong> — manage the salesperson roster and their emails (the email ties a salesperson to their clients and their &ldquo;my clients&rdquo; view).</li>
        <li><strong>View as user</strong> — see CCM exactly as a teammate does, to confirm they only see their own clients. It&apos;s <strong>read-only</strong> (a banner stays until you exit) and ends on its own after two hours.</li>
      </ul>

      <h2>Quick rules that keep the data clean</h2>
      <ol>
        <li><strong>One client, one record</strong> — search before adding a client; codes (Cl#####) tie clients to the Survey Ops tracker.</li>
        <li><strong>Studies get attributed</strong> to the client-side contact who requested them.</li>
        <li><strong>Price studies promptly</strong> — a 0-credit study is unbilled work.</li>
        <li><strong>Never re-type history to fix a mistake</strong> — edit the row (it&apos;s tracked) or ask an admin.</li>
      </ol>
    </div>
  );
}
