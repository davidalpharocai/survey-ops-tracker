# Demo data — what's fabricated vs real

Seeded **2026-07-09** to make the Friday demo compelling (the SOCC import
left every client at a $0 balance). This file records exactly what is
demo/dummy so it can be removed cleanly before real use.

## What is REAL
- **All 62 clients** (incl. BAM, HingeVoter/Carah) came from the SOCC
  export — real client names/codes. Do **not** delete clients.
- **All contacts** are real/import-created (incl. the `(Unassigned)`
  placeholder contacts the seeded studies were attributed to).
- **Every study with a $0 credit/dollar cost** is a real SOCC-imported
  placeholder (import left costs at 0). Not demo — just unpriced.

## What is DEMO (fabricated — safe to delete)
Only these 7 transactions were hand-created for the demo. Everything else
predates them.

### BAM — client id 38 (demonstrates *multiple contracts at once*)
| txn id | kind | name | credits |
|--------|------|------|---------|
| 223 | contract | 2026 Research Retainer | +18,000 |
| 229 | contract | H2 Expansion - Custom Studies | +8,000 |
| 224 | study | Q2 Institutional Sentiment Tracker | -2,400 |
| 225 | study | Sector Rotation Pulse - Energy | -1,800 |

→ combined funding 26,000, balance **21,800**.

### HingeVoter/Carah — client id 20 (demonstrates *surveys drawing on one contract*)
| txn id | kind | name | credits |
|--------|------|------|---------|
| 226 | contract | 2026 Polling Program | +12,000 |
| 227 | study | Swing-State Likely-Voter Wave 1 | -1,500 |
| 228 | study | Message Testing - Economy | -1,100 |

→ funding 12,000, balance **9,400**.

## How to remove the demo data
The seeded rows carry no special flag (kept out of the `note` field so
nothing "DEMO" shows in the client-facing ledger/PDF). Remove by id.

Soft-delete via the API (preserves history, disappears from all views):
```
DELETE /api/contracts/223   DELETE /api/contracts/229
DELETE /api/studies/224     DELETE /api/studies/225
DELETE /api/contracts/226
DELETE /api/studies/227     DELETE /api/studies/228
```
(send `X-Internal-Auth` + an admin `X-User-Email`)

Or hard-delete in SQL:
```sql
DELETE FROM transactions WHERE id IN (223,224,225,226,227,228,229);
```

The `(Unassigned)` contacts and the clients themselves should stay.

> Note: transaction ids are stable, but if the DB is ever reseeded from
> the SOCC export the ids will differ — match on the names above instead.
