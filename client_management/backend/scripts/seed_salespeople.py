"""One-off, idempotent seed: create salespeople from the existing free-text
``clients.relationship_manager`` values and link each active client to the
matching salesperson.

Emails are intentionally left blank — set them on the /salespeople roster
page so the "my clients" dashboard default works (a wrong guessed email
would silently misroute a rep's view).

Usage (DSN from the environment; never commit the DSN):

    DATABASE_URL=postgresql://... python scripts/seed_salespeople.py

Safe to re-run: existing salespeople are reused (case-insensitive) and only
clients that are not yet linked get updated.
"""

import asyncio
import os

import asyncpg


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL", "").split("?", 1)[0]
    if not dsn:
        raise SystemExit("Set DATABASE_URL to the target database.")
    ssl = "require" if "neon.tech" in dsn or "amazonaws" in dsn else None
    conn = await asyncpg.connect(dsn, ssl=ssl, statement_cache_size=0)
    try:
        names = [
            r["rm"]
            for r in await conn.fetch(
                "SELECT DISTINCT btrim(relationship_manager) AS rm FROM clients "
                "WHERE deleted_at IS NULL AND relationship_manager IS NOT NULL "
                "AND btrim(relationship_manager) <> '' ORDER BY 1"
            )
        ]
        created, linked = 0, 0
        for name in names:
            sp_id = await conn.fetchval(
                "SELECT id FROM salespeople WHERE lower(name)=lower($1) "
                "AND deleted_at IS NULL",
                name,
            )
            if sp_id is None:
                sp_id = await conn.fetchval(
                    "INSERT INTO salespeople (name, active) VALUES ($1, TRUE) "
                    "RETURNING id",
                    name,
                )
                created += 1
            n = await conn.fetchval(
                "WITH upd AS ("
                "  UPDATE clients SET salesperson_id=$1, salesperson_name=$2 "
                "  WHERE deleted_at IS NULL AND salesperson_id IS NULL "
                "  AND lower(btrim(relationship_manager))=lower($2) RETURNING 1"
                ") SELECT count(*) FROM upd",
                sp_id,
                name,
            )
            linked += n or 0
            print(f"  {name!r}: salesperson #{sp_id}, linked {n} client(s)")
        print(f"\nDone. Created {created} salespeople, linked {linked} clients.")
    finally:
        await conn.close()


asyncio.run(main())
