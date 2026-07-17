"""Pydantic request and response contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ScopeInfo(BaseModel):
    organization_id: UUID
    organization_name: str
    department_id: UUID | None = None
    department_name: str | None = None
    laboratory_id: UUID | None = None
    laboratory_name: str | None = None


class SessionInfo(BaseModel):
    user_id: UUID
    login_name: str
    display_name: str
    preferred_locale: str
    roles: list[str]
    permissions: list[str]
    scope: ScopeInfo


class WorkflowAccess(BaseModel):
    can_view: bool
    can_edit: bool
    can_execute: bool


class WorkflowSummary(BaseModel):
    id: UUID
    key: str
    parent_key: str | None
    name: str
    name_i18n: dict[str, str]
    group_key: str
    group_name: str
    group_name_i18n: dict[str, str]
    definition_type: str
    is_master: bool
    display_order: int
    record_count: int
    access: WorkflowAccess


class ColumnDefinition(BaseModel):
    key: str
    source_label: str
    label: str
    label_i18n: dict[str, str]
    data_type: str
    editable: bool
    source_cell: str


class WorkflowDetail(WorkflowSummary):
    source_sheet: str
    source_sheet_index: int
    columns: list[ColumnDefinition]
    metadata: dict[str, Any]
    catalog_version: int


class WorkflowRecord(BaseModel):
    id: UUID
    tree_record_id: UUID | None = None
    record_key: str
    record_order: int
    label: str
    label_i18n: dict[str, str]
    values: dict[str, Any]
    source_row: int | None
    source_cells: dict[str, str]
    version: int
    updated_at: datetime


class RecordPage(BaseModel):
    items: list[WorkflowRecord]
    total: int
    offset: int
    limit: int
    sort_by: str
    sort_direction: Literal["asc", "desc"]


class RecordUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    values: dict[str, Any] = Field(min_length=1)
    version: int = Field(ge=1)
    locale: str = "zh-CN"


class RecordCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    values: dict[str, Any] = Field(default_factory=dict)
    record_key: str | None = Field(default=None, min_length=1, max_length=140)
    record_order: int | None = Field(default=None, ge=1)
    locale: str = "zh-CN"


class TreeNode(BaseModel):
    record_id: UUID
    record_key: str
    order: int
    label: str
    owner_role: str | None = None
    time_limit: str | None = None
    is_selected: bool
    is_before_selected: bool


class TreeEdge(BaseModel):
    source: str
    target: str
    kind: str
    label: str | None = None


class WorkflowTree(BaseModel):
    workflow_key: str
    workflow_name: str
    selected_record_id: UUID | None
    selected_cell_key: str | None
    selected_cell_value: Any = None
    nodes: list[TreeNode]
    edges: list[TreeEdge]


class InstanceStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    business_key: str = Field(min_length=1, max_length=160)
    context: dict[str, Any] = Field(default_factory=dict)
    department_id: UUID | None = None
    laboratory_id: UUID | None = None


class InstanceTransitionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: str = Field(default="complete", min_length=1, max_length=40)
    target_record_key: str | None = Field(default=None, max_length=140)
    payload: dict[str, Any] = Field(default_factory=dict)
    version: int = Field(ge=1)


class WorkflowInstance(BaseModel):
    id: UUID
    workflow_key: str
    business_key: str
    current_record_key: str | None
    status: str
    context: dict[str, Any]
    version: int
    started_at: datetime
    completed_at: datetime | None
    updated_at: datetime


class HealthResponse(BaseModel):
    status: Literal["ok"]
    application: str
    database: str
    server_encoding: str
    client_encoding: str
    timezone: str
    workflow_count: int
    record_count: int
