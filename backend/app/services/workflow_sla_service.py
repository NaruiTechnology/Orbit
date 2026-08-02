"""SLA monitoring, template rendering, and the Orbit service worker boundary."""

from __future__ import annotations

import html
import json
import smtplib
import ssl
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime
from email.message import EmailMessage
from email.utils import getaddresses
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.types.json import Jsonb

from app.config import get_mail_settings

DEFAULT_SUBJECT_XML = "<subject>{{step_name}} SLA violation</subject>"
DEFAULT_BODY_XML = (
    "<body><p>The following workflow items have violated their SLA:</p>"
    "{{items_table}}</body>"
)
DEFAULT_STYLESHEET = (
    "body{font-family:Arial,sans-serif;color:#1f2937}"
    "table{border-collapse:collapse;width:100%}"
    "th,td{border:1px solid #d1d5db;padding:6px;text-align:left}"
    "th{background:#f3f4f6}"
)


def get_sla_workflow_steps(
    connection: Connection[dict[str, Any]],
    workflow_step_id: UUID | None = None,
    as_of: datetime | None = None,
) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT * FROM orbit_runtime.get_sla_workflow_steps(%s, %s)",
        (as_of, workflow_step_id),
    ).fetchall()
    return _attach_step_configuration(connection, rows)


