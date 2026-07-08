"""Date and money helpers ported from the frontend's ``lib/dates.js``.

Timestamps are stored as UTC midnight to avoid timezone drift, matching
the convention the Express app established. The ``transactions`` /
``clients`` timestamp columns are ``TIMESTAMP`` *without* time zone, so
every datetime here is a **naive** value representing a UTC instant —
asyncpg rejects tz-aware datetimes for those columns.
"""

from datetime import datetime, timezone


def parse_date(s: str | None) -> datetime | None:
    """Parse a ``YYYY-MM-DD`` string to a UTC-midnight datetime.

    Parameters
    ----------
    s : str or None
        Date string in ISO ``YYYY-MM-DD`` form. Empty or ``None``
        yields ``None``.

    Returns
    -------
    datetime or None
        Naive datetime at UTC midnight (see module docstring), or
        ``None`` when the input is missing or not a valid date.
        Callers that require a date treat unparseable input the same
        as absent and raise their own 400s.
    """
    if not s:
        return None
    try:
        year, month, day = (int(p) for p in str(s).split("-"))
        return datetime(year, month, day)
    except (TypeError, ValueError):
        return None


def add_year(d: datetime) -> datetime:
    """Return the same calendar date one year later.

    Feb 29 maps to Feb 28 of the following year.

    Parameters
    ----------
    d : datetime
        Source date (assumed UTC).

    Returns
    -------
    datetime
        UTC datetime exactly one year after ``d``.
    """
    try:
        return d.replace(year=d.year + 1)
    except ValueError:
        # Feb 29 -> Feb 28 next year.
        return d.replace(year=d.year + 1, day=d.day - 1)


def current_year_window() -> tuple[datetime, datetime, int]:
    """Return the [start, end) UTC bounds of the current calendar year.

    Returns
    -------
    tuple of (datetime, datetime, int)
        Start of year (inclusive), start of next year (exclusive), and
        the current year as an int.
    """
    yr = datetime.now(timezone.utc).year
    soy = datetime(yr, 1, 1)
    eoy = datetime(yr + 1, 1, 1)
    return soy, eoy, yr


def today_iso_date() -> str:
    """Return today's date in ``YYYY-MM-DD`` form (UTC).

    Returns
    -------
    str
        The current UTC date as an ISO date string.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def parse_money(v: object) -> float:
    """Coerce a form value to a non-throwing float.

    Mirrors the frontend ``parseMoney``: blank/``None``/non-numeric
    inputs become ``0``.

    Parameters
    ----------
    v : object
        Raw form value (string, number, or ``None``).

    Returns
    -------
    float
        Parsed amount, or ``0.0`` when the value is missing or invalid.
    """
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0
