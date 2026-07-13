"""Load a CCM backup JSON into a target Postgres (Neon -> Supabase -> AWS).

The app is plain Postgres, so moving hosts is: apply schema.sql to the target,
load the data from a backup produced by backup-neon.py, and reset sequences.
Idempotent-ish: each table is TRUNCATEd before load, so re-running is safe.

Order respects FKs; clients' self-referential parent_id is applied in a second
pass so a child can load before its parent. Money is restored as exact
Decimals, bytea from base64, timestamps as datetimes.

Usage (from client_management/):
    TARGET_DATABASE_URL="postgresql://...supabase..." \
      backend/.venv/Scripts/python.exe .devstack/migrate-db.py .backups/ccm-db-backup-<date>.json

Add --dry-run to load into the target and print counts WITHOUT committing.
"""

import asyncio
import base64
import datetime as dt
import decimal
import json
import os
import sys
from pathlib import Path

import asyncpg

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "backend" / "app" / "schema.sql"

# FK-safe load order. clients loads before its own parent_id links (2nd pass);
# transactions.contract_id/reverses_transaction_id are plain ints (no FK).
ORDER = [
    "salespeople",
    "clients",
    "client_users",
    "transactions",
    "transaction_users",
    "contract_attachments",
    "attachment_blobs",
    "credit_requests",
]
# Tables whose integer id is a SERIAL whose sequence must be bumped past max(id).
SERIAL_TABLES = [
    "salespeople",
    "clients",
    "client_users",
    "transactions",
    "transaction_users",
    "contract_attachments",
    "credit_requests",
]


def decode(v):
    if isinstance(v, dict):
        if "__decimal__" in v:
            return decimal.Decimal(v["__decimal__"])
        if "__ts__" in v:
            return dt.datetime.fromisoformat(v["__ts__"])
        if "__bytea_b64__" in v:
            return base64.b64decode(v["__bytea_b64__"])
        if "__repr__" in v:
            return v["__repr__"]
    return v


async def apply_schema(conn) -> None:
    raw = SCHEMA_PATH.read_text(encoding="utf-8")
    sql = "\n".join(
        ln for ln in raw.splitlines() if not ln.strip().startswith("--")
    )
    for stmt in (s.strip() for s in sql.split(";")):
        if stmt:
            await conn.execute(stmt)


async def load_table(conn, name: str, rows: list[dict], *, defer_cols: set[str]):
    if not rows:
        print(f"  {name}: 0 rows (skip)")
        return
    cols = list(rows[0].keys())
    ins_cols = [c for c in cols if c not in defer_cols]
    placeholders = ", ".join(f"${i + 1}" for i in range(len(ins_cols)))
    quoted = ", ".join(f'"{c}"' for c in ins_cols)
    stmt = f'INSERT INTO "{name}" ({quoted}) VALUES ({placeholders})'
    records = [tuple(decode(r.get(c)) for c in ins_cols) for r in rows]
    await conn.executemany(stmt, records)
    print(f"  {name}: {len(rows)} rows" + (f" (deferred {sorted(defer_cols)})" if defer_cols else ""))


async def main(json_path: str, dry_run: bool) -> None:
    target = os.environ["TARGET_DATABASE_URL"].replace(
        "postgresql+asyncpg://", "postgresql://", 1
    )
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    tables = data["tables"]

    conn = await asyncpg.connect(target, statement_cache_size=0)
    tx = conn.transaction()
    await tx.start()
    try:
        print("applying schema.sql to target…")
        await apply_schema(conn)

        # Clear in reverse FK order so children go before parents.
        for name in reversed(ORDER):
            if name in tables:
                await conn.execute(f'TRUNCATE "{name}" CASCADE')

        print("loading rows…")
        for name in ORDER:
            rows = tables.get(name, [])
            # Defer clients.parent_id (self-FK) to a second pass.
            defer = {"parent_id"} if name == "clients" else set()
            await load_table(conn, name, rows, defer_cols=defer)

        # 2nd pass: apply clients.parent_id now that every client row exists.
        links = [
            (decode(r["id"]), decode(r["parent_id"]))
            for r in tables.get("clients", [])
            if r.get("parent_id") not in (None, {})
        ]
        for cid, pid in links:
            await conn.execute("UPDATE clients SET parent_id=$2 WHERE id=$1", cid, pid)
        if links:
            print(f"  clients.parent_id: linked {len(links)}")

        # Bump each SERIAL sequence past the loaded max(id).
        for name in SERIAL_TABLES:
            if tables.get(name):
                await conn.execute(
                    f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM \"{name}\"), 1))"
                )

        # Verify counts WHILE the transaction is still open (the rows are
        # visible within it), so this works for both dry-run and real runs and
        # can abort a real load on any mismatch before it commits.
        print("verify (in-transaction counts):")
        all_ok = True
        for name in ORDER:
            n = await conn.fetchval(f'SELECT COUNT(*) FROM "{name}"')
            src = len(tables.get(name, []))
            ok = n == src
            all_ok = all_ok and ok
            print(f"  {name}: {n} " + ("OK" if ok else f"MISMATCH src={src}"))
        if not all_ok:
            raise RuntimeError("row-count mismatch vs backup — aborting, nothing committed")

        if dry_run:
            print("DRY RUN — rolling back (nothing persisted).")
            await tx.rollback()
        else:
            await tx.commit()
            print("COMMITTED.")
    except Exception:
        try:
            await tx.rollback()
        except Exception:
            pass  # already rolled back / connection gone
        raise
    finally:
        await conn.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    asyncio.run(main(args[0], "--dry-run" in sys.argv))
