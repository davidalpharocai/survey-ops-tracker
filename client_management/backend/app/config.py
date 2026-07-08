"""Application configuration, loaded from the environment."""

import json
import re
from functools import lru_cache

import boto3
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the backend service.

    Values are read from environment variables (or a local ``.env`` file
    during development). The same Postgres instance backs both the
    Express frontend and this service.

    Attributes
    ----------
    database_url : str
        PostgreSQL connection string. Accepts the standard
        ``postgresql://`` scheme; it is normalised to the async
        ``postgresql+asyncpg://`` driver for SQLAlchemy.
    allowed_domain : str
        Google Workspace domain permitted to access the service.
    env : str
        Deployment environment name (``development`` or ``production``).
    """

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = Field(default="", alias="DATABASE_URL")
    database_url_secret_arn: str = Field(default="", alias="DATABASE_URL_SECRET_ARN")
    allowed_domain: str = Field(default="alpharoc.ai", alias="ALLOWED_DOMAIN")
    frontend_url: str = Field(default="", alias="FRONTEND_URL")
    env: str = Field(default="development", alias="ENV")
    cognito_region: str = Field(default="us-east-1", alias="COGNITO_REGION")
    cognito_user_pool_id: str = Field(default="", alias="COGNITO_USER_POOL_ID")
    cognito_app_client_id: str = Field(default="", alias="COGNITO_APP_CLIENT_ID")
    cognito_allowed_group: str = Field(
        default="ccm-users", alias="COGNITO_ALLOWED_GROUP"
    )
    cognito_admin_group: str = Field(
        default="ccm-admins", alias="COGNITO_ADMIN_GROUP"
    )
    # Comma-separated emails granted admin regardless of Cognito group
    # membership. Lets the app be administered before/without the
    # ccm-admins group being wired up. Defaults to the initial owners.
    admin_emails: str = Field(
        default="david@alpharoc.ai,tedi@alpharoc.ai,nachi@alpharoc.ai",
        alias="CCM_ADMIN_EMAILS",
    )

    # Athena query path for the audit-log admin page. Populated by
    # Terraform; empty in local development (the admin endpoints then
    # return an empty result instead of querying Athena).
    cognito_jwks_url: str = Field(default="", alias="COGNITO_JWKS_URL")
    cognito_jwks_json: str = Field(default="", alias="COGNITO_JWKS_JSON")

    athena_database: str = Field(default="", alias="ATHENA_DATABASE")
    athena_table: str = Field(default="", alias="ATHENA_TABLE")
    athena_workgroup: str = Field(default="primary", alias="ATHENA_WORKGROUP")
    audit_s3_output: str = Field(default="", alias="AUDIT_S3_OUTPUT")
    aws_region: str = Field(default="us-east-1", alias="AWS_REGION")

    @model_validator(mode="after")
    def _resolve_database_url_from_secret(self) -> "Settings":
        """Fetch DATABASE_URL from Secrets Manager when not set directly.

        Called once per Settings instantiation (i.e. once per Lambda cold
        start). When ``DATABASE_URL_SECRET_ARN`` is set and ``DATABASE_URL``
        is absent, the secret value is fetched and stored so the rest of
        the application can use it transparently.

        Returns
        -------
        Settings
            Self, with ``database_url`` populated from Secrets Manager
            when applicable.
        """
        if self.database_url or not self.database_url_secret_arn:
            return self
        sm = boto3.client("secretsmanager", region_name=self.cognito_region or "us-east-1")
        raw = sm.get_secret_value(SecretId=self.database_url_secret_arn)["SecretString"]
        if raw.startswith("{"):
            parsed = json.loads(raw)
            raw = parsed.get("DATABASE_URL") or parsed.get("url") or next(iter(parsed.values()))
        self.database_url = raw
        return self

    @field_validator("athena_database", "athena_table")
    @classmethod
    def _validate_athena_identifier(cls, v: str) -> str:
        """Reject identifiers that could escape Athena SQL quoting.

        Parameters
        ----------
        v : str
            The raw field value from the environment.

        Returns
        -------
        str
            The validated value, unchanged.

        Raises
        ------
        ValueError
            If the value contains characters outside ``[A-Za-z0-9_]``.
        """
        if v and not re.fullmatch(r"[A-Za-z0-9_]+", v):
            raise ValueError("must contain only letters, digits, and underscores")
        return v

    @property
    def db_enabled(self) -> bool:
        """Whether a database URL is configured.

        Returns
        -------
        bool
            ``True`` when ``DATABASE_URL`` is set. ``False`` in the
            admin-query Lambda which has no DB access.
        """
        return bool(self.database_url)

    @property
    def cognito_enabled(self) -> bool:
        """Whether Cognito ID-token verification is configured.

        Returns
        -------
        bool
            ``True`` when both the user pool id and app client id are
            set, enabling JWT verification. ``False`` falls back to the
            ``X-User-Email`` header (local development only).
        """
        return bool(self.cognito_user_pool_id and self.cognito_app_client_id)

    @property
    def athena_enabled(self) -> bool:
        """Whether the Athena audit-log query path is configured.

        Returns
        -------
        bool
            ``True`` when the Glue database, table and S3 output location
            are all set, enabling Athena queries from the admin
            endpoints. ``False`` (local development) makes those
            endpoints return an empty result set.
        """
        return bool(
            self.athena_database and self.athena_table and self.audit_s3_output
        )

    @property
    def admin_email_set(self) -> set[str]:
        """Lower-cased set of explicitly allow-listed admin emails.

        Returns
        -------
        set of str
            Emails from ``CCM_ADMIN_EMAILS`` that are admins regardless
            of Cognito group membership.
        """
        return {
            e.strip().lower() for e in self.admin_emails.split(",") if e.strip()
        }

    def is_admin(self, email: str, groups: list[str]) -> bool:
        """Whether the given identity has admin rights.

        Admin if the email is in the :attr:`admin_email_set` allow-list
        OR the user is a member of the Cognito admin group.

        Parameters
        ----------
        email : str
            The verified user email.
        groups : list of str
            The user's Cognito groups.

        Returns
        -------
        bool
            ``True`` if the user is an administrator.
        """
        return (
            email.strip().lower() in self.admin_email_set
            or self.cognito_admin_group in (groups or [])
        )

    @property
    def cognito_issuer(self) -> str:
        """OIDC issuer URL for the configured user pool.

        Returns
        -------
        str
            The ``iss`` claim value Cognito stamps on its tokens, also
            the base for the JWKS endpoint.
        """
        return (
            f"https://cognito-idp.{self.cognito_region}.amazonaws.com/"
            f"{self.cognito_user_pool_id}"
        )

    @property
    def async_database_url(self) -> str:
        """Return ``database_url`` with the asyncpg driver.

        Returns
        -------
        str
            The connection string using the ``postgresql+asyncpg``
            scheme that SQLAlchemy's async engine requires.
        """
        url = self.database_url
        if url.startswith("postgresql+asyncpg://"):
            return url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)

    @property
    def is_production(self) -> bool:
        """Whether the service is running in production mode.

        Returns
        -------
        bool
            ``True`` when ``env`` is ``"production"``.
        """
        return self.env.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    """Return a cached :class:`Settings` instance.

    Returns
    -------
    Settings
        The process-wide settings object, parsed once and reused.
    """
    return Settings()
