"""Full-fidelity logical backup of the CCM Postgres database.

pg_dump is not available on this machine (the embedded Postgres ships only
the server binaries), so this dumps every public base table via asyncpg into
one JSON file. Money (Numeric) columns are preserved as exact decimal STRINGS
(never floats), bytea as base64, timestamps as ISO-8601. Captures all tables,
including the newer contract_attachments / attachment_blobs and the clients
parent_id column.

Usage (from client_management/):
    set -a; . ./.env.preview-secrets; set +a
    backend/.venv/Scripts/python.exe .devstack/backup-neon.py <out.json>
"""

import asyncio
import base64
import datetime as dt
import decimal
import json
import os
import sys
import uuid

import asyncpg


def encode(v):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, decimal.Decimal):
        return {"__decimal__": str(v)}          # exact money, never a float
    if isinstance(v, (dt.datetime, dt.date)):
        return {"__ts__": v.isoformat()}
    if isinstance(v, (bytes, bytearray, memoryview)):
        return {"__bytea_b64__": base64.b64encode(bytes(v)).decode("ascii")}
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, float):
        return v
    return {"__repr__": str(v)}


async def main(out_path: str) -> None:
    raw = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://", 1)
    conn = await asyncpg.connect(raw, statement_cache_size=0)
    try:
        tables = [
            r["tablename"]
            for r in await conn.fetch(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
            )
        ]
        dump = {
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "database": "neon-ccm",
            "server_version": await conn.fetchval("SHOW server_version"),
            "tables": {},
        }
        for t in tables:
            rows = await conn.fetch(f'SELECT * FROM "{t}"')
            dump["tables"][t] = [
                {k: encode(v) for k, v in dict(r).items()} for r in rows
            ]
            print(f"  {t}: {len(rows)} rows")
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(dump, fh, ensure_ascii=False, indent=None)
        total = sum(len(v) for v in dump["tables"].values())
        print(f"OK: {len(tables)} tables, {total} rows -> {out_path}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
