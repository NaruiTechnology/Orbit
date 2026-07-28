"""SMTP-backed mail composition and delivery endpoints."""

from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage
from email.utils import getaddresses

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.auth import get_current_user
from app.config import get_mail_settings
from app.schemas import SessionInfo

router = APIRouter(prefix="/mail", tags=["mail"])


class MailStatusResponse(BaseModel):
    configured: bool
    transport: str
    html_supported: bool


class MailSendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to: str = Field(min_length=3, max_length=2000)
    subject: str = Field(default="", max_length=300)
    text: str = Field(default="", max_length=500_000)
    html: str = Field(default="", max_length=1_000_000)


def _recipients(value: str) -> list[str]:
    addresses = [address for _, address in getaddresses([value]) if address]
    if not addresses or any("@" not in address or address.startswith("@") for address in addresses):
        raise HTTPException(
            status_code=422,
            detail="At least one valid recipient email is required",
        )
    return addresses


@router.get("/status", response_model=MailStatusResponse)
def mail_status(_: SessionInfo = Depends(get_current_user)) -> MailStatusResponse:
    configured = get_mail_settings().configured
    return MailStatusResponse(
        configured=configured,
        transport="smtp" if configured else "mailto",
        html_supported=configured,
    )


@router.post("/send")
def send_mail(
    request: MailSendRequest,
    _: SessionInfo = Depends(get_current_user),
) -> dict[str, str]:
    settings = get_mail_settings()
    if not settings.configured:
        raise HTTPException(status_code=503, detail="SMTP is not configured")
    recipients = _recipients(request.to)
    message = EmailMessage()
    message["From"] = settings.from_address
    message["To"] = ", ".join(recipients)
    message["Subject"] = request.subject.strip()
    message.set_content(request.text or "This message contains an HTML body.")
    message.add_alternative(request.html or request.text, subtype="html")

    try:
        smtp_type = smtplib.SMTP_SSL if settings.ssl else smtplib.SMTP
        with smtp_type(
            settings.smtp_host,
            settings.smtp_port,
            timeout=settings.timeout_seconds,
        ) as client:
            client.ehlo()
            if settings.starttls and not settings.ssl:
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            if settings.smtp_user:
                client.login(settings.smtp_user, settings.smtp_password)
            client.send_message(message)
    except smtplib.SMTPAuthenticationError as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "SMTP authentication failed. Use a Gmail App Password for "
                "ORBIT_SMTP_PASSWORD and verify the Gmail address."
            ),
        ) from error
    except smtplib.SMTPRecipientsRefused as error:
        raise HTTPException(status_code=502, detail="SMTP rejected the recipient address") from error
    except smtplib.SMTPConnectError as error:
        raise HTTPException(status_code=502, detail="SMTP connection was rejected by the server") from error
    except (OSError, smtplib.SMTPException) as error:
        raise HTTPException(
            status_code=502,
            detail="SMTP delivery failed while connecting or transferring the message",
        ) from error

    return {"status": "sent"}
