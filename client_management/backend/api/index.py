"""Vercel Python entrypoint.

Vercel's Python runtime serves any ASGI app exported as ``app``. The
FastAPI application is unchanged; only this thin wrapper is
Vercel-specific. Schema setup: ``apply_schema()`` runs in the lifespan
hook when the runtime honours it; it is also safe to apply manually
(idempotent) against the hosted database.
"""

from app.main import app  # noqa: F401  (re-export for @vercel/python)