def _attach_step_configuration(
    connection: Connection[dict[str, Any]], rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Attach the workflow/step names and raw SLA source used by each check."""
    step_ids = [row["workflow_step_id"] for row in rows]
    if not step_ids:
        return rows
    configured = connection.execute(
        """
        SELECT r.id AS workflow_step_id,
               COALESCE(w.name_i18n ->> 'en', w.workflow_key) AS workflow_name,
               COALESCE(r.label_i18n ->> 'en', r.record_key) AS step_name,
               COALESCE(a.sla, r.values_json ->> 'time_limit') AS sla_configured,
               CASE
                   WHEN a.sla IS NOT NULL THEN 'workflow_step_assignment.sla'
                   ELSE 'workflow_record.values_json.time_limit'
               END AS sla_source
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
          LEFT JOIN orbit_workflow.workflow_step_assignment a
            ON a.workflow_record_id = r.id
         WHERE r.id = ANY(%s)
        """,
        (step_ids,),
    ).fetchall()
    by_id = {row["workflow_step_id"]: row for row in configured}
    return [
        {
            **row,
            "workflow_name": by_id.get(row["workflow_step_id"], {}).get("workflow_name"),
            "step_name": by_id.get(row["workflow_step_id"], {}).get("step_name"),
            "sla_configured": by_id.get(row["workflow_step_id"], {}).get("sla_configured"),
            "sla_source": by_id.get(row["workflow_step_id"], {}).get("sla_source"),
        }
        for row in rows
    ]


def evaluate_sla_workflow_steps(
    connection: Connection[dict[str, Any]],
    workflow_step_id: UUID | None = None,
    as_of: datetime | None = None,
) -> list[dict[str, Any]]:
    """Return rule/transition decisions without mutating workflow state yet."""
    return connection.execute(
        "SELECT * FROM orbit_runtime.evaluate_sla_workflow_steps(%s, %s)",
        (workflow_step_id, as_of),
    ).fetchall()


def run_sla_cycle(connection: Connection[dict[str, Any]], access_url_base: str) -> dict[str, Any]:
    """Run both SLA passes using one snapshot of the catalog/runtime query."""
    rows = get_sla_workflow_steps(connection)
    for row in rows:
        print(
            "[orbit_service] SLA due check "
            + _json_log(
                {
                    "workflow_name": row.get("workflow_name"),
                    "workflow_key": row.get("workflow_key"),
                    "step_name": row.get("step_name"),
                    "workflow_step_id": row.get("workflow_step_id"),
                    "workflow_instance_id": row.get("workflow_instance_id"),
                    "workflow_node_instance_id": row.get("workflow_node_instance_id"),
                    "record_key": row.get("record_key"),
                    "business_key": row.get("business_key"),
                    "sla": row.get("sla_configured"),
                    "sla_source": row.get("sla_source"),
                    "sla_days": row.get("sla_days"),
                    "step_start_time": row.get("started_at"),
                    "due_at": row.get("due_at"),
                    "sla_violated": row.get("sla_violated"),
                }
            ),
            flush=True,
        )
    violations = [row for row in rows if row["sla_violated"]]
    email_result = _send_violation_emails(connection, violations, access_url_base)
    decisions = _placeholder_decisions(rows)
    return {
        "checked": len(rows),
        "violations": len(violations),
        "emails_sent": email_result["emails_sent"],
        "email_errors": email_result["email_errors"],
        "decisions": decisions,
    }


def _json_log(payload: dict[str, Any]) -> str:
    return json.dumps(payload, default=str, ensure_ascii=False, separators=(",", ":"))


def _placeholder_decisions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "workflow_step_id": row["workflow_step_id"],
            "workflow_instance_id": row["workflow_instance_id"],
            "record_key": row["record_key"],
            "next_record_key": row["next_record_key"],
            "business_rules": row["business_rules"],
            "action": "TODO_RULE_EVALUATION",
            "reason": (
                "Business-rule evaluation and transition are intentionally not implemented yet."
            ),
        }
        for row in rows
    ]


def _send_violation_emails(
    connection: Connection[dict[str, Any]],
    rows: list[dict[str, Any]],
    access_url_base: str,
) -> dict[str, Any]:
    groups: dict[tuple[UUID, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        recipient = str(
            row.get("recipient_email") or row.get("row_data", {}).get("email") or ""
        ).strip()
        if recipient and "@" in recipient:
            groups[(row["workflow_step_id"], recipient)].append(row)

    sent = 0
    errors: list[str] = []
    for (step_id, recipient), items in groups.items():
        try:
            template = _get_template(connection, step_id)
            subject, body = _render_message(template, items, access_url_base)
            claimed: list[UUID] = []
            for item in items:
                notification_id = connection.execute(
                    """
                    SELECT orbit_runtime.claim_sla_notification(%s, %s, %s, %s, %s) AS id
                    """,
                    (item["workflow_node_instance_id"], recipient, item["due_at"], subject, body),
                ).fetchone()["id"]
                if notification_id is not None:
                    claimed.append(notification_id)
            if not claimed:
                continue
            _send_email(recipient, subject, body)
            for notification_id in claimed:
                connection.execute(
                    "SELECT orbit_runtime.finish_sla_notification(%s, 'sent')",
                    (notification_id,),
                )
            for item in items:
                connection.execute(
                    """
                    SELECT orbit_runtime.record_workflow_action(
                        %s, 'notification_email', %s, %s
                    )
                    """,
                    (
                        item["workflow_node_instance_id"],
                        f"{recipient}:{item['due_at']}",
                        Jsonb({"recipient": recipient, "notification": "sla"}),
                    ),
                )
            sent += 1
        except Exception as error:  # noqa: BLE001 - continue processing other recipients
            errors.append(f"{recipient}: {error}")
            for item in items:
                connection.execute(
                    """
                    UPDATE orbit_runtime.sla_notification
                       SET status = 'failed', error_message = %s
                     WHERE workflow_node_instance_id = %s
                       AND recipient = %s AND due_at = %s AND status = 'queued'
                    """,
                    (str(error), item["workflow_node_instance_id"], recipient, item["due_at"]),
                )
    return {"emails_sent": sent, "email_errors": errors}


def _get_template(connection: Connection[dict[str, Any]], step_id: UUID) -> dict[str, str]:
    row = connection.execute(
        "SELECT * FROM orbit_workflow.get_email_template(%s) LIMIT 1", (step_id,)
    ).fetchone()
    return dict(row) if row else {
        "subject_xml": DEFAULT_SUBJECT_XML,
        "body_xml": DEFAULT_BODY_XML,
        "stylesheet_css": DEFAULT_STYLESHEET,
        "access_url_template": "",
    }


def _render_message(
    template: dict[str, str], rows: list[dict[str, Any]], access_url_base: str
) -> tuple[str, str]:
    first = rows[0]
    replacements = {
        "{{step_name}}": str(first["source_step_data"].get("label", first["record_key"])),
        "{{sla_days}}": str(first["sla_days"]),
        "{{item_count}}": str(len(rows)),
    }
    subject = _xml_text(template.get("subject_xml") or DEFAULT_SUBJECT_XML, "subject")
    body = _xml_inner(template.get("body_xml") or DEFAULT_BODY_XML, "body")
    url_template = template.get("access_url_template") or (
        f"{access_url_base.rstrip('/')}/workflows/instances/"
        "{workflow_instance_id}/runtime"
    )
    table = _items_table(rows, url_template)
    replacements["{{items_table}}"] = table
    for token, value in replacements.items():
        subject = subject.replace(token, value)
        body = body.replace(token, value)
    stylesheet = template.get("stylesheet_css") or DEFAULT_STYLESHEET
    html_body = (
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        f"{stylesheet}</style></head><body>{body}</body></html>"
    )
    return subject.strip(), html_body


def _items_table(rows: list[dict[str, Any]], url_template: str) -> str:
    cells = []
    for row in rows:
        row_uuid = str(row["row_uuid"])
        url = url_template.replace("{{row_uuid}}", row_uuid)
        url = url.replace("{{workflow_instance_id}}", str(row["workflow_instance_id"]))
        url = url.replace("{{record_key}}", str(row["record_key"]))
        cells.append(
            "<tr>"
            f"<td>{html.escape(row_uuid)}</td>"
            f"<td>{html.escape(str(row['business_key']))}</td>"
            f"<td>{html.escape(str(row['sla_text']))}</td>"
            f"<td>{html.escape(str(row['due_at']))}</td>"
            f"<td><a href=\"{html.escape(url, quote=True)}\">Open workflow item</a></td>"
            "</tr>"
        )
    return (
        "<table><thead><tr><th>Row UUID</th><th>Business Key</th><th>SLA</th>"
        "<th>Due At</th><th>Access</th></tr></thead><tbody>"
        + "".join(cells)
        + "</tbody></table>"
    )


def _xml_text(fragment: str, tag: str) -> str:
    root = ET.fromstring(fragment)
    node = root if root.tag == tag else root.find(f".//{tag}")
    return "".join(node.itertext()).strip() if node is not None else ""


def _xml_inner(fragment: str, tag: str) -> str:
    root = ET.fromstring(fragment)
    node = root if root.tag == tag else root.find(f".//{tag}")
    if node is None:
        return ""
    parts = [node.text or ""]
    for child in node:
        parts.append(ET.tostring(child, encoding="unicode"))
        parts.append(child.tail or "")
    return "".join(parts)


def _send_email(recipient: str, subject: str, html_body: str) -> None:
    settings = get_mail_settings()
    if not settings.configured:
        raise RuntimeError("SMTP is not configured")
    addresses = [address for _, address in getaddresses([recipient]) if address]
    if not addresses:
        raise RuntimeError("No valid recipient email address")
    message = EmailMessage()
    message["From"] = settings.from_address
    message["To"] = ", ".join(addresses)
    message["Subject"] = subject
    message.set_content("This message contains an HTML SLA notification.")
    message.add_alternative(html_body, subtype="html")
    smtp_type = smtplib.SMTP_SSL if settings.ssl else smtplib.SMTP
    with smtp_type(
        settings.smtp_host, settings.smtp_port, timeout=settings.timeout_seconds
    ) as client:
        client.ehlo()
        if settings.starttls and not settings.ssl:
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
        if settings.smtp_user:
            client.login(settings.smtp_user, settings.smtp_password)
        client.send_message(message)
