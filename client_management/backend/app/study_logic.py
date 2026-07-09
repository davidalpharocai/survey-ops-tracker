"""Study cost arithmetic, ported verbatim from ``frontend/src/app.js``.

The behaviour here is a faithful translation of ``runsPerYear``,
``readStudyForm`` and ``decorateStudy``. Studies store a negative delta
on exactly one currency column; setup cost is always folded into the
credits side. Keeping the maths identical is what guarantees existing
ledgers reconcile after the cutover.
"""

from dataclasses import dataclass, field

from app.helpers import parse_date, parse_money
from app.schemas import StudyIn

RUNS_PER_YEAR = {"weekly": 52, "monthly": 12, "quarterly": 4}


def runs_per_year(cadence: str | None) -> int:
    """Return the number of runs per year for a cadence.

    Parameters
    ----------
    cadence : str or None
        ``"weekly"``, ``"monthly"``, ``"quarterly"`` or anything else.

    Returns
    -------
    int
        Runs per year, or ``0`` for an unknown/absent cadence.
    """
    return RUNS_PER_YEAR.get(cadence or "", 0)


@dataclass
class StudyForm:
    """Normalised study form values (see :func:`read_study_form`)."""

    name: str
    occurred_on: object  # datetime | None
    cost_type: str
    cadence: str | None
    per_run: float
    annual_total: float
    setup_cost: float
    user_ids: list[int] = field(default_factory=list)


def read_study_form(body: StudyIn) -> StudyForm:
    """Normalise a study form payload.

    Mirrors the frontend ``readStudyForm``: a unified ``cost`` field
    (per-run for trackers, total otherwise) with legacy
    ``cost_per_run`` / ``cost_amount`` fallbacks; setup cost only
    applies to trackers and is always denominated in credits.

    Parameters
    ----------
    body : StudyIn
        Raw study form payload.

    Returns
    -------
    StudyForm
        Parsed and defaulted values.
    """
    name = (body.name or "").strip()
    occurred_on = parse_date(body.occurred_on) if body.occurred_on else None
    cost_type = "dollars" if body.cost_type == "dollars" else "credits"
    cadence_raw = (body.cadence or "single").lower()
    cadence = cadence_raw if cadence_raw in RUNS_PER_YEAR else None

    # The unified cost field wins whenever it was actually provided —
    # including zero/negative values, so validation can reject negatives
    # instead of silently treating them as "not given". Legacy fields
    # only apply when the unified field is absent.
    if body.cost not in (None, ""):
        per_run = parse_money(body.cost)
    else:
        per_run = parse_money(
            body.cost_per_run
            if body.cost_per_run not in (None, "")
            else body.cost_amount
        )
    annual_total = per_run * runs_per_year(cadence) if cadence else per_run
    setup_cost = parse_money(body.setup_cost) if cadence else 0.0

    seen: list[int] = []
    for raw in body.client_user_ids or []:
        try:
            n = int(raw)
        except (TypeError, ValueError):
            continue
        seen.append(n)

    return StudyForm(
        name=name,
        occurred_on=occurred_on,
        cost_type=cost_type,
        cadence=cadence,
        per_run=per_run,
        annual_total=annual_total,
        setup_cost=setup_cost,
        user_ids=seen,
    )


def decorate_study(t: dict) -> dict:
    """Derive display economics for an existing study row.

    Faithful port of the frontend ``decorateStudy``: recovers the
    annual run cost and per-run cost from the stored signed deltas
    (which fold in any setup cost on the credits side), and flags rows
    still carrying the CSV-import "needs review" note.

    Parameters
    ----------
    t : dict
        A serialised study transaction (camelCase, with ``users``).

    Returns
    -------
    dict
        ``t`` augmented with ``costType``, ``costAnnual``,
        ``costPerRun``, ``setupCost``, ``cadence``, ``userIds``,
        ``userObjs`` and ``isImported``.
    """
    c = float(t.get("creditsDelta") or 0)
    d = float(t.get("dollarsDelta") or 0)
    setup_cost = float(t["setupCost"]) if t.get("setupCost") is not None else 0.0

    if d < 0:
        cost_type, cost_annual = "dollars", -d
    elif c < 0:
        cost_type, cost_annual = "credits", max(0.0, -c - setup_cost)
    else:
        cost_type, cost_annual = "credits", 0.0

    cadence = t.get("cadence")
    if t.get("costPerRun") is not None:
        cost_per_run = float(t["costPerRun"])
    elif cadence:
        cost_per_run = cost_annual / max(runs_per_year(cadence), 1)
    else:
        cost_per_run = cost_annual

    users = t.get("users") or []
    user_ids = [tu["clientUserId"] for tu in users]
    user_objs = [tu["clientUser"] for tu in users if tu.get("clientUser")]
    is_imported = "Imported from CSV" in (t.get("note") or "")

    return {
        **t,
        "costType": cost_type,
        "costAnnual": cost_annual,
        "costPerRun": cost_per_run,
        "setupCost": setup_cost,
        "cadence": cadence or "single",
        "userIds": user_ids,
        "userObjs": user_objs,
        "isImported": is_imported,
    }
