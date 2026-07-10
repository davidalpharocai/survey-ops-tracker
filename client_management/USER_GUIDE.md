# AlphaROC Credit Management — User Guide

*For the sales and product team. Last updated 2026-07-09.*

CCM is where AlphaROC tracks what each client has **bought** (contracts that
add credits and/or dollars) and what they've **used** (studies — surveys —
that draw that balance down). It is the source of truth for client balances,
contract renewals, and credit usage.

## Signing in

Open the app link. Enter your **@alpharoc.ai email** as the username and the
shared team password. Your email is recorded on everything you do, so use
your own.

## The two things you'll do every day

### Record a Study (money out)

Home → **Record a Study**.

1. Pick the **client**.
2. Pick the **contact(s)** on the client's side the study is for. If the
   right person isn't listed, add them first on Manage Client List.
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
8. Publish. The client's balance goes down immediately.

> Hover any **(i)** icon if you're unsure what a field means.

### Add a Contract (money in)

Home → **Add a Contract**.

1. Pick the client, give the contract a title and date.
2. **Renewal date** defaults to one year after the contract date.
3. Enter the **credits** and/or **dollars** the contract grants (at least
   one).
4. Record it. The client's balance goes up immediately.

## Getting around

A **navigation ribbon** runs across the top of every page — Home, Record
Study, Add Contract, Clients, Contacts, Reports (and Admin, for admins). The
section you're on is highlighted. It stays pinned at the top as you scroll.

## Your home dashboard (Client Pulse)

When you sign in, the home page shows a **Client Pulse** dashboard under the
two action tiles:

- **Four quick numbers**: clients with a negative balance, clients running low
  (projected to run out within ~60 days), renewals due in the next 30 days, and
  this year's total dollar contract value.
- **Needs attention**: the "who do I call today" list — clients negative or
  running low, worst first. Click a client to jump to their contracts & surveys.
- **Renewals due**: the soonest upcoming contract renewals.

Up top is a **My clients / All clients** toggle. "My clients" shows only the
clients whose **salesperson** is you (matched by your sign-in email); it's just
a filter — you can always switch to **All clients** and see everyone. Nothing
is hidden from anyone. Your choice is remembered on your device.

For this to know which clients are yours, each client has a **salesperson**
(see below), and that salesperson needs an email on the **Salespeople** page.

## Looking things up

- **Client Balances** (Home → Balances & Reports): every client's remaining
  credits and dollars, this year's contract value, and their next renewal.
  Click a client for their transaction log, or **Download PDF** for a
  client-ready statement.
- **The transaction log is grouped by contract**: each contract is a row
  showing its own **remaining** balance (its funding minus the studies that
  roll up to it — red if over-drawn), with those studies indented beneath it.
  Collapse/expand any contract, or all at once. Studies not tied to a contract
  sit under **Unassigned**; corrections sit under **Adjustments**. A search box
  filters that client's contracts and studies instantly.
- **Manage Client List**: a client's full record — contact details,
  **salesperson**, their contacts, and quick links to add a contract or study.
  Every client must have a salesperson; pick one from the list or add a new one
  right there. (This drives the "my clients" dashboard filter — nothing more.)
- **Salespeople** (Home → Clients & Contacts): the list of salespeople clients
  can be assigned to. Add a salesperson's **email** here so their "my clients"
  view works when they sign in.

## Fixing mistakes

- **Edits**: contracts and studies can be edited from the client's pages;
  every edit records who made it.
- **Deleting = archiving.** Nothing is ever destroyed: "deleting" a client,
  contract, or study hides it from lists and removes it from balances, but
  the history is kept and an admin can restore it. When in doubt, ask an
  admin rather than re-typing history.

## Admin-only (David, Tedi, Nachi)

The **Administration** panel on the home page:

- **Audit Log** — every change and denied attempt, by whom, when.
- **Import Data** — upload a spreadsheet (the CCM template, downloadable on
  the page, or a Survey Ops export). You get a full preview of what will be
  created/updated before anything is applied. Empty cells never overwrite;
  nothing is ever deleted by an import.
- **Export Data** — a ZIP of everything: a re-importable workbook plus a raw
  transaction ledger.
- **AlphaROC Team** — invite @alpharoc.ai staff and manage who's an admin.

## Quick rules that keep the data clean

1. **One client, one record** — search before adding a client; codes
   (Cl#####) tie clients to the Survey Ops tracker.
2. **Studies get attributed** to the client-side contact who requested them.
3. **Price studies promptly** — a 0-credit study is unbilled work.
4. **Never re-type history to fix a mistake** — edit the row (it's tracked)
   or ask an admin.
