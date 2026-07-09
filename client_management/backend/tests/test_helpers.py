"""Unit tests for ``app.helpers`` and ``app.study_logic`` (no HTTP/DB)."""

from datetime import datetime

import pytest

from app.helpers import (
    MoneyParseError,
    add_year,
    parse_date,
    parse_money,
    utc_now,
    utc_today,
)
from app.study_logic import runs_per_year


class TestParseDate:
    def test_valid_iso_date(self):
        assert parse_date("2026-07-08") == datetime(2026, 7, 8)

    @pytest.mark.parametrize(
        "bad",
        [None, "", "not-a-date", "2026-13-40", "2026/07/08", "07-08", "20260708"],
    )
    def test_bad_input_returns_none(self, bad):
        assert parse_date(bad) is None

    def test_result_is_naive_utc_midnight(self):
        d = parse_date("2026-01-02")
        assert d.tzinfo is None
        assert (d.hour, d.minute, d.second) == (0, 0, 0)


class TestParseMoney:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            (None, 0.0),
            ("", 0.0),
            ("   ", 0.0),
            (100, 100.0),
            ("100", 100.0),
            ("$1,000.50", 1000.5),
            ("$1,500", 1500.0),
            ("1,000.50", 1000.5),
            ("-42.5", -42.5),
            # A lone "$" strips down to the empty string, so it is
            # treated as an omitted amount rather than a typo.
            ("$", 0.0),
        ],
    )
    def test_accepted_values(self, raw, expected):
        assert parse_money(raw) == expected

    @pytest.mark.parametrize("garbage", ["1O0", "abc", "12x", "1.2.3"])
    def test_garbage_raises(self, garbage):
        with pytest.raises(MoneyParseError):
            parse_money(garbage)


class TestDates:
    def test_utc_now_is_naive(self):
        assert utc_now().tzinfo is None
        assert utc_now().microsecond == 0

    def test_utc_today_is_naive_midnight(self):
        t = utc_today()
        assert t.tzinfo is None
        assert (t.hour, t.minute, t.second) == (0, 0, 0)

    def test_add_year_plain(self):
        assert add_year(datetime(2025, 3, 10)) == datetime(2026, 3, 10)

    def test_add_year_leap_day(self):
        assert add_year(datetime(2024, 2, 29)) == datetime(2025, 2, 28)


class TestRunsPerYear:
    @pytest.mark.parametrize(
        ("cadence", "runs"),
        [("weekly", 52), ("monthly", 12), ("quarterly", 4)],
    )
    def test_known_cadences(self, cadence, runs):
        assert runs_per_year(cadence) == runs

    @pytest.mark.parametrize("cadence", [None, "", "single", "biweekly", "yearly"])
    def test_unknown_cadence_is_zero(self, cadence):
        assert runs_per_year(cadence) == 0
