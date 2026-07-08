"""One-off data migration: legacy SQLite prototype -> PostgreSQL.

Reads the old Prisma/SQLite database (``prisma/budget.db`` by default) and
loads its rows into the Postgres schema defined in ``db/schema.sql``.

Design notes
------------
- Primary keys are preserved so foreign keys stay intact; tables are loaded
  in dependency order and the ``SERIAL`` sequences are bumped afterwards.
- Prisma stored SQLite ``DateTime`` as integer epoch milliseconds; those are
  converted to UTC ``timestamp`` strings (millisecond precision).
- No third-party Python packages: SQLite is read with the stdlib and the
  Postgres side is loaded by piping a single transactional script to
  ``psql`` (which must be on PATH). The schema is *not* created here — run
  ``npm run db:init`` first.
- Safe by default: aborts if any target table already has rows, unless
  ``--truncate`` is given.
"""

import argparse
import csv
import io
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone

# Load order matters: parents before children (FK dependencies).
TABLES = [
    ("clients", [
        "id", "name", "became_client_on", "primary_contact_name",
        "primary_contact_cell", "primary_contact_email",
        "relationship_manager", "created_by_email", "created_at",
    ]),
    ("client_users", [
        "id", "client_id", "name", "email", "created_by_email", "created_at",
    ]),
    ("transactions", [
        "id", "client_id", "kind", "name", "occurred_on", "renewal_on",
        "credits_delta", "dollars_delta", "cadence", "cost_per_run",
        "setup_cost", "client_user_id", "actor_email", "note", "created_at",
    ]),
    ("transaction_users", ["id", "transaction_id", "client_user_id"]),
]

# Columns that hold epoch-millisecond integers in the SQLite source.
DATE_COLUMNS = {
    "became_client_on", "created_at", "occurred_on", "renewal_on",
}


def ms_to_timestamp(value):
    """Convert epoch milliseconds to a UTC timestamp string.

    Parameters
    ----------
    value : int or float or None
        Milliseconds since the Unix epoch, as Prisma stored SQLite
        ``DateTime`` values.

    Returns
    -------
    str or None
        ``'YYYY-MM-DD HH:MM:SS.mmm'`` in UTC, or ``None`` if `value`
        is ``None``.
    """
    if value is None:
        return None
    dt = datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M:%S.") + f"{dt.microsecond // 1000:03d}"


def read_table(conn, table, columns):
    """Read every row of `table` from SQLite, converting date columns.

    Parameters
    ----------
    conn : sqlite3.Connection
        Open connection to the source database.
    table : str
        Table name to read.
    columns : list of str
        Column order to select and emit.

    Returns
    -------
    list of list
        Row values in `columns` order, with epoch-ms columns converted
        to UTC timestamp strings.
    """
    cur = conn.execute(f'SELECT {", ".join(columns)} FROM "{table}"')
    rows = []
    for raw in cur.fetchall():
        row = []
        for col, val in zip(columns, raw):
            row.append(ms_to_timestamp(val) if col in DATE_COLUMNS else val)
        rows.append(row)
    return rows


def to_csv(rows):
    """Serialise rows to a CSV blob for ``COPY ... FROM STDIN``.

    Parameters
    ----------
    rows : list of list
        Row values; ``None`` is emitted as an unquoted empty field so
        Postgres reads it as SQL ``NULL`` (CSV ``FORCE_NULL`` style via
        an explicit ``NULL ''`` is not needed because csv writes empty).

    Returns
    -------
    str
        CSV text, one record per line.
    """
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    for row in rows:
        writer.writerow(["" if v is None else v for v in row])
    return buf.getvalue()


def build_script(conn, truncate):
    """Build the transactional SQL script that loads every table.

    Parameters
    ----------
    conn : sqlite3.Connection
        Open SQLite source connection.
    truncate : bool
        Whether to ``TRUNCATE`` the target tables before loading.

    Returns
    -------
    tuple of (str, dict)
        The SQL script text and a ``{table: row_count}`` summary.
    """
    parts = ["BEGIN;", "SET CONSTRAINTS ALL DEFERRED;"]
    counts = {}
    if truncate:
        names = ", ".join(t for t, _ in TABLES)
        parts.append(f"TRUNCATE {names} RESTART IDENTITY CASCADE;")
    for table, columns in TABLES:
        rows = read_table(conn, table, columns)
        counts[table] = len(rows)
        if not rows:
            continue
        collist = ", ".join(columns)
        parts.append(
            f"COPY {table} ({collist}) FROM STDIN WITH (FORMAT csv, NULL '');"
        )
        parts.append(to_csv(rows).rstrip("\n"))
        parts.append("\\.")
    # Bump every SERIAL sequence past the imported ids.
    for table, _ in TABLES:
        parts.append(
            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
            f"COALESCE((SELECT MAX(id) FROM {table}), 1), "
            f"(SELECT COUNT(*) FROM {table}) > 0);"
        )
    parts.append("COMMIT;")
    return "\n".join(parts) + "\n", counts


def target_rowcounts(database_url):
    """Return current row counts for each target table.

    Parameters
    ----------
    database_url : str
        Postgres connection string.

    Returns
    -------
    dict
        ``{table: int}`` row counts (0 if the query fails for a table).
    """
    query = " UNION ALL ".join(
        f"SELECT '{t}' AS t, COUNT(*) AS n FROM {t}" for t, _ in TABLES
    )
    out = subprocess.run(
        ["psql", database_url, "-tAF,", "-v", "ON_ERROR_STOP=1", "-c", query],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"Could not read target DB:\n{out.stderr.strip()}")
    counts = {}
    for line in out.stdout.strip().splitlines():
        name, n = line.split(",")
        counts[name] = int(n)
    return counts


def main():
    """Parse arguments and run the migration."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sqlite", default="prisma/budget.db",
                    help="source SQLite file (default: prisma/budget.db)")
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"),
                    help="target Postgres URL (default: $DATABASE_URL)")
    ap.add_argument("--truncate", action="store_true",
                    help="wipe target tables before loading")
    ap.add_argument("--dry-run", action="store_true",
                    help="print what would be migrated and exit")
    args = ap.parse_args()

    if not args.database_url:
        sys.exit("Set DATABASE_URL or pass --database-url.")
    if not os.path.exists(args.sqlite):
        sys.exit(f"SQLite file not found: {args.sqlite}")

    conn = sqlite3.connect(args.sqlite)
    script, counts = build_script(conn, args.truncate)
    conn.close()

    print("Source rows:", ", ".join(f"{t}={n}" for t, n in counts.items()))

    if args.dry_run:
        print("--dry-run: no changes written.")
        return

    existing = target_rowcounts(args.database_url)
    nonempty = {t: n for t, n in existing.items() if n > 0}
    if nonempty and not args.truncate:
        sys.exit(
            "Target is not empty: "
            + ", ".join(f"{t}={n}" for t, n in nonempty.items())
            + "\nRe-run with --truncate to replace it."
        )

    proc = subprocess.run(
        ["psql", args.database_url, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
        input=script, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"Migration failed:\n{proc.stderr.strip()}")

    after = target_rowcounts(args.database_url)
    print("Loaded:", ", ".join(f"{t}={after.get(t, 0)}" for t, _ in TABLES))
    print("Migration complete.")


if __name__ == "__main__":
    main()
