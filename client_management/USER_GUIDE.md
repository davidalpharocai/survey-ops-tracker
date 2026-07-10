# AlphaROC Credit Management — User Guide

*For the sales and product team. Last updated 2026-07-10.*

CCM is where AlphaROC tracks what each client has **bought** (contracts that
add credits and/or dollars) and what they've **used** (studies — surveys —
that draw that balance down). It is the source of truth for client balances,
contract renewals, and credit usage.

## Signing in

Open the app link. Enter your **@alpharoc.ai email** as the username and the
shared team password. Your email is recorded on everything you do, so use
your own — it also decides **which clients you see** (below).

## What you can see and do (your role)

CCM now scopes what you see to your role. You don't set this — it follows your
email.

- **Salespeople** see **only their own clients** — the clients whose
  salesperson is you — everywhere in the app (dashboard, balances, search,
  reports). You can **record studies** and **add contacts** on your clients,
  but you **can't add credits directly**: instead you **Request Credits** and
  an approver applies them (below).
- **Approvers** (Vineet, Shanu, David) and **admins** (David, Tedi, Nachi) see
  **all** clients, and approvers review the credit requests.

If a teammate says "I can't find client X," it's almost always because X isn't
assigned to them as salesperson — an admin can set the salesperson on Manage
Client List.

## The things you'll do every day

### Record a Study (money out)

Home → **Record a Study**.

1. Pick the **client**.
2. Pick the **contact(s)** on the client's side the study is for. If the right
   person isn't listed, click **＋ Add a new contact** right on this form —
   they're created and attached to the study when you publish (no need to leave
   for Manage Client List first).
3. Study title and date.
4. **Cadence**: "Single" for a one-time survey. Weekly/monthly/quarterly for
   recurring trackers.
5. **Cost type**: credits or dollars — whichever this study is billed in.
6. **Cost**:
   - Single study → the **total** cost.
   - Tracker → the cost of **one run**. The app bills the yearly total
     automatically (weekly ×52, monthly ×12, quarterly ×4).
   - Trackers can also have a one-time **setup cost** (always in credits).
7. **Rolls up to contract (optional)**: pick which of the client's contracts
   this study draws from, so that contract shows its own remaining balance.
   Leave it as "none" to keep the study **Unassigned** — it still draws down
   the client's overall balance either way.
8. **Audience, Target N, Actual N delivered, Description** (all optional):
   free-text audience, the completes you're aiming for, the completes actually
   delivered, and a short note. Fill these in now or later.
9. Publish. The client's balance goes down immediately.

> Hover any **(i)** icon if you're unsure what a field means.

To edit a study later, open Record a Study for that client and use the
existing-studies table. Click **Details ▸** on a row to edit its Audience /
Target N / Actual N / Description; **Save all changes** saves the table.

### Add credits to a client

**Salespeople → Request Credits.** Home → **Request Credits**: pick the client,
enter the credits and/or dollars to add and a reason, and submit. It goes to
the approval queue; once an approver says yes, the credits land on the client's
balance automatically. You can see the status of your requests (and withdraw a
pending one) on the same page.

**Contract managers / admins → Add a Contract** (money in). Home → **Add a
Contract**:

1. Pick the client, give the contract a title and date.
2. **Renewal date** defaults to one year after the contract date.
3. Enter the **credits** and/or **dollars** the contract grants (at least one).
4. Optional **Description**.
5. **Save Contract**. The client's balance goes up immediately.

### Approving credit requests (approvers only)

Home → **Approvals** (also in the top nav). You'll see every pending request
from the sales team — client, who asked, amount, and reason. **Approve** posts
the credits to that client's balance right away; **Reject** declines it.
Recently decided requests are listed below.

## Getting around

A **navigation ribbon** runs across the top of every page — Home, Studies,
Contracts, Clients, Contacts, Reports (plus Approvals for approvers and Admin
for admins). The section you're on is highlighted; it stays pinned as you
scroll.

## Your home dashboard (Client Pulse)

When you sign in, the home page shows a **Client Pulse** dashboard:

- **Quick numbers**: clients with a negative balance, clients running low
  (projected to run out within ~60 days), renewals due soon, and this year's
  credits and dollar contract value.
- **Needs attention**: the "who do I call today" list — clients negative or
  running low, worst first. Click a client to jump to their contracts & surveys.
- **Renewals due**: the soonest upcoming contract renewals.

If you're an approver/admin, a **My clients / All clients** toggle lets you
narrow the dashboard to the clients whose salesperson is you, or see everyone.
Salespeople always see just their own clients.

## Looking things up

- **Client Balances** (Home → Balances & Reports): each client's remaining
  credits and dollars, this year's contract value, and next renewal. Click a
  client for their transaction log, or **Export Credits Summary** for a
  client-ready PDF (choose the time frame, columns, and which records).
- **The transaction log is grouped by contract**: each contract is a row
  showing its own **remaining** balance (its funding minus the studies that
  roll up to it — red if over-drawn), with those studies indented beneath it.
  Collapse/expand any contract, or all at once. Studies not tied to a contract
  sit under **Unassigned**; corrections sit under **Adjustments**. A search box
  filters that client's contracts and studies instantly.
- **Manage Client List**: a client's full record — contact details,
  salesperson, their contacts, and quick links to add a contract or study.
- **A contact's surveys**: click any contact — in the search box, on their
  client's record, or in the Contacts list — to see every survey they
  requested.

## Fixing mistakes

- **Edits**: contracts and studies can be edited from the client's pages;
  every edit records who made it.
- **Corrections**: on a client's transaction log, contract managers can record
  an **adjustment** (a new, signed ledger row) — history is never rewritten.
- **Deleting = archiving.** Nothing is ever destroyed: "deleting" a client,
  contract, or study hides it from lists and removes it from balances, but the
  history is kept and an admin can restore it. When in doubt, ask an admin
  rather than re-typing history.

## Admin-only (David, Tedi, Nachi)

Click **Admin** in the top nav for the Administration hub:

- **Audit Log** — every change and denied attempt, by whom, when.
- **Recently Archived** — restore archived clients, contacts, contracts, or
  studies.
- **Import Data** — upload a spreadsheet (the CCM template, downloadable on the
  page, or a Survey Ops export). Full preview before anything is applied; empty
  cells never overwrite; nothing is ever deleted by an import.
- **Sync from SOCC** — upload a Survey Ops export to stamp each survey's current
  SOCC stage. Status only; never touches money.
- **Export Data** — a ZIP of everything: a re-importable workbook plus a raw
  transaction ledger.
- **AlphaROC Team** — invite @alpharoc.ai staff and manage who's an admin.
- **Salespeople** — manage the salesperson roster and their emails (the email
  is what ties a salesperson to their clients and their "my clients" view).
- **View as user** — see CCM exactly as a teammate does, to confirm they only
  see their own clients. It's **read-only**: a banner stays on screen and you
  can't change anything until you exit. The session ends on its own after two
  hours.

## Quick rules that keep the data clean

1. **One client, one record** — search before adding a client; codes (Cl#####)
   tie clients to the Survey Ops tracker.
2. **Studies get attributed** to the client-side contact who requested them.
3. **Price studies promptly** — a 0-credit study is unbilled work.
4. **Never re-type history to fix a mistake** — edit the row (it's tracked),
   record an adjustment, or ask an admin.
