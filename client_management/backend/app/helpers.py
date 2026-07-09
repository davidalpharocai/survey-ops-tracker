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


def utc_now() -> datetime:
    """Return the current instant as a naive UTC datetime.

    Naive to match the tz-naive timestamp columns (asyncpg rejects
    tz-aware values for them). Use for ``updated_at`` / ``deleted_at``.

    Returns
    -------
    datetime
        Current UTC time, tz-naive, second precision.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def utc_today() -> datetime:
    """Return today's date as a naive UTC-midnight datetime.

    Matches the naive-UTC convention of the timestamp columns (see the
    module docstring), so it can be compared directly against stored
    ``renewal_on`` / ``occurred_on`` values.

    Returns
    -------
    datetime
        Midnight (UTC) of the current date, tz-naive.
    """
    n = datetime.now(timezone.utc)
    return datetime(n.year, n.month, n.day)


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


class MoneyParseError(ValueError):
    """Raised when a money field holds a non-empty, unparseable value.

    Mapped to a 400 by the app's exception handler so a typo like
    ``"1O0"`` surfaces as a validation error instead of being silently
    saved as ``0`` (which would under-bill the client).
    """


def parse_money(v: object) -> float:
    """Coerce a form value to a float, tolerating ``$`` and thousands commas.

    A blank/``None`` value is ``0.0`` (an omitted optional amount). A
    *non-empty* value that isn't a number raises :class:`MoneyParseError`
    rather than silently becoming ``0``.

    Parameters
    ----------
    v : object
        Raw form value (string, number, or ``None``).

    Returns
    -------
    float
        The parsed amount (``0.0`` when the value is missing).

    Raises
    ------
    MoneyParseError
        When ``v`` is non-empty but cannot be parsed as a number.
    """
    if v is None:
        return 0.0
    s = str(v).strip().replace(",", "").replace("$", "")
    if s == "":
        return 0.0
    try:
        return float(s)
    except (TypeError, ValueError):
        raise MoneyParseError(f"“{v}” is not a valid amount.") from None
