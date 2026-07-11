"""Pluggable storage for contract-attachment file bytes.

Attachment *metadata* always lives in Postgres (``contract_attachments``).
The *bytes* live in one of two backends, chosen by ``ATTACHMENT_STORAGE``:

- ``postgres`` (default): bytes in the ``attachment_blobs`` table. Free, no
  extra infrastructure, and captured by ``pg_dump`` — so they migrate with
  the database into AWS with zero special handling.
- ``s3``: bytes in an S3 bucket via boto3. Set ``ATTACHMENT_S3_BUCKET``.
  Ready for when AWS is provisioned: flip one env var, no code change.

Every :class:`~app.models.ContractAttachment` row records which backend holds
its bytes (``storage_backend``), so download/delete always route to the right
place and a gradual ``postgres`` → ``s3`` migration is safe.

The storage *key* is an opaque generated UUID (see :func:`new_storage_key`).
The user-supplied filename is never used to address the object, so a crafted
name cannot traverse a path, overwrite another object, or collide.
"""

import uuid
from typing import Protocol

from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.models import AttachmentBlob


def new_storage_key(ext: str) -> str:
    """Generate an opaque, collision-resistant object key.

    Parameters
    ----------
    ext : str
        A short file extension hint (e.g. ``"pdf"``). Sanitised to
        alphanumerics and truncated; used only for readability, never for
        addressing.

    Returns
    -------
    str
        ``"<uuid4-hex>.<ext>"`` (or just the hex when no usable extension).
    """
    safe_ext = "".join(c for c in ext.lower() if c.isalnum())[:8]
    name = uuid.uuid4().hex
    return f"{name}.{safe_ext}" if safe_ext else name


class AttachmentStore(Protocol):
    """Backend-agnostic byte store for attachment objects."""

    backend_name: str

    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> bytes | None: ...

    async def delete(self, key: str) -> None: ...


class PostgresAttachmentStore:
    """Store bytes in the ``attachment_blobs`` table (default backend).

    Bound to the request's session so a write shares the same transaction as
    the metadata insert — an attachment and its bytes commit together or not
    at all.
    """

    backend_name = "postgres"

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        self._session.add(AttachmentBlob(storage_key=key, data=data))
        await self._session.flush()

    async def get(self, key: str) -> bytes | None:
        row = await self._session.get(AttachmentBlob, key)
        return bytes(row.data) if row is not None else None

    async def delete(self, key: str) -> None:
        await self._session.execute(
            sa_delete(AttachmentBlob).where(AttachmentBlob.storage_key == key)
        )
        await self._session.flush()


class S3AttachmentStore:
    """Store bytes in an S3 bucket via boto3 (used once AWS is provisioned).

    boto3 is synchronous, so every call runs in a worker thread to avoid
    blocking the event loop.
    """

    backend_name = "s3"

    def __init__(self, bucket: str, prefix: str, region: str) -> None:
        if not bucket:
            raise RuntimeError(
                "ATTACHMENT_STORAGE=s3 but ATTACHMENT_S3_BUCKET is not set."
            )
        import boto3  # local import: only needed on the s3 path

        self._bucket = bucket
        self._prefix = (prefix or "").strip("/")
        self._client = boto3.client("s3", region_name=region)

    def _full_key(self, key: str) -> str:
        return f"{self._prefix}/{key}" if self._prefix else key

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await run_in_threadpool(
            self._client.put_object,
            Bucket=self._bucket,
            Key=self._full_key(key),
            Body=data,
            ContentType=content_type,
        )

    async def get(self, key: str) -> bytes | None:
        def _read() -> bytes | None:
            try:
                resp = self._client.get_object(
                    Bucket=self._bucket, Key=self._full_key(key)
                )
                return resp["Body"].read()
            except self._client.exceptions.NoSuchKey:
                return None

        return await run_in_threadpool(_read)

    async def delete(self, key: str) -> None:
        await run_in_threadpool(
            self._client.delete_object,
            Bucket=self._bucket,
            Key=self._full_key(key),
        )


def store_for(backend: str, session: AsyncSession) -> AttachmentStore:
    """Return a store for a SPECIFIC backend name.

    Used by download/delete, which must route to whichever backend actually
    holds an existing attachment's bytes (recorded on its row), regardless of
    the current default.

    Parameters
    ----------
    backend : str
        ``"postgres"`` or ``"s3"``.
    session : AsyncSession
        Request session (needed by the postgres backend).

    Raises
    ------
    RuntimeError
        For an unknown backend name.
    """
    if backend == "postgres":
        return PostgresAttachmentStore(session)
    if backend == "s3":
        s = get_settings()
        return S3AttachmentStore(
            s.attachment_s3_bucket, s.attachment_s3_prefix, s.aws_region
        )
    raise RuntimeError(f"Unknown attachment storage backend: {backend!r}")


def default_store(session: AsyncSession) -> AttachmentStore:
    """Return a store for the currently configured default backend.

    Used by upload to place new bytes. The chosen backend name is then
    persisted on the attachment row so future reads route correctly.
    """
    return store_for(get_settings().attachment_storage, session)
