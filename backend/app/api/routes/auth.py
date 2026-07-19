"""Imported Iobeam-style sign-up and SMS verification for Orbit."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
import secrets
from threading import Lock
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from psycopg import Connection
from pydantic import BaseModel, Field

from app.auth import issue_auth_token, login_from_token, revoke_auth_token
from app.config import get_settings
from app.database import get_connection
from app.schemas import SessionInfo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
SMS_TTL = timedelta(minutes=5)
_challenges: dict[str, dict[str, Any]] = {}
_active_challenge_by_user: dict[str, str] = {}
_challenge_lock = Lock()


class RegisterRequest(BaseModel):
    login_name: str = Field(min_length=1, max_length=120)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=1, max_length=320)
    phone_number: str = Field(min_length=1, max_length=40)
    company_name: str = Field(default="", max_length=160)
    site: str = Field(default="Beijing(北京)", max_length=160)


class SmsRequest(BaseModel):
    login: str = ""
    user_id: UUID | None = None


class VerifyRequest(BaseModel):
    challenge_id: str
    code: str
    site: str = "Beijing(北京)"
    login: str = ""
    user_id: UUID | None = None


def _public_user(row: dict[str, Any]) -> dict[str, Any]:
    display_name = row["display_name_i18n"] or {}
    return {
        "id": str(row["id"]),
        "login_name": row["login_name"],
        "first_name": row.get("first_name", ""),
        "last_name": row.get("last_name", ""),
        "display_name": display_name.get("en") or row["login_name"],
        "email": row.get("email") or "",
        "phone_number": row.get("phone_number") or "",
        "company_name": row.get("company_name") or "",
        "site": row.get("site") or "Beijing(北京)",
        "preferred_locale": row.get("preferred_locale") or "zh-CN",
        "is_active": row.get("is_active", True),
        "session_lifetime_limit_days": row.get("session_lifetime_limit_days", 1),
    }


def _user(connection: Connection[dict[str, Any]], login: str = "", user_id: UUID | None = None) -> dict[str, Any] | None:
    if user_id:
        return connection.execute(
            "SELECT * FROM orbit_identity.app_user WHERE id = %s AND is_active", (user_id,)
        ).fetchone()
    normalized = login.strip()
    if not normalized:
        return None
    return connection.execute(
        """SELECT * FROM orbit_identity.app_user
           WHERE is_active AND (lower(login_name) = lower(%s) OR lower(COALESCE(email, '')) = lower(%s))
           LIMIT 1""",
        (normalized, normalized),
    ).fetchone()


def _audit(connection: Connection[dict[str, Any]], user_id: UUID | None, action: str, metadata: dict[str, Any]) -> None:
    connection.execute(
        """INSERT INTO orbit_audit.audit_event
           (actor_user_id, action, entity_type, entity_id, metadata)
           VALUES (%s, %s, 'app_user', %s, %s::jsonb)""",
        (user_id, action, str(user_id) if user_id else None, __import__("json").dumps(metadata)),
    )


@router.get("/current-account")
def current_account(
    x_orbit_auth: str | None = Header(default=None, alias="X-Orbit-Auth"),
    x_orbit_user: str | None = Header(default=None, alias="X-Orbit-User"),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    login = login_from_token(x_orbit_auth) or x_orbit_user or get_settings().default_user_login
    row = _user(connection, login=login)
    authenticated = login_from_token(x_orbit_auth) is not None
    return {"ok": True, "login": login, "registered": row is not None, "authenticated": authenticated,
            "user": _public_user(row) if row and authenticated else None}


@router.get("/users")
def active_users(connection: Connection[dict[str, Any]] = Depends(get_connection)) -> dict[str, Any]:
    rows = connection.execute(
        "SELECT * FROM orbit_identity.app_user WHERE is_active ORDER BY login_name"
    ).fetchall()
    return {"ok": True, "users": [_public_user(row) for row in rows]}


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(request: RegisterRequest, connection: Connection[dict[str, Any]] = Depends(get_connection)) -> dict[str, Any]:
    existing = _user(connection, login=request.login_name)
    if existing:
        raise HTTPException(status_code=409, detail="login name is already registered")
    email_existing = _user(connection, login=request.email)
    if email_existing:
        raise HTTPException(status_code=409, detail="email is already registered")
    row = connection.execute(
        """INSERT INTO orbit_identity.app_user
           (login_name, display_name_i18n, first_name, last_name, email, phone_number, company_name, site)
           VALUES (%s, jsonb_build_object('en', %s, 'zh_CN', %s, 'zh_HK', %s), %s, %s, %s, %s, %s, %s)
           RETURNING *""",
        (request.login_name.strip(), f"{request.first_name.strip()} {request.last_name.strip()}",
         f"{request.first_name.strip()} {request.last_name.strip()}",
         f"{request.first_name.strip()} {request.last_name.strip()}", request.first_name.strip(),
         request.last_name.strip(), request.email.strip(), request.phone_number.strip(),
         request.company_name.strip(), request.site.strip()),
    ).fetchone()
    default_org = connection.execute("SELECT id FROM orbit_identity.organization ORDER BY code LIMIT 1").fetchone()
    default_lab = connection.execute("SELECT id, department_id FROM orbit_identity.laboratory ORDER BY code LIMIT 1").fetchone()
    if default_org and default_lab:
        connection.execute(
            """INSERT INTO orbit_identity.user_membership
               (user_id, organization_id, department_id, laboratory_id, is_primary)
               VALUES (%s, %s, %s, %s, true) ON CONFLICT DO NOTHING""",
            (row["id"], default_org["id"], default_lab["department_id"], default_lab["id"]),
        )
    viewer = connection.execute("SELECT id FROM orbit_identity.role WHERE code = 'viewer'").fetchone()
    if viewer:
        connection.execute(
            "INSERT INTO orbit_identity.user_role (user_id, role_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (row["id"], viewer["id"]),
        )
    _audit(connection, row["id"], "register", {"login_name": row["login_name"]})
    return {"ok": True, "user": _public_user(row)}


@router.post("/send-sms")
def send_sms(request: SmsRequest, connection: Connection[dict[str, Any]] = Depends(get_connection)) -> dict[str, Any]:
    row = _user(connection, request.login, request.user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="account not found")
    if not row.get("phone_number", "").strip():
        raise HTTPException(status_code=400, detail="account has no phone number")
    user_key = str(row["id"])
    with _challenge_lock:
        existing_id = _active_challenge_by_user.get(user_key)
        existing = _challenges.get(existing_id) if existing_id else None
        now = datetime.now(timezone.utc)
        if existing is not None and now <= existing["expires_at"]:
            # A duplicate request must not replace the code already sent to
            # the user. This also protects against concurrent browser retries.
            challenge_id = existing_id
            code = existing["code"]
        else:
            if existing_id:
                _challenges.pop(existing_id, None)
            challenge_id = secrets.token_urlsafe(24)
            code = f"{secrets.randbelow(900000) + 100000:06d}"
            _challenges[challenge_id] = {"code": code, "user": row, "expires_at": now + SMS_TTL}
            _active_challenge_by_user[user_key] = challenge_id
    logger.info("Orbit mock SMS verification code for %s: %s", row["phone_number"], code)
    return {"ok": True, "challenge_id": challenge_id, "phone_number": _mask_phone(row["phone_number"]), "mock": True, "dev_code": code}


@router.post("/verify-sms")
def verify_sms(
    request: VerifyRequest,
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    challenge = _challenges.get(request.challenge_id)
    if challenge is None:
        raise HTTPException(status_code=400, detail="verification challenge not found")
    if datetime.now(timezone.utc) > challenge["expires_at"]:
        _challenges.pop(request.challenge_id, None)
        _active_challenge_by_user.pop(str(challenge["user"]["id"]), None)
        raise HTTPException(status_code=410, detail="verification code expired")
    if request.code.strip() != challenge["code"]:
        raise HTTPException(status_code=401, detail="verification code is invalid")
    row = challenge["user"]
    token = issue_auth_token(row["login_name"])
    connection.execute(
        """INSERT INTO orbit_identity.auth_session
           (user_id, login_name, client_machine_name, site, expires_at)
           VALUES (%s, %s, 'Orbit browser', %s, %s)""",
        (row["id"], row["login_name"], request.site.strip(), datetime.now(timezone.utc) + timedelta(days=1)),
    )
    _audit(connection, row["id"], "login_sms_verified", {"site": request.site.strip()})
    _challenges.pop(request.challenge_id, None)
    _active_challenge_by_user.pop(str(row["id"]), None)
    return {"ok": True, "session_token": token, "user": _public_user(row)}


@router.post("/logout")
def logout(x_orbit_auth: str | None = Header(default=None, alias="X-Orbit-Auth")) -> dict[str, bool]:
    revoke_auth_token(x_orbit_auth)
    return {"ok": True}


def _mask_phone(value: str) -> str:
    digits = "".join(character for character in value if character.isdigit())
    return f"***{digits[-4:]}" if len(digits) >= 4 else "***"
