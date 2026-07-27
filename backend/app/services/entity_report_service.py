"""Business-entity report payloads and XML/XSLT rendering."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from html import escape
from typing import Any
from uuid import UUID
from xml.etree.ElementTree import Element, SubElement, tostring

from fastapi import HTTPException
from psycopg import Connection, sql

from app.schemas import SessionInfo

_SYSTEM_COLUMNS = {
    "id", "organization_id", "department_id", "laboratory_id", "version",
    "created_at", "updated_at",
}
_ALLOWED_TABLES = {
    "customer_profile", "billing_information", "quotation", "contract",
    "sales_order", "chip_retention", "bill", "payment_collection",
    "outsourced_service",
}


def _xml_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, UUID):
        return str(value)
    return str(value)


def _columns(connection: Connection[dict[str, Any]], table_name: str) -> list[dict[str, str]]:
    rows = connection.execute(
        """
        SELECT column_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'orbit_sales'
           AND table_name = %s
           AND column_name <> ALL(%s)
         ORDER BY ordinal_position
        """,
        (table_name, list(_SYSTEM_COLUMNS)),
    ).fetchall()
    return [{"key": row["column_name"], "data_type": row["data_type"]} for row in rows]


def _all_column_names(connection: Connection[dict[str, Any]], table_name: str) -> set[str]:
    rows = connection.execute(
        """
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'orbit_sales' AND table_name = %s
        """,
        (table_name,),
    ).fetchall()
    return {row["column_name"] for row in rows}


def _scope_predicate(user: SessionInfo, column_names: set[str]) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    values: list[Any] = []
    if "organization_id" in column_names:
        clauses.append("organization_id = %s")
        values.append(user.scope.organization_id)
    if "department_id" in column_names:
        clauses.append("(department_id IS NULL OR department_id = %s)")
        values.append(user.scope.department_id)
    if "laboratory_id" in column_names:
        clauses.append("(laboratory_id IS NULL OR laboratory_id = %s)")
        values.append(user.scope.laboratory_id)
    return " AND ".join(clauses) or "TRUE", values


def fetch_entity_report(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    customer_relations: str,
    workflow_key: str,
    record_key: str,
) -> dict[str, Any]:
    """Resolve a workflow step to its configured entity and fetch scoped rows."""
    if customer_relations not in {"customerRelations", "Customer Relations", "客户关系", "客戶關係"}:
        raise HTTPException(status_code=400, detail="customerRelations must identify Customer Relations")

    assignment = connection.execute(
        """
        SELECT r.id AS record_id, a.business_entity, r.label_i18n, w.name_i18n
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
          LEFT JOIN orbit_workflow.workflow_step_assignment a
            ON a.workflow_record_id = r.id
         WHERE w.workflow_key = %s AND r.record_key = %s AND w.is_active
        """,
        (workflow_key, record_key),
    ).fetchone()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Workflow record not found")
    if not assignment["business_entity"]:
        raise HTTPException(status_code=422, detail="Workflow record has no Business entity assignment")

    catalog = connection.execute(
        """
        SELECT entity_key, table_name, name_i18n
          FROM orbit_sales.business_entity_catalog
         WHERE is_active
           AND (entity_key = %s OR name_i18n ->> 'en' = %s
                OR name_i18n ->> 'zh_CN' = %s OR name_i18n ->> 'zh_HK' = %s)
        """,
        (assignment["business_entity"],) * 4,
    ).fetchone()
    if catalog is None or catalog["table_name"] not in _ALLOWED_TABLES:
        raise HTTPException(status_code=404, detail="Configured Business entity not found")

    fields = _columns(connection, catalog["table_name"])
    column_names = _all_column_names(connection, catalog["table_name"])
    scope_sql, scope_values = _scope_predicate(user, column_names)
    selected = ["id", *(field["key"] for field in fields), "version", "updated_at"]
    rows = connection.execute(
        sql.SQL("SELECT {} FROM orbit_sales.{} WHERE {} ORDER BY updated_at DESC").format(
            sql.SQL(", ").join(sql.Identifier(name) for name in selected),
            sql.Identifier(catalog["table_name"]),
            sql.SQL(scope_sql),
        ),
        scope_values,
    ).fetchall()
    context_row = connection.execute(
        """
        SELECT i.business_key, i.status, i.current_record_key,
               i.context_json ->> 'order_id' AS order_id
          FROM orbit_runtime.workflow_instance i
          JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
         WHERE w.workflow_key = %s
           AND i.current_record_key = %s
           AND i.organization_id = %s
         ORDER BY i.updated_at DESC
         LIMIT 1
        """,
        (workflow_key, record_key, user.scope.organization_id),
    ).fetchone()
    context: dict[str, Any] = {
        "business_key": context_row["business_key"] if context_row else None,
        "workflow_status": context_row["status"] if context_row else None,
        "current_record_key": context_row["current_record_key"] if context_row else record_key,
    }
    if context_row and context_row["order_id"]:
        order = connection.execute(
            """
            SELECT order_number, customer_code, customer_name, customer_contact,
                   chip_name, chip_model, package_type, quantity, priority, status
              FROM orbit_sales.customer_order
             WHERE id = %s
            """,
            (context_row["order_id"],),
        ).fetchone()
        if order:
            context.update({key: order[key] for key in order.keys()})
    return {
        "customer_relations": customer_relations,
        "record_id": assignment["record_id"],
        "workflow_key": workflow_key,
        "record_key": record_key,
        "business_entity": assignment["business_entity"],
        "entity_key": catalog["entity_key"],
        "table_name": catalog["table_name"],
        "fields": fields,
        "rows": [dict(row) for row in rows],
        "context": context,
    }


def render_entity_report_xml(report: dict[str, Any]) -> bytes:
    root = Element("entity-report", {
        "workflow-key": report["workflow_key"],
        "record-key": report["record_key"],
        "entity-key": report["entity_key"],
        "theme": report.get("theme", "navy"),
    })
    metadata = SubElement(root, "metadata")
    for key in ("customer_relations", "business_entity", "table_name"):
        SubElement(metadata, key.replace("_", "-")).text = _xml_value(report[key])
    context_node = SubElement(root, "context")
    for key, value in report.get("context", {}).items():
        SubElement(context_node, "item", {"key": key}).text = _xml_value(value)
    fields_node = SubElement(root, "fields")
    for field in report["fields"]:
        SubElement(fields_node, "field", {"key": field["key"], "data-type": field["data_type"]})
    rows_node = SubElement(root, "records")
    for row in report["rows"]:
        record_node = SubElement(rows_node, "record", {"id": _xml_value(row["id"])})
        for field in report["fields"]:
            SubElement(record_node, "value", {"field": field["key"]}).text = _xml_value(row[field["key"]])
    return b'<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/api/v1/GenerateReportTemplate/stylesheet.xsl"?>\n' + tostring(root, encoding="utf-8")


def render_entity_report_html(report: dict[str, Any]) -> str:
    context = "".join(
        f"<div class=\"context-item\"><dt>{escape(key.replace('_', ' '))}</dt><dd>{escape(_xml_value(value))}</dd></div>"
        for key, value in report.get("context", {}).items() if value not in (None, "")
    )
    cards = []
    for row in report["rows"]:
        values = "".join(
            f"<div class=\"field\"><dt>{escape(field['key'].replace('_', ' '))}</dt><dd>{escape(_xml_value(row[field['key']])) or '—'}</dd></div>"
            for field in report["fields"]
        )
        cards.append(f"<section class=\"record-card\"><h2>Record {_xml_value(row['id'])}</h2><dl>{values}</dl></section>")
    theme = report.get("theme", "navy")
    return f"""<!doctype html>
