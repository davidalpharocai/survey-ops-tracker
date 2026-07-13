"""CCM -> SOCC auto-create relay (Option A).

When a study is recorded in CCM and the relay is configured
(``SOCC_API_URL`` + ``SOCC_API_TOKEN``), CCM asks the SOCC (Survey Ops)
tracker to create a matching project and returns the SOCC-assigned PR#####.

DORMANT by default: with no config, :func:`create_socc_project` is a no-op
returning ``None`` (the study still saves normally, unflagged). This lets the
CCM side ship before the SOCC endpoint exists. See
``docs/specs/2026-07-13-ccm-socc-autocreate-design.md`` for the endpoint
contract; adjust the request/response shape here once SOCC confirms it.

The call is best-effort: any failure returns ``None`` (never raises), so a
SOCC outage can never block or corrupt the money-of-record study.
"""

from app.config import get_settings
from app.models import Transaction

_TIMEOUT_SECONDS = 8.0
_ENDPOINT_PATH = "/api/projects"  # per the design spec; confirm with SOCC


def build_project_payload(
    study: Transaction, *, client_name: str, salesperson: str | None
) -> dict:
    """Map a CCM study + its client onto the SOCC create-project body.

    Optional fields are omitted when empty so SOCC applies its own defaults.
    ``idem_key`` is stable per study so retries can't create duplicates.
    """
    payload: dict = {
        "project_name": study.name,
        "client": client_name,
        "source": "ccm",
        "idem_key": f"ccm-study-{study.id}",
    }
    if study.project_type:
        payload["project_type"] = study.project_type
    if study.target_n:
        payload["n_target"] = int(study.target_n)
    if salesperson:
        payload["salesperson"] = salesperson
    return payload


async def create_socc_project(
    study: Transaction, *, client_name: str, salesperson: str | None
) -> str | None:
    """Create the SOCC project for a study and return its PR#####, or None.

    Returns ``None`` when the relay is not configured (dormant) or on any
    error/timeout — the caller then leaves ``socc_project_code`` unset so the
    study can be relayed later. Never raises.
    """
    settings = get_settings()
    if not settings.socc_relay_enabled:
        return None

    payload = build_project_payload(
        study, client_name=client_name, salesperson=salesperson
    )
    url = settings.socc_api_url.rstrip("/") + _ENDPOINT_PATH
    try:
        import httpx  # local import: only needed when the relay is enabled

        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {settings.socc_api_token}"},
            )
        if resp.status_code >= 400:
            return None
        data = resp.json()
        pr = data.get("pr_code") or data.get("prCode")
        return pr if isinstance(pr, str) and pr.strip() else None
    except Exception:
        # Best-effort: SOCC unreachable / bad response / timeout — the study is
        # already saved; it stays unlinked and can be relayed later.
        return None
