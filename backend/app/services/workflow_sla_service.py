"""SLA monitoring, template rendering, and the Orbit service worker boundary."""

from __future__ import annotations

import html
import json
import smtplib
import ssl
from collections import defaultdict
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import getaddresses
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.types.json import Jsonb

from app.config import get_mail_settings

def get_sla_workflow_steps(
    connection: Connection[dict[str, Any]],
    workflow_step_id: UUID | None = None,
    as_of: datetime | None = None,
    locale: str = "en",
) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT * FROM orbit_runtime.get_sla_workflow_steps(%s, %s)",
        (as_of, workflow_step_id),
    ).fetchall()
    return _attach_step_configuration(connection, rows, locale)


def _attach_step_configuration(
    connection: Connection[dict[str, Any]], rows: list[dict[str, Any]], locale: str
) -> list[dict[str, Any]]:
    """Attach the workflow/step names and raw SLA source used by each check."""
    step_ids = [row["workflow_step_id"] for row in rows]
    if not step_ids:
        return rows
    locale_key = {"zh-CN": "zh_CN", "zh-HK": "zh_HK"}.get(locale, "en")
    configured = connection.execute(
        """
        SELECT r.id AS workflow_step_id,
               COALESCE(w.name_i18n ->> %s, w.name_i18n ->> 'en', w.workflow_key) AS workflow_name,
               COALESCE(r.label_i18n ->> %s, r.label_i18n ->> 'en', r.record_key) AS step_name,
               COALESCE(a.sla, r.values_json ->> 'time_limit') AS sla_configured,
               a."notifyAction" AS notify_action,
               a."notifyType" AS notify_type,
               a.contact_name AS contact_name,
               a.contact_email AS contact_email,
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
        (locale_key, locale_key, step_ids),
    ).fetchall()
    by_id = {row["workflow_step_id"]: row for row in configured}
    instance_ids = list({row["workflow_instance_id"] for row in rows if row.get("workflow_instance_id")})
    customer_rows = connection.execute(
        """
        SELECT i.id AS workflow_instance_id,
               c.customer_name
          FROM orbit_runtime.workflow_instance i
          LEFT JOIN orbit_sales.customer_order c
            ON c.id::text = i.context_json ->> 'order_id'
            OR c.order_number = i.business_key
         WHERE i.id = ANY(%s)
        """,
        (instance_ids,),
    ).fetchall() if instance_ids else []
    customer_by_instance = {row["workflow_instance_id"]: row["customer_name"] for row in customer_rows}
    return [
        {
            **row,
            "workflow_name": by_id.get(row["workflow_step_id"], {}).get("workflow_name"),
            "step_name": by_id.get(row["workflow_step_id"], {}).get("step_name"),
            "sla_configured": by_id.get(row["workflow_step_id"], {}).get("sla_configured"),
            "sla_source": by_id.get(row["workflow_step_id"], {}).get("sla_source"),
            "notify_type": by_id.get(row["workflow_step_id"], {}).get("notify_type"),
            "notify_action": by_id.get(row["workflow_step_id"], {}).get("notify_action"),
            "customer_name": customer_by_instance.get(row.get("workflow_instance_id")),
            "contact_name": by_id.get(row["workflow_step_id"], {}).get("contact_name") or row.get("recipient_name"),
            "contact_email": by_id.get(row["workflow_step_id"], {}).get("contact_email") or row.get("recipient_email"),
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


def run_sla_cycle(
    connection: Connection[dict[str, Any]], access_url_base: str, locale: str = "en"
) -> dict[str, Any]:
    """Run both SLA passes using one snapshot of the catalog/runtime query."""
    rows = get_sla_workflow_steps(connection, locale=locale)
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
                    "notify_type": row.get("notify_type"),
                    "notify_action": row.get("notify_action"),
                }
            ),
            flush=True,
        )
    violations = [row for row in rows if row["sla_violated"]]
    _mark_overdue_steps_for_notification(connection, violations)
    email_result = _send_violation_emails(connection, violations, access_url_base, locale)
    decisions = _placeholder_decisions(rows)
    return {
        "checked": len(rows),
        "violations": len(violations),
        "emails_sent": email_result["emails_sent"],
        "email_errors": email_result["email_errors"],
        "decisions": decisions,
    }


def _mark_overdue_steps_for_notification(
    connection: Connection[dict[str, Any]], rows: list[dict[str, Any]]
) -> None:
    """Expose an overdue SLA as an outstanding notification action in the tree."""
    step_ids = {row["workflow_step_id"] for row in rows if row.get("workflow_step_id")}
    if not step_ids:
        return
    connection.execute(
        """
        UPDATE orbit_workflow.workflow_step_assignment
           SET "notifyAction" = false,
               updated_at = CURRENT_TIMESTAMP
         WHERE workflow_record_id = ANY(%s)
        """,
        (list(step_ids),),
    )


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
    locale: str,
) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    seen_items: set[tuple[UUID, str, datetime]] = set()
    for row in rows:
        for recipient, contact_name in _recipient_targets(row):
            item_key = (row["workflow_node_instance_id"], recipient, row["due_at"])
            if item_key in seen_items:
                continue
            seen_items.add(item_key)
            target_row = {**row, "contact_email": recipient, "contact_name": contact_name}
            groups[recipient.lower()].append(target_row)

    sent = 0
    errors: list[str] = []
    for items in groups.values():
        recipient = str(items[0]["contact_email"])
        try:
            notify_types = {item.get("notify_type") for item in items}
            templates = [_get_notification_template(connection, notify_type, locale) for notify_type in notify_types]
            template = templates[0]
            subject, body = _render_professional_message(template, items, access_url_base, locale)
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


def _recipient_targets(row: dict[str, Any]) -> list[tuple[str, str]]:
    """Return normalized individual recipients for one SLA row."""
    raw_email = str(row.get("recipient_email") or row.get("row_data", {}).get("email") or "")
    addresses = [address for _, address in getaddresses([raw_email.replace(";", ",")]) if address and "@" in address]
    if not addresses:
        return []
    names = [item.strip() for item in str(row.get("contact_name") or row.get("recipient_name") or "").replace(";", ",").split(",") if item.strip()]
    return [(address.strip(), names[index] if index < len(names) else (names[0] if names else "")) for index, address in enumerate(addresses)]


def _get_notification_template(
    connection: Connection[dict[str, Any]], notify_type: int | None, locale: str
) -> dict[str, str]:
    if notify_type is None:
        raise RuntimeError("No notifyType is configured for the SLA workflow step")
    locale_key = {"zh-CN": "zh_CN", "zh-HK": "zh_HK"}.get(locale, "en")
    row = connection.execute(
        """
        SELECT notify_type,
               COALESCE(template_title ->> %s, template_title ->> 'en', template_title ->> 'zh_CN') AS template_title,
               COALESCE(template_body ->> %s, template_body ->> 'en', template_body ->> 'zh_CN') AS template_body,
               COALESCE(notification_scenario ->> %s, notification_scenario ->> 'en', notification_scenario ->> 'zh_CN') AS scenario,
               COALESCE(notification_channel ->> %s, notification_channel ->> 'en', notification_channel ->> 'zh_CN') AS channel
          FROM orbit_workflow.notify
         WHERE notify_type = %s
        """,
        (locale_key, locale_key, locale_key, locale_key, notify_type),
    ).fetchone()
    if row is None:
        raise RuntimeError(f"Notification template not found for notifyType={notify_type}")
    return dict(row)


def _render_professional_message(
    template: dict[str, str], rows: list[dict[str, Any]], access_url_base: str, locale: str
) -> tuple[str, str]:
    first = rows[0]
    labels = _email_labels(locale)
    step_names = {_display_step_name(row, str(row.get("step_name") or row["source_step_data"].get("label", row["record_key"])), locale) for row in rows}
    display_step_name = next(iter(step_names)) if len(step_names) == 1 else labels["workflow_items"]
    subject = f"{display_step_name} — {labels['subject']}" if len(step_names) == 1 else f"{labels['subject']} — {len(rows)} {labels['items']}"
    url_template = (
        f"{access_url_base.rstrip('/')}/workflows/instances/"
        "{workflow_instance_id}/runtime"
    )
    table = _items_table(rows, url_template, locale)
    contact_name = str(first.get("contact_name") or first.get("recipient_name") or "there")
    greeting_separator = " " if locale == "en" else ""
    greeting = f"{labels['greeting']}{greeting_separator}{html.escape(contact_name)}{labels['greeting_suffix']}"
    message = labels["message"].format(step=html.escape(display_step_name))
    overview = f"<p class='greeting'>{greeting}</p>"
    summary = (
        "<div class='summary'>"
        f"<div><span>{labels['workflow']}</span><strong>{html.escape(str(first.get('workflow_name') or first.get('workflow_key') or '-'))}</strong></div>"
        f"<div><span>{labels['step']}</span><strong>{html.escape(display_step_name)}</strong></div>"
        f"<div><span>{labels['overdue_items']}</span><strong>{len(rows)}</strong></div>"
        "</div>"
    )
    html_body = f"""<!doctype html>
<html><head><meta charset="utf-8"><style>
body{{margin:0;background:#f4f7fb;color:#24324a;font-family:Arial,sans-serif}}
.wrap{{max-width:1100px;margin:24px auto;background:#fff;border:1px solid #d9e2ef;border-radius:12px;overflow:hidden}}
.header{{padding:24px 28px;background:#17345f;color:#fff}}
.brand{{font-size:11px;letter-spacing:2px;color:#8ed0ff;font-weight:bold}}
h1{{margin:8px 0 0;font-size:24px}} .content{{padding:24px 28px}}
.greeting{{font-size:16px}} .summary{{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}}
.summary div{{min-width:150px;padding:12px 14px;background:#f0f5fb;border-radius:8px}}
.summary span{{display:block;color:#6b7b91;font-size:11px;text-transform:uppercase;letter-spacing:.6px}}
.summary strong{{display:block;margin-top:5px}} .template{{padding:14px 16px;border-left:4px solid #ef9b35;background:#fff8ed}}
table{{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px}}
th{{background:#eaf0f7;text-align:left;color:#40536c}} th,td{{border:1px solid #d5deea;padding:10px 9px;vertical-align:top}}
td.alert{{color:#b42318;font-weight:bold}} a{{color:#1267b1}} .footer{{padding:16px 28px;color:#6b7b91;font-size:12px;background:#f7f9fc}}
</style></head><body><div class="wrap"><div class="header"><div class="brand">ORBIT AUTOMATION</div>
<h1>{html.escape(subject)}</h1></div><div class="content">{overview}{summary}
<div class="template"><strong>{labels['notification_message']}</strong><br>{message}</div>{table}
</div><div class="footer">This notification was generated automatically by the Orbit SLA monitoring service.</div>
</div></body></html>"""
    return subject, html_body


def _display_step_name(row: dict[str, Any], step_name: str, locale: str) -> str:
    source_name = str(row.get("source_step_data", {}).get("label") or step_name)
    if source_name == "Proceed to Official Order":
        return {"zh-CN": "正式订单", "zh-HK": "正式訂單"}.get(locale, "Official Order")
    return step_name


def _email_labels(locale: str) -> dict[str, str]:
    if locale == "zh-CN":
        return {"subject": "SLA逾期", "greeting": "您好，", "greeting_suffix": "：", "workflow": "工作流", "step": "步骤", "workflow_items": "工作流项目", "items": "项目", "overdue_items": "逾期项目", "notification_message": "通知消息", "message": "以下{step}已超过SLA截止时间，请立即处理。"}
    if locale == "zh-HK":
        return {"subject": "SLA逾期", "greeting": "您好，", "greeting_suffix": "：", "workflow": "工作流程", "step": "步驟", "workflow_items": "工作流程項目", "items": "項目", "overdue_items": "逾期項目", "notification_message": "通知訊息", "message": "以下{step}已超過SLA截止時間，請立即處理。"}
    return {"subject": "SLA overdue", "greeting": "Hi", "greeting_suffix": ",", "workflow": "Workflow", "step": "Step", "workflow_items": "workflow items", "items": "items", "overdue_items": "Overdue items", "notification_message": "Notification message", "message": "The following {step} passed the SLA due time. Please proceed immediately."}


def _email_table_labels(locale: str) -> dict[str, str]:
    if locale == "zh-CN":
        return {"workflow": "工作流", "step": "步骤", "customer": "客户名称", "business_key": "业务编号", "contact": "联系人 / 邮箱", "sla": "SLA", "step_start": "步骤开始", "due_at": "截止时间", "overdue": "逾期时长", "access": "访问"}
    if locale == "zh-HK":
        return {"workflow": "工作流程", "step": "步驟", "customer": "客戶名稱", "business_key": "業務編號", "contact": "聯絡人 / 電郵", "sla": "SLA", "step_start": "步驟開始", "due_at": "截止時間", "overdue": "逾期時長", "access": "訪問"}
    return {"workflow": "Workflow", "step": "Step", "customer": "Customer Name", "business_key": "Business Key", "contact": "Contact Person / Email", "sla": "SLA", "step_start": "Step Start", "due_at": "Due At", "overdue": "Overdue", "access": "Access"}


def _items_table(rows: list[dict[str, Any]], url_template: str, locale: str) -> str:
    labels = _email_table_labels(locale)
    cells = []
    for row in rows:
        row_uuid = str(row["row_uuid"])
        url = url_template.replace("{{row_uuid}}", row_uuid)
        url = url.replace("{{workflow_instance_id}}", str(row["workflow_instance_id"]))
        url = url.replace("{{record_key}}", str(row["record_key"]))
        cells.append(
            "<tr>"
            f"<td>{html.escape(str(row.get('workflow_name') or row.get('workflow_key') or '-'))}</td>"
            f"<td>{html.escape(str(row.get('step_name') or row.get('record_key') or '-'))}</td>"
            f"<td>{html.escape(str(row.get('customer_name') or '-'))}</td>"
            f"<td>{html.escape(str(row['business_key']))}</td>"
            f"<td>{html.escape(str(row.get('contact_name') or '-'))}<br><small>{html.escape(str(row.get('contact_email') or '-'))}</small></td>"
            f"<td>{html.escape(str(row['sla_text']))}</td>"
            f"<td>{html.escape(_format_datetime(row.get('started_at')))}</td>"
            f"<td>{html.escape(str(row['due_at']))}</td>"
            f"<td class='alert'>{html.escape(_overdue_text(row['due_at']))}</td>"
            f"<td><a href=\"{html.escape(url, quote=True)}\">Open workflow item</a></td>"
            "</tr>"
        )
    return (
        f"<table><thead><tr><th>{labels['workflow']}</th><th>{labels['step']}</th><th>{labels['customer']}</th><th>{labels['business_key']}</th><th>{labels['contact']}</th>"
        f"<th>{labels['sla']}</th><th>{labels['step_start']}</th><th>{labels['due_at']}</th><th>{labels['overdue']}</th><th>{labels['access']}</th></tr></thead><tbody>"
        + "".join(cells)
        + "</tbody></table>"
    )


def _overdue_text(value: Any) -> str:
    if not isinstance(value, datetime):
        return "-"
    due = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    minutes = max(0, int((datetime.now(due.tzinfo) - due).total_seconds() // 60))
    return f"{minutes / 1440:.2f} days ({minutes:,} minutes)"


def _format_datetime(value: Any) -> str:
    if not isinstance(value, datetime):
        return "-"
    return value.strftime("%Y-%m-%d %H:%M %z")


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