<html lang="en" class="theme-{escape(theme)}"><head><meta charset="utf-8"><title>{escape(report['business_entity'])} report</title>
<style>@page{{size:A4;margin:16mm 14mm}}:root{{--accent:#2769a8;--accent-soft:#e8f1fb;--ink:#17233f;--muted:#61718b;--paper:#fff;--line:#cbd6e5}}body{{font:13px Arial,sans-serif;margin:0;color:var(--ink);background:var(--paper)}}.theme-light{{--accent:#236a93;--accent-soft:#edf7fb;--ink:#17233f;--muted:#607082;--line:#c8d9e0}}.theme-green{{--accent:#23866c;--accent-soft:#e7f6f0;--ink:#163b32;--muted:#607c73;--line:#c5ded5}}.theme-black{{--accent:#d68b3b;--accent-soft:#f7eee3;--ink:#292522;--muted:#756b63;--line:#d9c9b8}}header{{border-bottom:4px solid var(--accent);padding-bottom:14px;margin-bottom:18px}}h1{{font-size:26px;margin:0 0 6px}}h2{{font-size:16px;margin:0 0 12px;color:var(--accent)}}.eyebrow{{color:var(--accent);font-size:10px;font-weight:bold;letter-spacing:.16em;text-transform:uppercase}}.subtitle{{color:var(--muted);margin:0}}.context{{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:22px}}.context-item,.field{{margin:0;padding:9px 11px;background:var(--accent-soft);border:1px solid var(--line);border-radius:5px}}dt{{color:var(--muted);font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.04em}}dd{{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}}.record-card{{break-inside:avoid;page-break-inside:avoid;border:1px solid var(--line);border-top:4px solid var(--accent);border-radius:6px;padding:14px;margin:0 0 18px}}.record-card + .record-card{{break-before:page}}.record-card dl{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}}.field{{background:transparent}}.footer{{margin-top:24px;color:var(--muted);font-size:10px;border-top:1px solid var(--line);padding-top:8px}}@media print{{body{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}.record-card{{box-shadow:none}}}}
</style></head><body><header><div class="eyebrow">Orbit Automation · Document</div><h1>{escape(report['business_entity'])}</h1><p class="subtitle">Workflow: {escape(report['workflow_key'])} · Step: {escape(report['record_key'])}</p></header>
<dl class="context">{context}</dl>{''.join(cards)}<div class="footer">Generated by Orbit Automation</div>
</body></html>"""


def persist_entity_report(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    report: dict[str, Any],
    source_xml: bytes,
    document_html: str,
) -> dict[str, Any]:
    step = connection.execute(
        """
        SELECT r.id
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
         WHERE r.id = %s AND w.workflow_key = %s
        """,
        (report["record_id"], report["workflow_key"]),
    ).fetchone()
    if step is None:
        raise HTTPException(status_code=404, detail="Workflow step not found")
    connection.execute(
        """
        INSERT INTO orbit_workflow.workflow_step_report
            (workflow_record_id, workflow_key, source_xml, document_html, created_by)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (workflow_record_id) DO UPDATE SET
            workflow_key = EXCLUDED.workflow_key,
            source_xml = EXCLUDED.source_xml,
            document_html = EXCLUDED.document_html,
            created_by = EXCLUDED.created_by,
            updated_at = CURRENT_TIMESTAMP
        """,
        (report["record_id"], report["workflow_key"], source_xml.decode("utf-8"), document_html, user.user_id),
    )
    connection.execute(
        """
        UPDATE orbit_workflow.workflow_step_assignment a
           SET "documentAction" = true, updated_at = CURRENT_TIMESTAMP, updated_by = %s
          FROM orbit_workflow.workflow_record r
         WHERE a.workflow_record_id = r.id
           AND r.id = %s
        """,
        (user.user_id, report["record_id"]),
    )
    return {
        "record_id": report["record_id"],
        "DocumentAction": True,
        "download_url": f"/api/v1/workflows/{report['workflow_key']}/steps/{report['record_id']}/report",
        "content_type": "text/html",
    }


ENTITY_REPORT_XSL = b'''<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8"/>
  <xsl:template match="/">
    <html><head><meta charset="utf-8"/><title><xsl:value-of select="entity-report/metadata/business-entity"/></title><style>@page{size:A4;margin:16mm 14mm}body{font:13px Arial,sans-serif;color:#17233f}header{border-bottom:4px solid #2769a8;padding-bottom:14px;margin-bottom:18px}.eyebrow{color:#2769a8;font-size:10px;font-weight:bold;letter-spacing:.16em;text-transform:uppercase}h1{font-size:26px;margin:6px 0}.subtitle{color:#61718b}.context{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:22px}.context-item,.field{padding:9px 11px;background:#e8f1fb;border:1px solid #cbd6e5;border-radius:5px}dt{color:#61718b;font-size:10px;font-weight:bold;text-transform:uppercase}dd{margin:4px 0;overflow-wrap:anywhere}.record-card{break-inside:avoid;page-break-inside:avoid;border:1px solid #cbd6e5;border-top:4px solid #2769a8;border-radius:6px;padding:14px;margin-bottom:18px}.record-card + .record-card{break-before:page}.record-card dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.field{background:transparent}</style></head><body>
      <header><div class="eyebrow">Orbit Automation - Document</div><h1><xsl:value-of select="entity-report/metadata/business-entity"/></h1><p class="subtitle">Workflow: <xsl:value-of select="entity-report/@workflow-key"/> - Step: <xsl:value-of select="entity-report/@record-key"/></p></header>
      <dl class="context"><xsl:for-each select="entity-report/context/item"><div class="context-item"><dt><xsl:value-of select="@key"/></dt><dd><xsl:value-of select="."/></dd></div></xsl:for-each></dl>
      <xsl:for-each select="entity-report/records/record"><xsl:variable name="record" select="."/><section class="record-card"><h2>Document record</h2><dl><xsl:for-each select="/entity-report/fields/field"><div class="field"><dt><xsl:value-of select="@key"/></dt><dd><xsl:value-of select="$record/value[@field=current()/@key]"/></dd></div></xsl:for-each></dl></section></xsl:for-each>
    </body></html>
  </xsl:template>
</xsl:stylesheet>'''
