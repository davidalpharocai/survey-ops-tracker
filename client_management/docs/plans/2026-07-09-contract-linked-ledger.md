# Contract-Linked Ledger Implementation Plan

> **For agentic workers:** implement task-by-task, test-first. Steps use `- [ ]` tracking.

**Goal:** Let each study optionally roll up to one contract, and show a client's ledger grouped by contract with per-contract remaining balances — without changing any existing balance/report math.

**Architecture:** Add a nullable self-referential `transactions.contract_id`. Validate the link (same client, is-contract, active) on study create/edit. Add a read-only grouped `GET /api/clients/{id}/ledger` that computes per-contract remaining. Guard contract archive against active linked studies. Frontend: render the grouped tree on the Transaction Log page with a contract picker on the study form and an instant per-client filter.

**Tech Stack:** FastAPI · async SQLAlchemy · Postgres (idempotent `schema.sql`) · Next.js 15 App Router · pytest · vitest.

**Spec:** `client_management/docs/specs/2026-07-09-contract-linked-ledger-design.md`

---

## Phase 1 — schema + model + link validation

### Task 1: `contract_id` column + model
**Files:** Modify `backend/app/schema.sql`, `backend/app/models.py`

- [ ] Add to `schema.sql` (after the transactions table, with the other `ALTER ... ADD COLUMN IF NOT EXISTS`):
```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS transactions_contract_id_idx ON transactions(contract_id);
```
- [ ] Add to `Transaction` model (after `reverses_transaction_id`):
```python
contract_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
```
- [ ] Add `"contractId": t.contract_id,` to `transaction_dict` output in `serializers.py`.
- [ ] Run `pytest -q` (schema applies in the test DB) — expect existing 181 still pass.
- [ ] Commit: `feat(ccm): add nullable transactions.contract_id (study→contract link)`

### Task 2: link validation on study create
**Files:** Modify `backend/app/schemas.py`, `backend/app/routers/studies.py`; Test `backend/tests/test_contract_link.py`

- [ ] Add `contract_id: int | None = None` to `StudyIn`.
- [ ] Write failing test `test_create_study_links_to_contract`:
```python
async def test_create_study_links_to_contract(client):
    c = await make_client(client); u = await make_user(client, c["id"])
    con = await make_contract(client, c["id"], name="Retainer", credits_amount=1000)
    r = await client.post("/api/studies", json={
        "client_id": c["id"], "name": "S1", "occurred_on": "2024-03-01",
        "cost_type": "credits", "cost": 100, "client_user_ids": [u["id"]],
        "contract_id": con["id"],
    }, headers=ADMIN)
    assert r.status_code == 201, r.text
    assert r.json()["contractId"] == con["id"]
```
- [ ] Write failing test `test_create_study_rejects_foreign_contract` (contract of another client → 400) and `test_create_study_rejects_non_contract` (pointing contract_id at a study id → 400).
- [ ] Add helper in `studies.py`:
```python
async def _resolve_contract_id(session, contract_id, client_id):
    if contract_id is None:
        return None
    con = await session.get(Transaction, contract_id)
    if (con is None or con.deleted_at is not None
            or con.kind != "contract" or con.client_id != client_id):
        raise HTTPException(400, "Pick a contract that belongs to this client.")
    return contract_id
```
- [ ] In `create_study`, after client resolve: `contract_id = await _resolve_contract_id(session, body.contract_id, client.id)` and set `contract_id=contract_id` on the `Transaction(...)`.
- [ ] Run the 3 tests → PASS. Run full `pytest -q`. Commit.

### Task 3: link validation on study edit
**Files:** Modify `backend/app/routers/studies.py`; Test append to `test_contract_link.py`

- [ ] Failing test `test_update_study_reassigns_and_unlinks` (PATCH to a valid contract sets it; PATCH with `contract_id=null` clears it; PATCH to a foreign contract → 400).
- [ ] In `update_study`, resolve+validate `body.contract_id` (same helper) and assign `t.contract_id`. Treat missing key as "leave unchanged" only if the form always sends it; since `StudyIn` defaults `None`, the study form MUST send the current value (frontend Task 8). Document: `None` = unlink.
- [ ] Run tests → PASS. Full `pytest -q`. Commit.

---

## Phase 2 — grouped ledger endpoint + archive guard

### Task 4: `GET /api/clients/{id}/ledger`
**Files:** Modify `backend/app/routers/reports.py` (or new `routers/ledger.py` + register in `main.py`); Test `backend/tests/test_ledger.py`

