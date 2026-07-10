# Parent-Child (Macro/Micro) Accounts — Design

*CCM · 2026-07-10 · status: approved (brainstorm), pending implementation plan*

## Problem

Some clients are subsidiaries of a larger account (real examples in the data:
Millennium → Black Kite Capital; Junction.AI → Main Fraim). Sales want to view
balances at a **parent (macro)** level — the whole relationship — or at a
**child (micro)** level — one entity. Today there is no link between clients.

## Decisions (locked with David, 2026-07-10)

1. **Money model — aggregate / rollup.** Each child keeps its own contracts,
   credits, studies, and balance exactly as today. The parent shows a
   **read-only sum** of its children plus any contracts on the parent itself.
   There is **no shared credit pool**; nothing changes about how any client is
   funded. The rollup is purely additive reporting.
2. **Shape — flat, one level.** Parent → Child only. A parent is itself a normal
   client that can also hold its own contracts/studies. Contacts live on both
   levels (each is a client with its own contact roster; the macro view can show
   them together). No grandchildren.
3. **Visibility — strictly per-client (no change to the scoping wall).** A
   restricted salesperson sees a parent or child only if they own it. A parent
   owner's rollup includes only the children they **also** own; children owned by
   other reps are excluded and the total is labeled "your clients in this
   family" so a partial sum never reads as the true total. Admins / approvers /
   full-access see the complete rollup.
4. **Where it lives — both surfaces.** (a) A "This account / Include children"
   toggle on the Contracts & Surveys (balances/ledger) view; (b) a family-summary
   card on the parent's Manage Client List record. Children link up to their
   parent.

## Data model

One new nullable self-reference on `clients`:

```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent_id INTEGER
    REFERENCES clients(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS clients_parent_id_idx ON clients (parent_id);
```

- `parent_id IS NULL` → top-level client.
- **No denormalized parent-name snapshot.** Parent names resolve by lookup
  (the client list is already loaded on the surfaces that need it). This avoids
  the snapshot-propagation bugs seen with the salesperson denormalization.

### Flat-hierarchy invariants (enforced in the application layer; 400 on violation)

Setting `clients[C].parent_id = P` is rejected unless all hold:

1. `P != C` (no self-parent).
2. `clients[P].parent_id IS NULL` — the chosen parent must itself be top-level,
   so no third level can form.
3. `C` has **no children** of its own (no row has `parent_id = C`) — a parent
   cannot also become a child.

These three rules make cycles impossible at one level, so no recursive cycle
check is needed.

## Backend

### Model / serializer
- `Client.parent_id: Mapped[int | None]`.
- `client_dict` emits `parentId` (int | null). Parent/children names are
  resolved by the endpoints/pages that need them, not stored.

### Assign a parent — `PATCH /api/clients/{id}`
- Accepts optional `parent_id` (int or null; null detaches).
- Validated against the three invariants above.
- **Requires unrestricted** (admin / approver / full-access) — same rule as
  salesperson reassignment. Setting account structure is not a restricted rep's
  call. A restricted rep's PATCH that includes a `parent_id` change is 403.

### Family rollup — `GET /api/clients/{id}/family`
Returns everything both UI surfaces need, fully scoped through the existing
`AccessScope`:

```json
{
  "client":   { "id": 30, "name": "Millennium" },
  "parent":   null,                       // or { "id", "name" } if this client is a child
  "children": [ { "id", "name", "credits", "dollars", "cyValue", "cyRenewal" } ],
  "rollup":   { "credits", "dollars", "cyCredits", "cyValue", "nextRenewal" },
  "partial":  false
}
```

- `children` is filtered by `scope.client_filter()` — children the caller can't
  see are omitted, and `partial` is set `true` when any were omitted.
- `parent` is **also scoped**: it is `null` when the caller can't see the parent
  (e.g. a restricted rep owns this child but a different rep owns the parent), so
  the "Part of [Parent] ↑" link only appears when the parent is actually openable.
- `rollup` = the client's own balance **+** every visible child's balance.
  `nextRenewal` is the soonest renewal across the visible family.
- Reuses the existing per-client balance computation for each member (no new
  money math — it sums the same numbers the balances endpoint already returns).

### Archive guard
Archiving (soft-deleting) a client that still has **active children** returns
`409` ("Detach or reassign its sub-accounts first"), mirroring the
contract-with-linked-studies guard. Prevents children pointing at a hidden
parent.

### Merge compatibility
The existing merge RPC must handle `parent_id` so a merge can't strand a link:
- children whose `parent_id` = the merged-away (loser) client are repointed to
  the survivor;
- if the loser had a `parent_id`, the survivor inherits it only when it has none
  (respecting the flat invariants; skip if it would violate them).

## Frontend

### Manage Client List — edit form (`app/clients/page.tsx`)
- New **"Parent account (optional)"** picker: a `<select>` of eligible parents
  (top-level clients, excluding this client and any client that already has a
  parent). Unrestricted-only (hidden/disabled for restricted reps, matching the
  salesperson picker rule).
- When the selected client **is a child**, show **"Part of [Parent] ↑"** linking
  to the parent's record.

### Manage Client List — parent's record: family-summary card
- When the selected client **has children**, render a card listing each child
  with its credits/dollars balance and a **combined total** row; each child name
  links to its own record. For a restricted rep, only owned children appear,
  with a "your clients in this family" note when `partial`.

### Contracts & Surveys / balances (`app/reports/transactions/page.tsx`)
- When the selected client **is a parent**, show a **"This account / Include
  children"** toggle (client-side, remembered per device like the other pulse
  toggles):
  - *This account* — the current view unchanged (parent's own balance tiles +
    its own ledger tree).
  - *Include children* — the balance tiles show the **family rollup**, followed
    by a **children breakdown table** (name · credits · dollars · next renewal ·
    link to that child's own ledger). The rollup does **not** merge every child's
    transactions into one tree — you drill into a child for its detail. Labeled
    "your clients in this family" for a restricted rep when `partial`.
- When the selected client **is a child**, show the "Part of [Parent] ↑" link.

### Types / API
- `Client` gains `parentId?: number | null`.
- New `api.clientFamily(id)` → the `/family` shape; a `Family` type.
- A small pure helper (unit-tested) computes/labels the rollup client-side if any
  formatting is needed beyond what the endpoint returns.

## Scope boundaries (explicitly unchanged)
- Per-client balances, Balance Health, Renewal Radar, and the Client Balances
  **list** are untouched — every client stays its own row; the list is **not**
  nested. The rollup is a separate, additive view.
- No shared credit pool, no nesting beyond one level, no relaxation of the
  scoping wall, no denormalized parent snapshot.

## Testing

**Backend (pytest):**
- `parent_id` set/detach happy path; serializer emits `parentId`.
- Flat invariants each rejected (self-parent; parent-that-is-a-child;
  parent-a-client-that-already-has-children) → 400.
- `require_unrestricted` on parent assignment → 403 for a restricted rep.
- `/family` rollup math: parent + children sum; `nextRenewal` soonest across
  family.
- `/family` scoping: restricted rep sees only owned children + `partial` flag;
  admin sees all, `partial` false.
- Archive guard: archiving a parent with active children → 409.
- Merge repoints children and inherits parent per the rules.

**Frontend (vitest):**
- Rollup/label helper (partial → "your clients in this family").
- (Component-level rendering covered by tsc + build; smoke via preview.)

## Open questions / deferred
- Nesting beyond one level — deferred (YAGNI).
- Merging every child's transactions into one combined ledger tree — deferred;
  drill-down covers it.
- Nesting children under parents in the Client Balances list — deferred (kept
  flat by decision).
