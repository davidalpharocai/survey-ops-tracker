"""CCM -> SOCC auto-create relay: payload mapping, dormant-by-default, and
study project_type persistence/normalisation."""

from app.models import Transaction
from app.socc_relay import build_project_payload, create_socc_project
from tests.conftest import make_client, make_study, make_user


def test_build_project_payload_maps_all_fields():
    t = Transaction(name="Pilot screening", project_type="PS", target_n=600)
    t.id = 42
    p = build_project_payload(t, client_name="Acme", salesperson="Jenna")
    assert p == {
        "project_name": "Pilot screening",
        "client": "Acme",
        "source": "ccm",
        "idem_key": "ccm-study-42",
        "project_type": "PS",
        "n_target": 600,
        "salesperson": "Jenna",
    }


def test_build_project_payload_omits_empty_optionals():
    t = Transaction(name="X", project_type=None, target_n=None)
    t.id = 7
    p = build_project_payload(t, client_name="Beta", salesperson=None)
    assert p == {"project_name": "X", "client": "Beta", "source": "ccm", "idem_key": "ccm-study-7"}


async def test_relay_dormant_returns_none_when_unconfigured():
    # No SOCC_API_URL/TOKEN in the test env → relay is a no-op.
    t = Transaction(name="X")
    t.id = 1
    assert await create_socc_project(t, client_name="A", salesperson=None) is None


async def test_study_project_type_persists_and_normalises(client):
    made = await make_client(client, name="PT Co")
    user = await make_user(client, made["id"], name="U")
    s = await make_study(client, made["id"], [user["id"]], name="S1", project_type="ps")
    assert s["projectType"] == "PS"  # normalised to canonical case
    s2 = await make_study(client, made["id"], [user["id"]], name="S2", project_type="Rerun")
    assert s2["projectType"] == "Rerun"
    # Unknown values are dropped (not persisted as-is).
    bad = await make_study(client, made["id"], [user["id"]], name="S3", project_type="nope")
    assert bad["projectType"] is None


async def test_dormant_relay_study_saves_without_pr(client):
    # With the relay unconfigured (default), recording a study still succeeds
    # and the study stays unlinked (no PR#####) — never errors.
    made = await make_client(client, name="Dormant Relay Co")
    user = await make_user(client, made["id"], name="U")
    s = await make_study(client, made["id"], [user["id"]], name="S", project_type="ps")
    assert s["id"]
    assert not s.get("soccProjectCode")
