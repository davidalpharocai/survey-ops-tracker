"""Contract-attachment endpoints: upload, list, download, delete.

Covers the happy path plus the security-relevant edges: type allowlist, size
cap, empty files, filename sanitisation (path traversal), content-type
canonicalisation (spoofing), per-client scoping (404 hides), the
restricted-user write lockdown, and soft-delete.
"""

from app.config import get_settings
from tests.conftest import (
    ADMIN,
    USER,
    make_client,
    make_contract,
    make_study,
    make_user,
)

SARAH = "sarah@alpharoc.ai"


async def _sp(client, name, email):
    r = await client.post(
        "/api/salespeople", json={"name": name, "email": email}, headers=ADMIN
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _upload(client, txn_id, filename, data, content_type, headers=ADMIN):
    return await client.post(
        f"/api/contracts/{txn_id}/attachments",
        files={"file": (filename, data, content_type)},
        headers=headers,
    )


async def test_upload_list_download_roundtrip(client):
    made = await make_client(client, name="Doc Co")
    con = await make_contract(client, made["id"], name="MSA")
    payload = b"%PDF-1.4 signed agreement bytes"

    r = await _upload(client, con["id"], "agreement.pdf", payload, "application/pdf")
    assert r.status_code == 201, r.text
    att = r.json()
    assert att["filename"] == "agreement.pdf"
    assert att["contentType"] == "application/pdf"
    assert att["byteSize"] == len(payload)
    assert att["uploadedByEmail"] == "david@alpharoc.ai"
    assert att["transactionId"] == con["id"]

    listed = (await client.get(f"/api/contracts/{con['id']}/attachments", headers=ADMIN)).json()
    assert [a["id"] for a in listed] == [att["id"]]

    dl = await client.get(f"/api/attachments/{att['id']}/download", headers=ADMIN)
    assert dl.status_code == 200
    assert dl.content == payload
    assert dl.headers["content-type"].startswith("application/pdf")
    assert "attachment" in dl.headers["content-disposition"].lower()
    assert "agreement.pdf" in dl.headers["content-disposition"]
    assert dl.headers["x-content-type-options"] == "nosniff"


async def test_reject_disallowed_and_extensionless_types(client):
    made = await make_client(client, name="Type Co")
    con = await make_contract(client, made["id"], name="C")
    assert (await _upload(client, con["id"], "evil.svg", b"<svg/>", "image/svg+xml")).status_code == 400
    assert (await _upload(client, con["id"], "evil.exe", b"MZ", "application/octet-stream")).status_code == 400
    assert (await _upload(client, con["id"], "noextension", b"data", "application/pdf")).status_code == 400


async def test_reject_oversized(client, monkeypatch):
    made = await make_client(client, name="Big Co")
    con = await make_contract(client, made["id"], name="C")
    monkeypatch.setattr(get_settings(), "attachment_max_bytes", 10)
    r = await _upload(client, con["id"], "big.pdf", b"x" * 20, "application/pdf")
    assert r.status_code == 413
    # At the limit is accepted.
    ok = await _upload(client, con["id"], "ok.pdf", b"x" * 10, "application/pdf")
    assert ok.status_code == 201


async def test_reject_empty(client):
    made = await make_client(client, name="Empty Co")
    con = await make_contract(client, made["id"], name="C")
    assert (await _upload(client, con["id"], "x.pdf", b"", "application/pdf")).status_code == 400


async def test_filename_path_traversal_sanitised(client):
    made = await make_client(client, name="Path Co")
    con = await make_contract(client, made["id"], name="C")
    r = await _upload(client, con["id"], "../../../etc/passwd.pdf", b"data", "application/pdf")
    assert r.status_code == 201
    att = r.json()
    # Only the basename is kept; no path component survives.
    assert att["filename"] == "passwd.pdf"
    dl = await client.get(f"/api/attachments/{att['id']}/download", headers=ADMIN)
    assert "/" not in dl.headers["content-disposition"].split("filename=")[1].split(";")[0]


async def test_content_type_is_canonical_not_client_declared(client):
    made = await make_client(client, name="Spoof Co")
    con = await make_contract(client, made["id"], name="C")
    # A .pdf whose declared type is text/html and whose bytes are HTML: the
    # stored + served type must be application/pdf (from the extension), never
    # the attacker-controlled text/html, and it must download, not render.
    r = await _upload(client, con["id"], "report.pdf", b"<html><script>x</script></html>", "text/html")
    assert r.status_code == 201
    assert r.json()["contentType"] == "application/pdf"
    dl = await client.get(f"/api/attachments/{r.json()['id']}/download", headers=ADMIN)
    assert dl.headers["content-type"].startswith("application/pdf")
    assert "attachment" in dl.headers["content-disposition"].lower()


async def test_soft_delete_hides_and_blocks_download(client):
    made = await make_client(client, name="Del Co")
    con = await make_contract(client, made["id"], name="C")
    att = (await _upload(client, con["id"], "a.pdf", b"data", "application/pdf")).json()

    d = await client.delete(f"/api/attachments/{att['id']}", headers=ADMIN)
    assert d.status_code == 200
    assert (await client.get(f"/api/contracts/{con['id']}/attachments", headers=ADMIN)).json() == []
    assert (await client.get(f"/api/attachments/{att['id']}/download", headers=ADMIN)).status_code == 404


async def test_upload_requires_contract(client):
    made = await make_client(client, name="Kind Co")
    user = await make_user(client, made["id"], name="U")
    study = await make_study(client, made["id"], [user["id"]], name="Not a contract")
    # A study id is not a contract → 404; a nonexistent id → 404.
    assert (await _upload(client, study["id"], "a.pdf", b"d", "application/pdf")).status_code == 404
    assert (await _upload(client, 999999, "a.pdf", b"d", "application/pdf")).status_code == 404


async def test_ledger_includes_active_attachments(client):
    made = await make_client(client, name="Ledger Att Co")
    con = await make_contract(client, made["id"], name="C")
    a1 = (await _upload(client, con["id"], "one.pdf", b"d1", "application/pdf")).json()
    a2 = (await _upload(client, con["id"], "two.pdf", b"d2", "application/pdf")).json()
    # Soft-deleted attachment must not appear in the ledger.
    gone = (await _upload(client, con["id"], "gone.pdf", b"d3", "application/pdf")).json()
    await client.delete(f"/api/attachments/{gone['id']}", headers=ADMIN)

    ledger = (await client.get(f"/api/clients/{made['id']}/ledger", headers=ADMIN)).json()
    contract_row = next(c for c in ledger["contracts"] if c["id"] == con["id"])
    assert [a["id"] for a in contract_row["attachments"]] == [a1["id"], a2["id"]]
    assert [a["filename"] for a in contract_row["attachments"]] == ["one.pdf", "two.pdf"]


async def test_scoping_and_restricted_lockdown(client):
    sarah = await _sp(client, "Sarah", SARAH)
    mine = await make_client(client, name="Mine Co", salesperson_id=sarah["id"])
    theirs = await make_client(client, name="Theirs Co")  # unowned by sarah
    my_con = await make_contract(client, mine["id"], name="Mine C")
    their_con = await make_contract(client, theirs["id"], name="Their C")
    their_att = (await _upload(client, their_con["id"], "t.pdf", b"secret", "application/pdf")).json()
    my_att = (await _upload(client, my_con["id"], "m.pdf", b"mine", "application/pdf")).json()

    # Restricted user can read attachments on a client she owns...
    assert (await client.get(f"/api/contracts/{my_con['id']}/attachments", headers=USER)).status_code == 200
    assert (await client.get(f"/api/attachments/{my_att['id']}/download", headers=USER)).status_code == 200
    # ...but a client she doesn't own is 404 (existence hidden), not 403.
    assert (await client.get(f"/api/contracts/{their_con['id']}/attachments", headers=USER)).status_code == 404
    assert (await client.get(f"/api/attachments/{their_att['id']}/download", headers=USER)).status_code == 404
    # Restricted users cannot upload or delete at all (require_unrestricted).
    assert (await _upload(client, my_con["id"], "x.pdf", b"d", "application/pdf", headers=USER)).status_code == 403
    assert (await client.delete(f"/api/attachments/{my_att['id']}", headers=USER)).status_code == 403


async def test_404_detail_is_uniform_no_existence_oracle(client):
    # A nonexistent attachment and a real-but-unowned one must return the SAME
    # 404 body, so the detail string can't reveal which ids exist elsewhere.
    sarah = await _sp(client, "Sarah", SARAH)
    await make_client(client, name="Mine Co 2", salesperson_id=sarah["id"])
    theirs = await make_client(client, name="Theirs Co 2")
    their_con = await make_contract(client, theirs["id"], name="Their C")
    their_att = (await _upload(client, their_con["id"], "t.pdf", b"x", "application/pdf")).json()

    missing = await client.get("/api/attachments/999999/download", headers=USER)
    unowned = await client.get(f"/api/attachments/{their_att['id']}/download", headers=USER)
    assert missing.status_code == unowned.status_code == 404
    assert missing.json()["detail"] == unowned.json()["detail"] == "Not found"
    # List path is uniform too: unowned contract vs nonexistent contract.
    l_unowned = await client.get(f"/api/contracts/{their_con['id']}/attachments", headers=USER)
    l_missing = await client.get("/api/contracts/999999/attachments", headers=USER)
    assert l_unowned.status_code == l_missing.status_code == 404
    assert l_unowned.json()["detail"] == l_missing.json()["detail"] == "Not found"
