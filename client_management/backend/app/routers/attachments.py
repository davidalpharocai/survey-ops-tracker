"""Contract-attachment endpoints: upload, list, download, delete.

Documents (signed PDFs, SOWs, invoices…) attached to a contract. Bytes are
placed through the pluggable :mod:`app.storage` backend; metadata rows live in
``contract_attachments``.

Security posture (this is the money system-of-record):

- **Reads are scoped** via the owning contract's client — a restricted user
  who can't see the client gets 404 (existence is never disclosed).
- **Writes require an unrestricted role** and are blocked under impersonation
  by the app-wide read-only middleware.
- **Filenames are display-only.** Objects are addressed by a generated UUID
  key, so a crafted name can't traverse a path or overwrite another object.
- **Type allowlist by extension**; the stored content-type is the canonical
  type for that extension (never the client-declared one), so it can't be
  spoofed. SVG/HTML are not allowed.
- **Size cap** enforced with a bounded read.
- **Downloads force** ``Content-Disposition: attachment`` + ``nosniff`` so a
  file can never render inline (and script) in the app origin.
"""

import urllib.parse

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.config import get_settings
from app.db import get_session
from app.helpers import utc_now
from app.models import ContractAttachment, Transaction
from app.scoping import (
    AccessScope,
    require_scope,
    require_unrestricted,
    scoped_client_or_404,
)
from app.serializers import attachment_dict
from app.storage import default_store, new_storage_key, store_for

router = APIRouter(
    prefix="/api",
    tags=["attachments"],
    dependencies=[Depends(require_user)],
)

# Extension -> canonical content-type. The stored type is looked up here from
# the (validated) extension, so a client can't smuggle a dangerous type. SVG
# and HTML are deliberately absent (inline-script vectors).
ALLOWED_TYPES: dict[str, str] = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "csv": "text/csv",
    "txt": "text/plain",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
_MAX_FILENAME = 255
# One identical 404 body for every "can't reach this" case on these
# endpoints (missing, archived, wrong-kind, or out-of-scope) so the detail
# string can't be used as an existence oracle for another client's documents.
_NOT_FOUND = "Not found"


def _sanitize_filename(raw: str) -> str:
    """Reduce a client filename to a safe, display-only basename.

    Strips any path component and control characters (which could break the
    Content-Disposition header or a downstream filesystem), collapses quotes,
    and truncates. The result is metadata only — never used to address bytes.
    """
    base = (raw or "").replace("\\", "/").split("/")[-1]
    cleaned = "".join(c for c in base if c.isprintable() and c not in '"\r\n\t')
    cleaned = cleaned.strip().strip(".")  # no leading dots / trailing space
    return cleaned[:_MAX_FILENAME] or "file"


def _extension(filename: str) -> str:
    """Lower-cased extension after the last dot, or ``""`` when none."""
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[1].lower()


async def _scoped_contract(
    session: AsyncSession, txn_id: int, scope: AccessScope
) -> Transaction:
    """Fetch a visible, active contract or raise 404.

    404 (not 403) both for a missing/archived/non-contract row and for a
    contract whose client the caller may not see.
    """
    t = await session.get(Transaction, txn_id)
    if t is None or t.kind != "contract" or t.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    # scoped_client_or_404 raises its own "Client not found"; normalise it so a
    # caller can't tell "contract exists but not yours" from "no such contract".
    try:
        await scoped_client_or_404(session, t.client_id, scope)
    except HTTPException:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return t


async def _scoped_attachment(
    session: AsyncSession, att_id: int, scope: AccessScope
) -> tuple[ContractAttachment, Transaction]:
    """Fetch a visible, active attachment (and its contract) or raise 404."""
    a = await session.get(ContractAttachment, att_id)
    if a is None or a.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    t = await _scoped_contract(session, a.transaction_id, scope)
    return a, t


