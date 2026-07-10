# CCM demo — one-page run-of-show

**Before you start (off-screen, 30 sec):** open **ccm-amber.vercel.app**, sign in, click a
client (e.g. **BAM**) to **warm the database** — first hit after idle is ~5s, then it's instant.

**One-liner:** "CCM is our single source of truth for what each client **buys** (contracts →
credits/dollars) and **uses** (studies draw them down) — and it talks to the Survey Ops tracker."

---

### The flow (~15 min)

1. **Home / Client Pulse (2–3 min)** — the "what do I do today" screen.
   KPIs (negative · running low · renewals 30d · this-year $ + credits) → **Needs attention** →
   **Renewals due**. Flip **My clients / All clients** — *the sales hook: every rep lands on
   their own book, nothing is walled off.*

2. **The daily loop (3–4 min)** — the core of the app.
   - **Add a Contract** for a client → balance jumps up.
   - **Record a Study**, attribute it to a contact, roll it up to that contract → balance drops.

3. **Client ledger (2–3 min)** — BAM → **Contracts & Surveys**.
   Contracts as parent rows with their **own remaining balance**, studies nested beneath;
   collapse/expand, per-client search, drag columns, Edit, **Export Credits Summary** PDF.

4. **Reports = the value (2 min)** — Client Balances · **Balance Health** (burn + run-out) ·
   **Renewal Radar**. *"Don't let a client run dry; don't miss a renewal."*

5. **It's all connected (1 min)** — search "BAM" → click **Nick Amato** → the surveys he requested.

6. **Trust & admin (1–2 min)** — **Admin** hub: Audit Log (everything tracked, by whom) ·
   Import/Export · **Sync from SOCC** (stage relays in). *"Delete = archive — nothing is ever
   destroyed; admins can restore."* Point out **User Guide** in the top-right dropdown.

7. **Roadmap (1 min)** — permanent database home (removes the warm-up) · **V2 "connect your
   Claude"** so sales can ask questions of their own book in plain language.

---

### Keep in your back pocket
- **If asked about the numbers:** balances are partially seeded — the *workflow* is live and real;
  importing the full book is a one-click step (**Admin → Import Data**, with a full preview).
- **Every field has an (i)** — hover to explain anything you're unsure of live.
- **If a page is slow:** it's the free DB waking up (one-time ~5s), not the app — goes away once
  we claim it onto a permanent home.
