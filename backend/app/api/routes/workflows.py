"""Workflow definition, grid record, tree, and runtime endpoints."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import Connection

from app.auth import get_current_user, require_workflow_access
from app.database import get_connection
from app.schemas import (
    InstanceStartRequest,
    InstanceTransitionRequest,
    RecordCreateRequest,
    RecordPage,
    RecordUpdateRequest,
    SessionInfo,
    WorkflowCommandRequest,
    WorkflowDetail,
    WorkflowInstance,
    WorkflowRecord,
    WorkflowRuntimeProjection,
    WorkflowStepMessageRequest,
    WorkflowStepMessagesResponse,
    WorkflowSummary,
    WorkflowTree,
)
from app.services.workflow_repository import (
    append_workflow_step_message,
    command_instance,
    create_record,
    delete_record,
    get_runtime_projection,
    get_tree,
    get_workflow,
    list_decision_options,
    list_records,
    list_workflows,
    start_instance,
    transition_instance,
    update_record,
)
from app.services.workflow_sla_service import evaluate_sla_workflow_steps

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.post("/steps/{workflow_step_id}/sla-advance")
def workflow_sla_advance(
    workflow_step_id: UUID,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    """Run the SLA/rule evaluation placeholder for one catalog step UUID."""
    step = connection.execute(
        """
        SELECT w.workflow_key
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
         WHERE r.id = %s
        """,
        (workflow_step_id,),
    ).fetchone()
    if step is None:
        raise HTTPException(status_code=404, detail="Workflow step not found")
    require_workflow_access(connection, user.user_id, step["workflow_key"], "execute")
    return {
        "workflow_step_id": workflow_step_id,
        "results": evaluate_sla_workflow_steps(connection, workflow_step_id),
    }


@router.get("", response_model=list[WorkflowSummary])
def workflows(
    locale: str = Query(default="zh-CN"),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> list[WorkflowSummary]:
    return list_workflows(connection, user, locale)


@router.get("/{workflow_key}", response_model=WorkflowDetail)
def workflow_detail(
    workflow_key: str,
    locale: str = Query(default="zh-CN"),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> WorkflowDetail:
    return get_workflow(connection, user, workflow_key, locale)


@router.get("/{workflow_key}/decision-options")
def workflow_decision_options(
    workflow_key: str,
    locale: str = Query(default="zh-CN"),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> list[dict[str, Any]]:
    return [item.model_dump() for item in list_decision_options(connection, user, workflow_key, locale)]


@router.get("/{workflow_key}/records", response_model=RecordPage)
def workflow_records(
    workflow_key: str,
    locale: str = Query(default="zh-CN"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=250, ge=1, le=500),
    sort_by: str = Query(default="record_order"),
    sort_direction: Literal["asc", "desc"] = Query(default="asc"),
    search: str | None = Query(default=None, max_length=200),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> RecordPage:
    return list_records(
        connection,
        user,
        workflow_key,
        locale,
        offset,
        limit,
        sort_by,
        sort_direction,
        search,
    )


@router.patch("/{workflow_key}/records/{record_id}", response_model=WorkflowRecord)
def workflow_record_update(
    workflow_key: str,
    record_id: UUID,
    request: RecordUpdateRequest,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> WorkflowRecord:
    return update_record(connection, user, workflow_key, record_id, request)


@router.post("/{workflow_key}/records", response_model=WorkflowRecord, status_code=201)
def workflow_record_create(
    workflow_key: str,
    request: RecordCreateRequest,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> WorkflowRecord:
    return create_record(connection, user, workflow_key, request)


@router.delete("/{workflow_key}/records/{record_id}", status_code=204)
def workflow_record_delete(
    workflow_key: str,
    record_id: UUID,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> None:
    delete_record(connection, user, workflow_key, record_id)


@router.get("/{workflow_key}/tree", response_model=WorkflowTree)
def workflow_tree(
    workflow_key: str,
    locale: str = Query(default="zh-CN"),
    selected_record_id: UUID | None = Query(default=None),
    selected_cell_key: str | None = Query(default=None, max_length=100),
    selected_step_key: str | None = Query(default=None, max_length=140),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> WorkflowTree:
    return get_tree(
        connection,
        user,
        workflow_key,
        locale,
        selected_record_id,
        selected_cell_key,
        selected_step_key,
    )


@router.post(
    "/{workflow_key}/steps/{record_id}/messages",
    response_model=WorkflowStepMessagesResponse,
)
def workflow_step_message_append(
    workflow_key: str,
    record_id: UUID,
    request: WorkflowStepMessageRequest,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> WorkflowStepMessagesResponse:
    return append_workflow_step_message(connection, user, workflow_key, record_id, request)


@router.post(
    "/{workflow_key}/instances",
    response_model=WorkflowInstance,
    status_code=201,
)
def workflow_instance_start(
    workflow_key: str,
    request: InstanceStartRequest,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> WorkflowInstance:
    return start_instance(connection, user, workflow_key, request)


@router.post(
    "/instances/{instance_id}/transitions",
    response_model=WorkflowInstance,
)
def workflow_instance_transition(
    instance_id: UUID,
    request: InstanceTransitionRequest,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> WorkflowInstance:
    return transition_instance(connection, user, instance_id, request)


@router.get(
    "/instances/{instance_id}/runtime",
    response_model=WorkflowRuntimeProjection,
)
def workflow_instance_runtime(
    instance_id: UUID,
    workflow_key: str | None = Query(default=None),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> WorkflowRuntimeProjection:
    return get_runtime_projection(connection, user, instance_id, workflow_key)


@router.post(
    "/instances/{instance_id}/commands",
    response_model=WorkflowRuntimeProjection,
)
def workflow_instance_command(
    instance_id: UUID,
    request: WorkflowCommandRequest,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> WorkflowRuntimeProjection:
    return command_instance(connection, user, instance_id, request)