@router.get("/contracts/{txn_id}/attachments")
async def list_attachments(
    txn_id: int,
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> list[dict]:
    """List a contract's active attachments, oldest first."""
    await _scoped_contract(session, txn_id, scope)
    rows = (
        await session.execute(
            select(ContractAttachment)
            .where(
                ContractAttachment.transaction_id == txn_id,
                ContractAttachment.deleted_at.is_(None),
            )
            .order_by(ContractAttachment.created_at.asc(), ContractAttachment.id.asc())
        )
    ).scalars().all()
    return [attachment_dict(a) for a in rows]


@router.post(
    "/contracts/{txn_id}/attachments", status_code=status.HTTP_201_CREATED
)
async def upload_attachment(
    txn_id: int,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
    scope: AccessScope = Depends(require_unrestricted),
) -> dict:
    """Attach an uploaded document to a contract.

    Validates the type (allowlist) and size, stores the bytes through the
    configured backend, and records metadata. The stored content-type is the
    canonical one for the file's extension, not the client-declared type.
    """
    contract = await _scoped_contract(session, txn_id, scope)

    filename = _sanitize_filename(file.filename or "")
    ext = _extension(filename)
    content_type = ALLOWED_TYPES.get(ext)
    if content_type is None:
        allowed = ", ".join(sorted(ALLOWED_TYPES))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Accepted types: {allowed}.",
        )

    settings = get_settings()
    limit = settings.attachment_max_bytes
    # Bounded read: pull at most limit+1 bytes, so the handler never holds more
    # than the limit in memory. (Starlette has already received the full body
    # and spooled the part to a temp file before we get here; the true ceiling
    # on ingest is the platform's request-body cap — ~4.5 MB on Vercel, single-
    # digit MB on the AWS paths — all at or below this limit.)
    data = await file.read(limit + 1)
    if len(data) > limit:
        mb = limit // (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File is too large (max {mb} MB).",
        )
    if len(data) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty."
        )

    store = default_store(session)
    key = new_storage_key(ext)
    await store.put(key, data, content_type)

    att = ContractAttachment(
        transaction_id=contract.id,
        filename=filename,
        content_type=content_type,
        byte_size=len(data),
        storage_backend=store.backend_name,
        storage_key=key,
        uploaded_by_email=user,
    )
    session.add(att)
    try:
        await session.commit()
    except Exception:
        # The postgres backend's bytes live in this same transaction, so a
        # rollback already discards them. An external backend (S3) wrote the
        # object out-of-band, so best-effort delete it to avoid orphaning.
        await session.rollback()
        if store.backend_name != "postgres":
            try:
                await store.delete(key)
            except Exception:
                pass
        raise
    await session.refresh(att)
    return attachment_dict(att)


@router.get("/attachments/{att_id}/download")
async def download_attachment(
    att_id: int,
    session: AsyncSession = Depends(get_session),
    scope: AccessScope = Depends(require_scope),
) -> Response:
    """Stream an attachment's bytes back to an authorised caller.

    Always served as a download (never inline) with ``nosniff`` so no file
    can execute script in the app origin.
    """
    att, _contract = await _scoped_attachment(session, att_id, scope)
    store = store_for(att.storage_backend, session)
    data = await store.get(att.storage_key)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    # RFC 5987: an ASCII-safe fallback plus a UTF-8 encoded exact name.
    ascii_name = att.filename.encode("ascii", "replace").decode("ascii").replace('"', "")
    quoted = urllib.parse.quote(att.filename)
    disposition = (
        f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quoted}"
    )
    return Response(
        content=data,
        media_type=att.content_type,
        headers={
            "Content-Disposition": disposition,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("/attachments/{att_id}")
async def delete_attachment(
    att_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(require_user),
    scope: AccessScope = Depends(require_unrestricted),
) -> dict:
    """Soft-delete an attachment (bytes are retained for audit/restore)."""
    att, contract = await _scoped_attachment(session, att_id, scope)
    att.deleted_at = utc_now()
    await session.commit()
    return {"transactionId": contract.id, "id": att_id}
