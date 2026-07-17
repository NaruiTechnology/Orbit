"""Workflow definition, grid record, tree, and runtime endpoints."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from psycopg import Connection

from app.auth import get_current_user
from app.database import get_connection
from app.schemas import (
    InstanceStartRequest,
    InstanceTransitionRequest,
    RecordCreateRequest,
    RecordPage,
    RecordUpdateRequest,
    SessionInfo,
    WorkflowDetail,
    WorkflowInstance,
    WorkflowRecord,
    WorkflowSummary,
    WorkflowTree,
)
from app.services.workflow_repository import (
    create_record,
    delete_record,
    get_tree,
    get_workflow,
    list_records,
    list_workflows,
    start_instance,
    transition_instance,
    update_record,
)

router = APIRouter(prefix="/workflows", tags=["workflows"])


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
    )


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
