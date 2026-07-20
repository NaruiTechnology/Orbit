"""Administrator-only system configuration endpoints."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from psycopg import Connection

from app.auth import get_current_user, require_administration_access
from app.database import get_connection
from app.schemas import SessionInfo
from app.services.localization import localized_value

router = APIRouter(prefix="/admin", tags=["admin"])


class WorkflowStepAssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    laboratory_id: UUID | None = None
    phone_number: str = Field(default="", max_length=80)
    contact_email: str = Field(default="", max_length=320)
    contact_name: str = Field(default="", max_length=200)
    hr_employee_id: UUID | None = None


def _require_admin(user: SessionInfo, connection: Connection[dict[str, Any]]) -> None:
    require_administration_access(connection, user.user_id)


@router.get("/workflow-config/{workflow_key}")
def workflow_config(
    workflow_key: str,
    locale: str = Query(default="en"),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    _require_admin(user, connection)
    definition = connection.execute(
        "SELECT id, name_i18n FROM orbit_workflow.workflow_definition WHERE workflow_key = %s AND is_active",
        (workflow_key,),
    ).fetchone()
    if definition is None:
        raise HTTPException(status_code=404, detail="workflow not found")

    # Keep configuration rows aligned with the current catalog/imported steps.
    connection.execute(
        """
        INSERT INTO orbit_workflow.workflow_step_assignment (workflow_record_id)
        SELECT r.id
          FROM orbit_workflow.workflow_record r
         WHERE r.workflow_id = %s
        ON CONFLICT (workflow_record_id) DO NOTHING
        """,
        (definition["id"],),
    )
    laboratories = connection.execute(
        """
        SELECT id, code, name_i18n
          FROM orbit_identity.laboratory
         WHERE is_active
         ORDER BY code
        """
    ).fetchall()
    steps = connection.execute(
        """
        SELECT r.id, r.record_key, r.record_order, r.label_i18n,
               a.laboratory_id, l.code AS laboratory_code, l.name_i18n AS laboratory_name_i18n,
               a.phone_number, a.contact_email, a.contact_name, a.hr_employee_id
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_step_assignment a ON a.workflow_record_id = r.id
          LEFT JOIN orbit_identity.laboratory l ON l.id = a.laboratory_id
         WHERE r.workflow_id = %s
         ORDER BY r.record_order
        """,
        (definition["id"],),
    ).fetchall()
    return {
        "workflow_key": workflow_key,
        "workflow_name": localized_value(definition["name_i18n"], locale),
        "laboratories": [
            {"id": row["id"], "code": row["code"], "name": localized_value(row["name_i18n"], locale)}
            for row in laboratories
        ],
        "steps": [
            {
                "id": row["id"],
                "record_key": row["record_key"],
                "record_order": row["record_order"],
                "step_name": localized_value(row["label_i18n"], locale),
                "laboratory_id": row["laboratory_id"],
                "laboratory_code": row["laboratory_code"],
                "laboratory_name": localized_value(row["laboratory_name_i18n"], locale) if row["laboratory_name_i18n"] else None,
                "phone_number": row["phone_number"],
                "contact_email": row["contact_email"],
                "contact_name": row["contact_name"],
                "hr_employee_id": row["hr_employee_id"],
            }
            for row in steps
        ],
    }


@router.patch("/workflow-config/{workflow_key}/steps/{record_id}")
def update_workflow_step(
    workflow_key: str,
    record_id: UUID,
    request: WorkflowStepAssignmentUpdate,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    _require_admin(user, connection)
    updated = connection.execute(
        """
        UPDATE orbit_workflow.workflow_step_assignment a
           SET laboratory_id = %s, phone_number = %s, contact_email = %s,
               contact_name = %s,
               hr_employee_id = %s, updated_by = %s, updated_at = CURRENT_TIMESTAMP
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
         WHERE a.workflow_record_id = r.id
           AND r.id = %s AND w.workflow_key = %s
         RETURNING a.workflow_record_id
        """,
        (request.laboratory_id, request.phone_number.strip(), request.contact_email.strip(),
         request.contact_name.strip(), request.hr_employee_id, user.user_id, record_id, workflow_key),
    ).fetchone()
    if updated is None:
        raise HTTPException(status_code=404, detail="workflow step not found")
    return {"ok": True, "record_id": updated["workflow_record_id"]}