- [ ] Failing test `test_ledger_groups_studies_under_contracts`:
```python
async def test_ledger_groups_studies_under_contracts(client):
    c = await make_client(client); u = await make_user(client, c["id"])
    con = await make_contract(client, c["id"], name="Retainer", credits_amount=1000)
    await make_study(client, c["id"], [u["id"]], name="Linked", cost=300, contract_id=con["id"])
    await make_study(client, c["id"], [u["id"]], name="Loose", cost=100)  # unassigned
    r = await client.get(f"/api/clients/{c['id']}/ledger", headers=ADMIN)
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["contracts"]) == 1
    assert d["contracts"][0]["remainingCredits"] == 700  # 1000 - 300
    assert [s["name"] for s in d["contracts"][0]["studies"]] == ["Linked"]
    assert [s["name"] for s in d["unassigned"]] == ["Loose"]
```
- [ ] Extend `make_study` factory in `conftest.py` to pass through `contract_id` via `**overrides` (already supported — just document).
- [ ] Failing test `test_ledger_invariant_matches_client_total` (sum of per-contract remaining + unassigned + adjustments == `clientBalances.credits`/`.dollars`), and `test_ledger_overdrawn_contract_negative`.
- [ ] Implement endpoint: load active client (`_active_client_or_404`); one query for all non-deleted transactions of the client; bucket by kind; for each contract compute `remainingCredits = credits_delta + Σ linked studies.credits_delta` (same dollars); assemble `{contracts:[{...transaction_dict, remainingCredits, remainingDollars, studies:[...]}], unassigned:[...], adjustments:[...], totals:{credits,dollars}}`. Studies serialized with `with_client_user=True`.
- [ ] Run tests → PASS. Full `pytest -q`. Commit.

### Task 5: block archiving a contract with active linked studies
**Files:** Modify `backend/app/routers/contracts.py` (`delete_contract`); Test append to `test_contract_link.py`

- [ ] Failing test `test_cannot_archive_contract_with_active_linked_studies` (contract with a linked active study → DELETE 409) and `test_can_archive_contract_after_studies_archived` (archive the study first → contract archives 200).
- [ ] In `delete_contract`, before soft-deleting, count active linked studies:
```python
count = await session.scalar(
    select(func.count()).select_from(Transaction).where(
        Transaction.contract_id == txn_id,
        Transaction.deleted_at.is_(None),
    )
)
if count and count > 0:
    raise HTTPException(status_code=409, detail=(
        f"Can't archive this contract — {count} active study/studies still "
        "roll up to it. Reassign or archive those first."))
```
- [ ] Run tests → PASS. Full `pytest -q`. Commit. Deploy backend; re-apply schema to Neon (adds `contract_id`).

---

## Phase 3 — frontend tree, picker, search

### Task 6: api client + types
**Files:** Modify `frontend/lib/api.ts`, `frontend/lib/types.ts`

- [ ] Add `contractId: number | null` to the `Transaction`/`StudyTransaction` types; add `LedgerGroup`/`Ledger` types matching the endpoint.
- [ ] Add `clientLedger(clientId): Promise<Ledger>` → `r('GET', '/api/clients/${clientId}/ledger')` and `contractId` to create/update study payloads. tsc.

### Task 7: ledger tree component
**Files:** Create `frontend/app/reports/transactions/LedgerTree.tsx` (client component); Modify `frontend/app/reports/transactions/page.tsx`; Test `frontend/__tests__/ledgerTree.test.ts`
- [ ] Vitest for the pure grouping/filter helper: `filterLedger(ledger, q)` keeps a contract if it or any of its studies matches (name/`PR#####`, case-insensitive); keeps matching unassigned/adjustments.
- [ ] `LedgerTree`: render each contract as a parent row (name · funding · **remaining** in red when <0 · renewal) with a collapse toggle; studies indented; "Expand/Collapse all"; Unassigned + Adjustments groups; a search `<input type="search">` bound to `filterLedger`. `(i)` `InfoTooltip` on remaining/Unassigned.
- [ ] `page.tsx`: fetch `api.clientLedger(clientId)` (404-safe via `onlyNotFound`), render `<LedgerTree>` instead of the flat table. Keep the balances header + Add-adjustment form.

### Task 8: contract picker on study form
**Files:** Modify `frontend/app/studies/new/NewStudyForm.tsx`, `frontend/app/studies/new/page.tsx`, study actions, `ExistingStudiesTable.tsx`
- [ ] Pass the client's active contracts into `NewStudyForm`; add a `<select name="contract_id">` with "— none —" default; include `contract_id` in `createStudyAction`. On the edit path, preselect the study's current `contractId` and always submit the field (so blank = unlink, per Task 3).
- [ ] tsc + `npx vitest run` + `npx next build` → all green. Commit. Deploy frontend.

---

## Self-review notes
- **Spec coverage:** US-1→Task 1; US-2→Tasks 2/8; US-3→Tasks 4/7; US-4→Task 7; US-5→Tasks 7; US-6→Tasks 4/7; US-7→Task 5; US-8→Task 4 invariant test. All covered.
- **Type consistency:** `contractId` (JSON) / `contract_id` (py+form) used consistently; `remainingCredits`/`remainingDollars` used in both Task 4 and Task 7.
- **No report math changes:** Balance Health / Renewal Radar / balances endpoints untouched; ledger is a separate read.
