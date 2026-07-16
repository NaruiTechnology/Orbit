"""Workflow query, grid editing, tree, and runtime transition operations."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from psycopg import Connection, sql
from psycopg.types.json import Jsonb

from app.auth import require_workflow_access
from app.schemas import (
    ColumnDefinition,
    InstanceStartRequest,
    InstanceTransitionRequest,
    RecordPage,
    RecordUpdateRequest,
    SessionInfo,
    TreeEdge,
    TreeNode,
    WorkflowAccess,
    WorkflowDetail,
    WorkflowInstance,
    WorkflowRecord,
    WorkflowSummary,
    WorkflowTree,
)
from app.services.localization import collation_for, localized_value


def _access_model(row: dict[str, Any]) -> WorkflowAccess:
    return WorkflowAccess(
        can_view=bool(row["can_view"]),
        can_edit=bool(row["can_edit"]),
        can_execute=bool(row["can_execute"]),
    )


def list_workflows(
    connection: Connection[dict[str, Any]], user: SessionInfo, locale: str
) -> list[WorkflowSummary]:
    rows = connection.execute(
        """
        SELECT w.id,
               w.workflow_key,
               parent.workflow_key AS parent_key,
               w.name_i18n,
               w.group_key,
               w.group_name_i18n,
               w.definition_type,
               w.is_master,
               w.display_order,
               count(DISTINCT record.id) AS record_count,
               bool_or(access.can_view) AS can_view,
               bool_or(access.can_edit) AS can_edit,
               bool_or(access.can_execute) AS can_execute
          FROM orbit_workflow.workflow_definition w
          LEFT JOIN orbit_workflow.workflow_definition parent ON parent.id = w.parent_id
          LEFT JOIN orbit_workflow.workflow_record record ON record.workflow_id = w.id
          JOIN orbit_identity.user_role ur ON ur.user_id = %s
          JOIN orbit_identity.role_workflow_access access ON access.role_id = ur.role_id
         WHERE w.is_active
           AND (
               (access.scope_type = 'global' AND access.scope_key = '*')
               OR (access.scope_type = 'group' AND access.scope_key = w.group_key)
               OR (access.scope_type = 'workflow' AND access.scope_key = w.workflow_key)
           )
           AND access.can_view
         GROUP BY w.id, parent.workflow_key
         ORDER BY w.display_order
        """,
        (user.user_id,),
    ).fetchall()
    return [
        WorkflowSummary(
            id=row["id"],
            key=row["workflow_key"],
            parent_key=row["parent_key"],
            name=localized_value(row["name_i18n"], locale),
            name_i18n=row["name_i18n"],
            group_key=row["group_key"],
            group_name=localized_value(row["group_name_i18n"], locale),
            group_name_i18n=row["group_name_i18n"],
            definition_type=row["definition_type"],
            is_master=row["is_master"],
            display_order=row["display_order"],
            record_count=row["record_count"],
            access=_access_model(row),
        )
        for row in rows
    ]


def get_workflow(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    locale: str,
) -> WorkflowDetail:
    access = require_workflow_access(connection, user.user_id, workflow_key, "view")
    row = connection.execute(
        """
        SELECT w.*,
               parent.workflow_key AS parent_key,
               (
                   SELECT count(*)
                     FROM orbit_workflow.workflow_record r
                    WHERE r.workflow_id = w.id
               ) AS record_count
          FROM orbit_workflow.workflow_definition w
          LEFT JOIN orbit_workflow.workflow_definition parent ON parent.id = w.parent_id
         WHERE w.workflow_key = %s AND w.is_active
        """,
        (workflow_key,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    columns = [
        ColumnDefinition(
            **column,
            label=localized_value(column["label_i18n"], locale),
        )
        for column in row["schema_json"]
    ]
    return WorkflowDetail(
        id=row["id"],
        key=row["workflow_key"],
        parent_key=row["parent_key"],
        name=localized_value(row["name_i18n"], locale),
        name_i18n=row["name_i18n"],
        group_key=row["group_key"],
        group_name=localized_value(row["group_name_i18n"], locale),
        group_name_i18n=row["group_name_i18n"],
        definition_type=row["definition_type"],
        is_master=row["is_master"],
        display_order=row["display_order"],
        record_count=row["record_count"],
        access=WorkflowAccess(**access),
        source_sheet=row["source_sheet"],
        source_sheet_index=row["source_sheet_index"],
        columns=columns,
        metadata=row["metadata"],
        catalog_version=row["catalog_version"],
    )


def _scope_clause(user: SessionInfo) -> tuple[str, tuple[Any, ...]]:
    return (
        """
        AND (r.organization_id IS NULL OR r.organization_id = %s)
        AND (r.department_id IS NULL OR r.department_id = %s)
        AND (r.laboratory_id IS NULL OR r.laboratory_id = %s)
        """,
        (
            user.scope.organization_id,
            user.scope.department_id,
            user.scope.laboratory_id,
        ),
    )


def _record_model(row: dict[str, Any], locale: str) -> WorkflowRecord:
    return WorkflowRecord(
        id=row["id"],
        record_key=row["record_key"],
        record_order=row["record_order"],
        label=localized_value(row["label_i18n"], locale),
        label_i18n=row["label_i18n"],
        values=row["values_json"],
        source_row=row["source_row"],
        source_cells=row["source_cells"],
        version=row["version"],
        updated_at=row["updated_at"],
    )


def list_records(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    locale: str,
    offset: int,
    limit: int,
    sort_by: str,
    sort_direction: str,
    search: str | None,
) -> RecordPage:
    definition = get_workflow(connection, user, workflow_key, locale)
    columns = {column.key: column for column in definition.columns}
    if sort_by != "record_order" and sort_by not in columns:
        raise HTTPException(status_code=400, detail="Unknown sort column")
    direction = "DESC" if sort_direction.lower() == "desc" else "ASC"
    scope_text, scope_values = _scope_clause(user)
    search_text = ""
    parameters: list[Any] = [workflow_key, *scope_values]
    if search:
        search_text = " AND r.values_json::text ILIKE %s"
        parameters.append(f"%{search}%")

    if sort_by == "record_order":
        order_expression = sql.SQL("r.record_order")
    elif columns[sort_by].data_type in {"integer", "decimal"}:
        order_expression = sql.SQL(
            "CASE WHEN (r.values_json ->> {key}) ~ "
            "'^[+-]?[0-9]+([.][0-9]+)?$' "
            "THEN (r.values_json ->> {key})::numeric END"
        ).format(key=sql.Literal(sort_by))
    else:
        order_expression = sql.SQL(
            "COALESCE(r.values_json ->> {key}, '') COLLATE {collation}"
        ).format(
            key=sql.Literal(sort_by),
            collation=sql.Identifier("orbit_workflow", collation_for(locale)),
        )

    where_sql = sql.SQL(
        """
        FROM orbit_workflow.workflow_record r
        JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
        WHERE w.workflow_key = %s
        {scope}
        {search}
        """
    ).format(scope=sql.SQL(scope_text), search=sql.SQL(search_text))
    total = connection.execute(
        sql.SQL("SELECT count(*) AS total ") + where_sql,
        parameters,
    ).fetchone()["total"]
    query = (
        sql.SQL(
            """
            SELECT r.id, r.record_key, r.record_order, r.label_i18n,
                   r.values_json, r.source_row, r.source_cells,
                   r.version, r.updated_at
            """
        )
        + where_sql
        + sql.SQL(" ORDER BY {} {} NULLS LAST, r.record_order ASC LIMIT %s OFFSET %s").format(
            order_expression, sql.SQL(direction)
        )
    )
    rows = connection.execute(query, (*parameters, limit, offset)).fetchall()
    return RecordPage(
        items=[_record_model(row, locale) for row in rows],
        total=total,
        offset=offset,
        limit=limit,
        sort_by=sort_by,
        sort_direction=direction.lower(),
    )


def update_record(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    record_id: UUID,
    request: RecordUpdateRequest,
) -> WorkflowRecord:
    require_workflow_access(connection, user.user_id, workflow_key, "edit")
    definition = get_workflow(connection, user, workflow_key, request.locale)
    editable_keys = {column.key for column in definition.columns if column.editable}
    rejected = sorted(set(request.values) - editable_keys)
    if rejected:
        raise HTTPException(
            status_code=400,
            detail={"message": "One or more fields are not editable", "fields": rejected},
        )
    scope_text, scope_values = _scope_clause(user)
    before = connection.execute(
        f"""
        SELECT r.*
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
         WHERE r.id = %s AND w.workflow_key = %s
         {scope_text}
        """,
        (record_id, workflow_key, *scope_values),
    ).fetchone()
    if before is None:
        raise HTTPException(status_code=404, detail="Workflow record not found")
    updated = connection.execute(
        """
        UPDATE orbit_workflow.workflow_record
           SET values_json = values_json || %s
         WHERE id = %s AND version = %s
        RETURNING *
        """,
        (Jsonb(request.values), record_id, request.version),
    ).fetchone()
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Record was changed by another user; refresh before saving",
        )
    connection.execute(
        """
        INSERT INTO orbit_audit.audit_event (
            actor_user_id, action, entity_type, entity_id,
            organization_id, before_json, after_json, metadata
        )
        VALUES (%s, 'record.update', 'workflow_record', %s, %s, %s, %s, %s)
        """,
        (
            user.user_id,
            str(record_id),
            user.scope.organization_id,
            Jsonb(before["values_json"]),
            Jsonb(updated["values_json"]),
            Jsonb({"workflow_key": workflow_key, "changed_fields": sorted(request.values)}),
        ),
    )
    return _record_model(updated, request.locale)


def get_tree(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    locale: str,
    selected_record_id: UUID | None,
    selected_cell_key: str | None,
) -> WorkflowTree:
    definition = get_workflow(connection, user, workflow_key, locale)
    rows = connection.execute(
        """
        SELECT r.id, r.record_key, r.record_order, r.label_i18n, r.values_json
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
         WHERE w.workflow_key = %s
         ORDER BY r.record_order
        """,
        (workflow_key,),
    ).fetchall()
    selected_order = next(
        (row["record_order"] for row in rows if row["id"] == selected_record_id), None
    )
    selected_row = next((row for row in rows if row["id"] == selected_record_id), None)
    nodes = [
        TreeNode(
            record_id=row["id"],
            record_key=row["record_key"],
            order=row["record_order"],
            label=localized_value(row["label_i18n"], locale),
            owner_role=row["values_json"].get("owner_role"),
            time_limit=row["values_json"].get("time_limit"),
            is_selected=row["id"] == selected_record_id,
            is_before_selected=(
                selected_order is not None and row["record_order"] < selected_order
            ),
        )
        for row in rows
    ]
    definition_row = connection.execute(
        "SELECT edges_json FROM orbit_workflow.workflow_definition WHERE workflow_key = %s",
        (workflow_key,),
    ).fetchone()
    return WorkflowTree(
        workflow_key=workflow_key,
        workflow_name=definition.name,
        selected_record_id=selected_record_id,
        selected_cell_key=selected_cell_key,
        selected_cell_value=(
            selected_row["values_json"].get(selected_cell_key)
            if selected_row and selected_cell_key
            else None
        ),
        nodes=nodes,
        edges=[TreeEdge(**edge) for edge in definition_row["edges_json"]],
    )


def _instance_model(row: dict[str, Any]) -> WorkflowInstance:
    return WorkflowInstance(
        id=row["id"],
        workflow_key=row["workflow_key"],
        business_key=row["business_key"],
        current_record_key=row["current_record_key"],
        status=row["status"],
        context=row["context_json"],
        version=row["version"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        updated_at=row["updated_at"],
    )


def start_instance(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    request: InstanceStartRequest,
) -> WorkflowInstance:
    require_workflow_access(connection, user.user_id, workflow_key, "execute")
    workflow = connection.execute(
        """
        SELECT w.id,
               (SELECT record_key FROM orbit_workflow.workflow_record r
                 WHERE r.workflow_id = w.id ORDER BY record_order LIMIT 1) AS first_record_key
          FROM orbit_workflow.workflow_definition w
         WHERE w.workflow_key = %s AND w.is_active
        """,
        (workflow_key,),
    ).fetchone()
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    try:
        row = connection.execute(
            """
            INSERT INTO orbit_runtime.workflow_instance (
                workflow_id, business_key, current_record_key, status, context_json,
                organization_id, department_id, laboratory_id, started_by
            )
            VALUES (%s, %s, %s, 'active', %s, %s, %s, %s, %s)
            RETURNING *, %s::varchar AS workflow_key
            """,
            (
                workflow["id"],
                request.business_key,
                workflow["first_record_key"],
                Jsonb(request.context),
                user.scope.organization_id,
                request.department_id or user.scope.department_id,
                request.laboratory_id or user.scope.laboratory_id,
                user.user_id,
                workflow_key,
            ),
        ).fetchone()
    except Exception as error:
        if getattr(error, "sqlstate", None) == "23505":
            raise HTTPException(status_code=409, detail="Business key already exists") from error
        raise
    connection.execute(
        """
        INSERT INTO orbit_runtime.transition_event (
            instance_id, from_record_key, to_record_key, outcome, payload, actor_user_id
        ) VALUES (%s, NULL, %s, 'start', %s, %s)
        """,
        (row["id"], row["current_record_key"], Jsonb(request.context), user.user_id),
    )
    return _instance_model(row)


def transition_instance(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    instance_id: UUID,
    request: InstanceTransitionRequest,
) -> WorkflowInstance:
    current = connection.execute(
        """
        SELECT i.*, w.workflow_key, w.edges_json
          FROM orbit_runtime.workflow_instance i
          JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
         WHERE i.id = %s
           AND i.organization_id = %s
           AND (i.department_id IS NULL OR i.department_id = %s)
           AND (i.laboratory_id IS NULL OR i.laboratory_id = %s)
        """,
        (
            instance_id,
            user.scope.organization_id,
            user.scope.department_id,
            user.scope.laboratory_id,
        ),
    ).fetchone()
    if current is None:
        raise HTTPException(status_code=404, detail="Workflow instance not found")
    require_workflow_access(connection, user.user_id, current["workflow_key"], "execute")
    if current["status"] not in {"active", "waiting"}:
        raise HTTPException(status_code=409, detail="Workflow instance is not active")

    candidates = [
        edge["target"]
        for edge in current["edges_json"]
        if edge["source"] == current["current_record_key"]
    ]
    target = request.target_record_key or (candidates[0] if candidates else None)
    if request.target_record_key and request.target_record_key not in candidates:
        raise HTTPException(status_code=400, detail="Target is not a valid workflow edge")
    next_status = "active" if target else "completed"
    updated = connection.execute(
        """
        UPDATE orbit_runtime.workflow_instance
           SET current_record_key = %s,
               status = %s,
               context_json = context_json || %s,
               completed_at = CASE WHEN %s = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE id = %s AND version = %s
        RETURNING *, %s::varchar AS workflow_key
        """,
        (
            target,
            next_status,
            Jsonb(request.payload),
            next_status,
            instance_id,
            request.version,
            current["workflow_key"],
        ),
    ).fetchone()
    if updated is None:
        raise HTTPException(status_code=409, detail="Instance version is stale")
    connection.execute(
        """
        INSERT INTO orbit_runtime.transition_event (
            instance_id, from_record_key, to_record_key, outcome, payload, actor_user_id
        ) VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            instance_id,
            current["current_record_key"],
            target,
            request.outcome,
            Jsonb(request.payload),
            user.user_id,
        ),
    )
    return _instance_model(updated)
