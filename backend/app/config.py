"""JSON-backed application configuration with environment overrides."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import quote

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as source:
        return json.load(source)


def _resolve_path(value: str, base: Path = PROJECT_ROOT) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else (base / path).resolve()


@dataclass(frozen=True)
class DatabaseSettings:
    provider: str
    database_name: str
    admin_database_name: str
    admin_user: str
    admin_password: str
    schema: str
    host: str
    port: int
    user: str
    password: str
    connection_string: str
    ssl_mode: str
    client_encoding: str
    timezone: str
    command_timeout_seconds: int
    pool_size: int
    max_overflow: int

    @property
    def conninfo(self) -> str:
        override = os.getenv("ORBIT_DATABASE_URL", self.connection_string).strip()
        if override:
            return override
        user = quote(os.getenv("ORBIT_DB_USER", self.user), safe="")
        password = quote(os.getenv("ORBIT_DB_PASSWORD", self.password), safe="")
        host = os.getenv("ORBIT_DB_HOST", self.host)
        port = int(os.getenv("ORBIT_DB_PORT", str(self.port)))
        database = quote(os.getenv("ORBIT_DB_NAME", self.database_name), safe="")
        ssl_mode = quote(os.getenv("ORBIT_DB_SSLMODE", self.ssl_mode), safe="")
        return f"postgresql://{user}:{password}@{host}:{port}/{database}?sslmode={ssl_mode}"

    @property
    def connect_kwargs(self) -> dict[str, Any]:
        return {
            "connect_timeout": self.command_timeout_seconds,
            "options": (f"-c client_encoding={self.client_encoding} -c timezone={self.timezone}"),
        }


@dataclass(frozen=True)
class MailSettings:
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    from_address: str
    starttls: bool
    ssl: bool
    timeout_seconds: int

    @property
    def configured(self) -> bool:
        return bool(
            self.smtp_host
            and self.from_address
            and (not self.smtp_user or self.smtp_password)
        )


@dataclass(frozen=True)
class ApplicationSettings:
    application_name: str
    is_production: bool
    environment: str
    api_host: str
    api_port: int
    frontend_host: str
    frontend_port: int
    allowed_origins: tuple[str, ...]
    default_locale: str
    supported_locales: tuple[str, ...]
    default_user_login: str
    workflow_catalog: Path
    source_timezone: str
    database: DatabaseSettings
    mail: MailSettings


def _database_settings(path: Path) -> DatabaseSettings:
    data = _read_json(path)
    return DatabaseSettings(
        provider=data["Provider"],
        database_name=data["DatabaseName"],
        admin_database_name=data.get("AdminDatabaseName", "postgres"),
        admin_user=data.get("AdminUser", "postgres"),
        admin_password=data.get("AdminPassword", ""),
        schema=data["Schema"],
        host=data["Host"],
        port=int(data["Port"]),
        user=data["User"],
        password=data["Password"],
        connection_string=data.get("ConnectionString", ""),
        ssl_mode=data.get("SslMode", "disable"),
        client_encoding=data.get("ClientEncoding", "UTF8"),
        timezone=data.get("Timezone", "Asia/Shanghai"),
        command_timeout_seconds=int(data.get("CommandTimeoutSeconds", 30)),
        pool_size=int(data.get("PoolSize", 10)),
        max_overflow=int(data.get("MaxOverflow", 20)),
    )


def _mail_settings(config: dict[str, Any] | None = None) -> MailSettings:
    config = config or {}
    smtp_user = os.getenv("ORBIT_SMTP_USER", config.get("SmtpUser", "")).strip()
    return MailSettings(
        smtp_host=os.getenv("ORBIT_SMTP_HOST", config.get("SmtpHost", "")).strip(),
        smtp_port=int(os.getenv("ORBIT_SMTP_PORT", str(config.get("SmtpPort", 587)))),
        smtp_user=smtp_user,
        # Google sometimes displays App Passwords in grouped blocks; spaces
        # are presentation-only and must not be sent to SMTP.
        smtp_password="".join(os.getenv("ORBIT_SMTP_PASSWORD", "").split()),
        from_address=os.getenv("ORBIT_SMTP_FROM", config.get("SmtpFrom", smtp_user)).strip(),
        starttls=os.getenv(
            "ORBIT_SMTP_STARTTLS", str(config.get("StartTLS", True))
        ).lower() in {"1", "true", "yes", "on"},
        ssl=os.getenv("ORBIT_SMTP_SSL", str(config.get("SSL", False))).lower()
        in {"1", "true", "yes", "on"},
        timeout_seconds=int(os.getenv("ORBIT_SMTP_TIMEOUT", str(config.get("TimeoutSeconds", 20)))),
    )


def get_mail_settings() -> MailSettings:
    """Load mail settings so runtime environment changes take effect immediately."""
    config_path = _resolve_path(os.getenv("ORBIT_APPLICATION_CONFIG", "config/application.json"))
    data = _read_json(config_path)
    return _mail_settings(data.get("MailConfig"))


@lru_cache(maxsize=1)
def get_settings() -> ApplicationSettings:
    config_path = _resolve_path(os.getenv("ORBIT_APPLICATION_CONFIG", "config/application.json"))
    data = _read_json(config_path)
    database_path = _resolve_path(data["DatabaseConfig"])
    return ApplicationSettings(
        application_name=data["ApplicationName"],
        is_production=bool(data.get("IsProduction", False)),
        environment=os.getenv("ORBIT_ENVIRONMENT", data["Environment"]),
        api_host=os.getenv("ORBIT_API_HOST", data["ApiHost"]),
        api_port=int(os.getenv("ORBIT_API_PORT", str(data["ApiPort"]))),
        frontend_host=os.getenv("ORBIT_FRONTEND_HOST", data["FrontendHost"]),
        frontend_port=int(os.getenv("ORBIT_FRONTEND_PORT", str(data["FrontendPort"]))),
        allowed_origins=tuple(data["AllowedOrigins"]),
        default_locale=data["DefaultLocale"],
        supported_locales=tuple(data["SupportedLocales"]),
        default_user_login=os.getenv("ORBIT_DEFAULT_USER", data["DefaultUserLogin"]),
        workflow_catalog=_resolve_path(data["WorkflowCatalog"]),
        source_timezone=data.get("SourceTimezone", "Asia/Shanghai"),
        database=_database_settings(database_path),
        mail=_mail_settings(data.get("MailConfig")),
    )
