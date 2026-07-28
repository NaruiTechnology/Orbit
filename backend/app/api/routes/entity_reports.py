"""Business-entity XML report endpoint."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from psycopg import Connection

from app.auth import get_current_user, require_workflow_access
from app.database import get_connection
from app.schemas import SessionInfo
from app.services.entity_report_service import (
    ENTITY_REPORT_XSL,
    fetch_entity_report,
    persist_entity_report,
    render_entity_report_html,
    render_entity_report_xml,
)

router = APIRouter(tags=["entity reports"])


class ReportTemplateRequest(BaseModel):
    customerRelations: str = Field(min_length=1, max_length=80)
    workflow_key: str = Field(min_length=1, max_length=140)
    record_key: str = Field(min_length=1, max_length=140)
    theme: str = Field(default="navy", pattern="^(navy|light|green|black)$")


@router.get("/GenerateReportTemplate", response_class=Response)
def generate_report_template(
    customer_relations: str = Query(..., alias="customerRelations", description="Customer Relations translation key or label"),
    workflow_key: str = Query(..., description="Workflow catalog key, for example order-evaluation"),
    record_key: str = Query(..., description="Workflow catalog record_key"),
    theme: str = Query(default="navy", pattern="^(navy|light|green|black)$"),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> Response:
    require_workflow_access(connection, user.user_id, workflow_key, "view")
    report = fetch_entity_report(connection, user, customer_relations, workflow_key, record_key)
    report["theme"] = theme
    return Response(
        content=render_entity_report_xml(report),
        media_type="application/xml",
        headers={"Content-Disposition": "inline; filename=business-entity-report.xml"},
    )


@router.post("/GenerateReportTemplate/save")
def save_report_template(
    request: ReportTemplateRequest,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    require_workflow_access(connection, user.user_id, request.workflow_key, "execute")
    report = fetch_entity_report(
        connection, user, request.customerRelations, request.workflow_key, request.record_key
    )
    report["theme"] = request.theme
    source_xml = render_entity_report_xml(report)
    return persist_entity_report(
        connection, user, report, source_xml, render_entity_report_html(report)
    )


@router.get("/GenerateReportTemplate/stylesheet.xsl", response_class=Response)
def generate_report_template_stylesheet() -> Response:
    return Response(content=ENTITY_REPORT_XSL, media_type="application/xslt+xml")


@router.get("/workflows/{workflow_key}/steps/{record_id}/report", response_class=Response)
def download_saved_report(
    workflow_key: str,
    record_id: UUID,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> Response:
    require_workflow_access(connection, user.user_id, workflow_key, "view")
    report = connection.execute(
        """
        SELECT document_html
          FROM orbit_workflow.workflow_step_report
         WHERE workflow_key = %s AND workflow_record_id = %s
        """,
        (workflow_key, record_id),
    ).fetchone()
    if report is None:
        return Response(content="Saved report not found", status_code=404, media_type="text/plain")
    return Response(
        content=report["document_html"],
        media_type="text/html",
        headers={"Content-Disposition": f"inline; filename=workflow-step-{record_id}.html"},
    )
