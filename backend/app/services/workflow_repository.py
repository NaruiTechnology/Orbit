"""Workflow query, grid editing, tree, and runtime transition operations."""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from psycopg import Connection, sql
from psycopg.types.json import Jsonb

from app.auth import require_workflow_access
from app.schemas import (
    ColumnDefinition,
    InstanceStartRequest,
    InstanceTransitionRequest,
    RecordCreateRequest,
    RecordPage,
    RecordUpdateRequest,
    SessionInfo,
    TreeEdge,
    TreeNode,
    WorkflowAccess,
    WorkflowCommandRequest,
    WorkflowDetail,
    WorkflowDecisionCatalog,
    WorkflowDecisionStep,
    WorkflowInstance,
    WorkflowNodeRuntime,
    WorkflowRecord,
    WorkflowRuntimeProjection,
    WorkflowStepMessageRequest,
    WorkflowStepMessagesResponse,
    WorkflowSummary,
    WorkflowTree,
)
from app.services.localization import collation_for, locale_key, localized_value
from app.services.workflow_runtime_service import WorkflowRuntimeService


def _access_model(row: dict[str, Any]) -> WorkflowAccess:
    return WorkflowAccess(
        can_view=bool(row["can_view"]),
        can_edit=bool(row["can_edit"]),
        can_execute=bool(row["can_execute"]),
    )


def _runtime_columns(locale: str = "en") -> list[ColumnDefinition]:
    labels = {
        "business_key": ("Business Key", "业务键", "業務鍵"),
        "current_record_key": ("Current Step", "当前步骤", "目前步驟"),
        "status": ("Status", "状态", "狀態"),
        "context": ("Business Context", "业务上下文", "業務內容"),
        "version": ("Version", "版本", "版本"),
        "started_at": ("Started At", "开始时间", "開始時間"),
        "completed_at": ("Completed At", "完成时间", "完成時間"),
        "updated_at": ("Updated At", "更新时间", "更新時間"),
    }
    return [
        ColumnDefinition(
            key=key,
            source_label=label[0],
            label=label[0] if locale == "en" else label[1 if locale == "zh-CN" else 2],
            label_i18n={"en": label[0], "zh_CN": label[1], "zh_HK": label[2]},
            data_type="text",
            editable=key in {"business_key", "status", "context"},
            source_cell="database",
        )
        for key, label in labels.items()
    ]


def _customer_order_columns(locale: str = "en") -> list[ColumnDefinition]:
    definitions = [
        ("order_number", "Order Number", "订单号", "訂單號", "text"),
        ("customer_code", "Customer Code", "客户编号", "客戶編號", "text"),
        ("customer_name", "Customer Name", "客户名称", "客戶名稱", "text"),
        ("customer_contact", "Customer Contact", "客户联系人", "客戶聯絡人", "text"),
        ("chip_name", "Chip Name", "芯片名称", "晶片名稱", "text"),
        ("chip_model", "Chip Model", "芯片型号", "晶片型號", "text"),
        ("package_type", "Package Type", "封装类型", "封裝類型", "text"),
        ("quantity", "Quantity", "数量", "數量", "integer"),
        ("source_laboratory", "Source Laboratory", "来源实验室", "來源實驗室", "text"),
        ("target_laboratory", "Target Laboratory", "目标实验室", "目標實驗室", "text"),
        ("requested_due_date", "Requested Due Date", "期望完成日期", "期望完成日期", "date"),
        ("priority", "Priority", "优先级", "優先級", "text"),
        ("status", "Status", "订单状态", "訂單狀態", "text"),
        ("evaluation_result", "Evaluation Result", "评估结果", "評估結果", "text"),
        ("notes", "Notes", "备注", "備註", "text"),
    ]
    return [
        ColumnDefinition(
            key=key,
            source_label=label,
            label=label if locale == "en" else (zh_cn if locale == "zh-CN" else zh_hk),
            label_i18n={"en": label, "zh_CN": zh_cn, "zh_HK": zh_hk},
            data_type=data_type,
            editable=True,
            source_cell=f"orbit_sales.customer_order.{key}",
        )
        for key, label, zh_cn, zh_hk, data_type in definitions
    ]


def _is_runtime_workflow(definition: WorkflowDetail) -> bool:
    return definition.definition_type == "workflow"


def _is_customer_relations_workflow(definition: WorkflowDetail) -> bool:
    """Process tabs in the Customer Relations workspace share order rows.

    The UI's Customer Relations lane contains every non-HR process workflow,
    including technical/order execution stages, so those stages must use the
    same customer-order source as Order Evaluation.
    """
    return definition.group_key != "hr" and definition.definition_type == "workflow"


# The origin catalog does not encode links between subworkflow sheets. These
# links are derived from the master workflow's stage descriptions and the
# first/last step text in each source sheet. Branch workflows are deliberately
# omitted from the mandatory chain.
_SUBWORKFLOW_PREREQUISITES: dict[str, tuple[str, ...]] = {
    "technical-intake": ("order-evaluation",),
    "technical-processing": ("technical-intake",),
    "billing-and-collection": ("technical-processing", "cross-laboratory-orders"),
    "customer-pool-reclaim": ("billing-and-collection",),
}


_STEP_ROLE_EN = {
    "销售": "Sales",
    "技术部": "Technical Team",
    "技术部/销售": "Technical Team / Sales",
    "系统自动": "System",
    "系统自动/销售": "System / Sales",
    "财务/销售": "Finance / Sales",
    "销售/财务": "Sales / Finance",
    "技术主管及以上": "Technical Manager or above",
    "技术部（目标实验室）": "Technical Team (Target Laboratory)",
}


def _localized_step_value(value: Any, locale: str) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, dict):
        return localized_value(value, locale)
    text = str(value)
    if locale_key(locale) != "en":
        return text
    if text in _STEP_ROLE_EN:
        return _STEP_ROLE_EN[text]
    day_match = re.fullmatch(r"(\d+(?:\.\d+)?)个工作日内", text)
    if day_match:
        days = day_match.group(1)
        return f"Within {days} business day" + ("s" if days != "1" else "")
    minute_match = re.fullmatch(r"(\d+)分钟内", text)
    if minute_match:
        return f"Within {minute_match.group(1)} minutes"
    return {
        "即时": "Immediately",
        "评估完成后即时": "Immediately after evaluation",
        "评估复杂度决定": "Determined by evaluation complexity",
    }.get(text, text)


def _step_contact_value(values: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = values.get(key)
        if value not in (None, ""):
            return str(value).strip() or None
    return None


def _step_messages(values: dict[str, Any]) -> list[str]:
    raw = values.get("Messages", values.get("messages", []))
    if not isinstance(raw, list):
        return []
    return [str(message).strip() for message in raw if str(message).strip()]


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
               CASE
                   WHEN w.group_key <> 'hr' AND w.definition_type = 'workflow'
                   THEN (SELECT count(*) FROM orbit_sales.customer_order)
                   WHEN w.definition_type = 'workflow'
                   THEN count(DISTINCT instance.id)
                   ELSE count(DISTINCT record.id)
               END AS record_count,
               bool_or(access.can_view) AS can_view,
               bool_or(access.can_edit) AS can_edit,
               bool_or(access.can_execute) AS can_execute
          FROM orbit_workflow.workflow_definition w
          LEFT JOIN orbit_workflow.workflow_definition parent ON parent.id = w.parent_id
          LEFT JOIN orbit_workflow.workflow_business_record record ON record.workflow_id = w.id
          LEFT JOIN orbit_runtime.workflow_instance instance ON instance.workflow_id = w.id
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


def list_decision_options(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    locale: str,
) -> list[WorkflowDecisionCatalog]:
    """Return accessible sibling workflow catalogs and their steps."""
    require_workflow_access(connection, user.user_id, workflow_key, "view")
    current = connection.execute(
        """
        SELECT group_key
          FROM orbit_workflow.workflow_definition
         WHERE workflow_key = %s AND is_active
        """,
        (workflow_key,),
    ).fetchone()
    if current is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    rows = connection.execute(
        """
        SELECT w.workflow_key, w.name_i18n, w.display_order,
               r.record_key, r.label_i18n, r.record_order
          FROM orbit_workflow.workflow_definition w
          JOIN orbit_workflow.workflow_record r ON r.workflow_id = w.id
         WHERE w.is_active
           AND w.definition_type = 'workflow'
           AND NOT w.is_master
           AND (
               (%s = 'hr' AND w.group_key = 'hr')
               OR (%s <> 'hr' AND w.group_key <> 'hr')
           )
           AND w.workflow_key <> %s
           AND EXISTS (
               SELECT 1
                 FROM orbit_identity.user_role ur
                 JOIN orbit_identity.role_workflow_access access
                   ON access.role_id = ur.role_id
                WHERE ur.user_id = %s
                  AND access.can_view
                  AND (
                      (access.scope_type = 'global' AND access.scope_key = '*')
                      OR (access.scope_type = 'group' AND access.scope_key = w.group_key)
                      OR (access.scope_type = 'workflow' AND access.scope_key = w.workflow_key)
                  )
           )
         ORDER BY w.display_order, r.record_order
        """,
        (current["group_key"], current["group_key"], workflow_key, user.user_id),
    ).fetchall()
    catalogs: dict[str, WorkflowDecisionCatalog] = {}
    for row in rows:
        catalog = catalogs.setdefault(
            row["workflow_key"],
            WorkflowDecisionCatalog(
                key=row["workflow_key"],
                name=localized_value(row["name_i18n"], locale),
                steps=[],
            ),
        )
        catalog.steps.append(
            WorkflowDecisionStep(
                record_key=row["record_key"],
                label=localized_value(row["label_i18n"], locale),
            )
        )
    return list(catalogs.values())


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
               CASE
                   WHEN w.group_key <> 'hr' AND w.definition_type = 'workflow' THEN (
                       SELECT count(*) FROM orbit_sales.customer_order
                   )
                   WHEN w.definition_type = 'workflow' THEN (
                       SELECT count(*)
                         FROM orbit_runtime.workflow_instance i
                        WHERE i.workflow_id = w.id
                   )
                   ELSE (
                       SELECT count(*)
                         FROM orbit_workflow.workflow_business_record r
                        WHERE r.workflow_id = w.id
                   )
               END AS record_count
          FROM orbit_workflow.workflow_definition w
          LEFT JOIN orbit_workflow.workflow_definition parent ON parent.id = w.parent_id
         WHERE w.workflow_key = %s AND w.is_active
        """,
        (workflow_key,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    columns = (
        _customer_order_columns(locale)
        if _is_customer_relations_workflow(
            WorkflowDetail.model_construct(
                group_key=row["group_key"], definition_type=row["definition_type"]
            )
        )
        else _runtime_columns(locale)
        if row["definition_type"] == "workflow"
        else [
            ColumnDefinition(
                **column,
                label=localized_value(column["label_i18n"], locale),
            )
            for column in row["schema_json"]
        ]
    )
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
        tree_record_id=row.get("tree_record_id", row.get("workflow_record_id")),
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


def _runtime_record(
    connection: Connection[dict[str, Any]], instance_id: UUID, locale: str
) -> WorkflowRecord:
    row = connection.execute(
        """
        SELECT i.*, n.id AS tree_record_id
          FROM orbit_runtime.workflow_instance i
          LEFT JOIN orbit_workflow.workflow_record n
            ON n.workflow_id = i.workflow_id AND n.record_key = i.current_record_key
         WHERE i.id = %s
        """,
        (instance_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow instance not found")
    values = {
        "business_key": row["business_key"],
        "current_record_key": row["current_record_key"],
        "status": row["status"],
        "context": row["context_json"],
        "version": row["version"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "updated_at": row["updated_at"],
    }
    label_i18n = {
        "en": row["business_key"],
        "zh_CN": row["business_key"],
        "zh_HK": row["business_key"],
    }
    return WorkflowRecord(
        id=row["id"],
        tree_record_id=row["tree_record_id"],
        record_key=row["business_key"],
        record_order=0,
        label=localized_value(label_i18n, locale),
        label_i18n=label_i18n,
        values=values,
        source_row=None,
        source_cells={},
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
    owner_only: bool = False,
) -> RecordPage:
    definition = get_workflow(connection, user, workflow_key, locale)
    if _is_customer_relations_workflow(definition):
        return _list_customer_orders(
            connection, user, workflow_key, locale, offset, limit, sort_by, sort_direction, search,
            owner_only,
        )
    if _is_runtime_workflow(definition):
        return _list_runtime_instances(
            connection, user, workflow_key, locale, offset, limit, sort_by, sort_direction, search
        )
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
        FROM orbit_workflow.workflow_business_record r
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
            SELECT r.id, r.workflow_record_id AS tree_record_id,
                   r.record_key, r.record_order, r.label_i18n,
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


def _list_customer_orders(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    locale: str,
    offset: int,
    limit: int,
    sort_by: str,
    sort_direction: str,
    search: str | None,
    owner_only: bool = False,
) -> RecordPage:
    allowed = {
        column.key for column in _customer_order_columns()
    } | {"record_order"}
    if sort_by not in allowed:
        raise HTTPException(status_code=400, detail="Unknown sort column")
    direction = "DESC" if sort_direction.lower() == "desc" else "ASC"
    where = [
        "organization_id = %s",
        "(department_id IS NULL OR department_id = %s)",
        "(laboratory_id IS NULL OR laboratory_id = %s)",
    ]
    parameters: list[Any] = [
        user.scope.organization_id,
        user.scope.department_id,
        user.scope.laboratory_id,
    ]
    if owner_only:
        where.append(
            """
            EXISTS (
                SELECT 1
                  FROM orbit_runtime.workflow_instance current_instance
                  JOIN orbit_workflow.workflow_definition current_workflow
                    ON current_workflow.id = current_instance.workflow_id
                   AND current_workflow.workflow_key = 'order-evaluation'
                  JOIN orbit_workflow.workflow_record current_step
                    ON current_step.workflow_id = current_instance.workflow_id
                   AND current_step.record_key = current_instance.current_record_key
                  JOIN orbit_workflow.workflow_step_assignment step_assignment
                    ON step_assignment.workflow_record_id = current_step.id
                  JOIN orbit_identity.app_user owner_user
                    ON owner_user.id = %s
                 WHERE (
                       current_instance.context_json ->> 'order_id' = customer_order.id::text
                       OR current_instance.business_key = customer_order.order_number
                   )
                   AND (
                       step_assignment.contact_name = owner_user.login_name
                       OR step_assignment.contact_name = owner_user.display_name_i18n ->> 'en'
                       OR step_assignment.contact_name = owner_user.display_name_i18n ->> 'zh_CN'
                       OR step_assignment.contact_name = owner_user.display_name_i18n ->> 'zh_HK'
                       OR step_assignment.contact_name = concat_ws(' ', owner_user.first_name, owner_user.last_name)
                   )
            )
            """
        )
        parameters.append(user.user_id)
    if search:
        where.append(
            "(order_number ILIKE %s OR customer_name ILIKE %s OR chip_name ILIKE %s)"
        )
        parameters.extend([f"%{search}%"] * 3)
    where_sql = sql.SQL(" AND ").join(sql.SQL(item) for item in where)
    total = connection.execute(
        sql.SQL("SELECT count(*) AS total FROM orbit_sales.customer_order WHERE ") + where_sql,
        parameters,
    ).fetchone()["total"]
    order_column = "created_at" if sort_by == "record_order" else sort_by
    query = sql.SQL(
        """
        SELECT id, order_number AS record_key,
               row_number() OVER (ORDER BY created_at, id)::integer AS record_order,
               jsonb_build_object('en', order_number, 'zh_CN', order_number,
                                   'zh_HK', order_number) AS label_i18n,
               jsonb_build_object(
                   'order_number', order_number, 'customer_code', customer_code,
                   'customer_name', customer_name, 'customer_contact', customer_contact,
                   'chip_name', chip_name, 'chip_model', chip_model,
                   'package_type', package_type, 'quantity', quantity,
                   'source_laboratory', source_laboratory,
                   'target_laboratory', target_laboratory,
                   'requested_due_date', requested_due_date,
                   'priority', priority, 'status', status,
                   'evaluation_result', evaluation_result, 'notes', notes
               ) AS values_json,
               NULL::integer AS source_row, '{}'::jsonb AS source_cells,
               id AS tree_record_id,
               version, updated_at
          FROM orbit_sales.customer_order
         WHERE
        """
    ) + where_sql + sql.SQL(" ORDER BY {} {} NULLS LAST LIMIT %s OFFSET %s").format(
        sql.Identifier(order_column), sql.SQL(direction)
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
def _list_runtime_instances(
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
    allowed_sort = {
        "record_order": "i.started_at",
        "business_key": "i.business_key",
        "current_record_key": "i.current_record_key",
        "status": "i.status",
        "updated_at": "i.updated_at",
    }
    if sort_by not in allowed_sort:
        raise HTTPException(status_code=400, detail="Unknown sort column")
    direction = "DESC" if sort_direction.lower() == "desc" else "ASC"
    where = [
        "w.workflow_key = %s",
        "i.organization_id = %s",
        "(i.department_id IS NULL OR i.department_id = %s)",
        "(i.laboratory_id IS NULL OR i.laboratory_id = %s)",
    ]
    parameters: list[Any] = [
        workflow_key,
        user.scope.organization_id,
        user.scope.department_id,
        user.scope.laboratory_id,
    ]
    if search:
        where.append("(i.business_key ILIKE %s OR i.context_json::text ILIKE %s)")
        parameters.extend([f"%{search}%", f"%{search}%"])
    where_sql = sql.SQL(" AND ").join(sql.SQL(item) for item in where)
    total = connection.execute(
        sql.SQL(
            """
            SELECT count(*) AS total
              FROM orbit_runtime.workflow_instance i
              JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
             WHERE
            """
        )
        + where_sql,
        parameters,
    ).fetchone()["total"]
    query = sql.SQL(
        """
        SELECT i.id,
               row_number() OVER (ORDER BY i.started_at, i.id)::integer AS record_order,
               jsonb_build_object('en', i.business_key, 'zh_CN', i.business_key,
                                   'zh_HK', i.business_key) AS label_i18n,
               jsonb_build_object(
                   'business_key', i.business_key,
                   'current_record_key', i.current_record_key,
                   'status', i.status,
                   'context', i.context_json,
                   'version', i.version,
                   'started_at', i.started_at,
                   'completed_at', i.completed_at,
                   'updated_at', i.updated_at
               ) AS values_json,
               NULL::integer AS source_row,
               '{}'::jsonb AS source_cells,
               i.id AS tree_record_id,
               i.version,
               i.updated_at,
               i.business_key AS record_key
          FROM orbit_runtime.workflow_instance i
          JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
          LEFT JOIN orbit_workflow.workflow_record n
            ON n.workflow_id = i.workflow_id AND n.record_key = i.current_record_key
         WHERE
        """
    ) + where_sql + sql.SQL(" ORDER BY {} {} NULLS LAST LIMIT %s OFFSET %s").format(
        sql.SQL(allowed_sort[sort_by]), sql.SQL(direction)
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


def _update_runtime_instance(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    record_id: UUID,
    request: RecordUpdateRequest,
) -> WorkflowRecord:
    definition = get_workflow(connection, user, workflow_key, request.locale)
    values = _editable_values(definition, request.values)
    before = connection.execute(
        """
        SELECT i.*
          FROM orbit_runtime.workflow_instance i
          JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
         WHERE i.id = %s AND w.workflow_key = %s
           AND i.organization_id = %s
           AND (i.department_id IS NULL OR i.department_id = %s)
           AND (i.laboratory_id IS NULL OR i.laboratory_id = %s)
        """,
        (
            record_id,
            workflow_key,
            user.scope.organization_id,
            user.scope.department_id,
            user.scope.laboratory_id,
        ),
    ).fetchone()
    if before is None:
        raise HTTPException(status_code=404, detail="Workflow instance not found")
    updated = WorkflowRuntimeService(connection).update_record(
        instance_id=record_id,
        expected_version=request.version,
        business_key=str(values["business_key"]) if "business_key" in values else None,
        status=str(values["status"]) if "status" in values else None,
        context=values["context"] if isinstance(values.get("context"), dict) else None,
        workflow_key=workflow_key,
    )
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Record was changed by another user; refresh before saving",
        )
    return _runtime_record(connection, updated["id"], request.locale)


def _customer_order_record(
    connection: Connection[dict[str, Any]], order_id: UUID, locale: str
) -> WorkflowRecord:
    row = connection.execute(
        """
        SELECT id, order_number AS record_key,
               0 AS record_order,
               jsonb_build_object('en', order_number, 'zh_CN', order_number,
                                   'zh_HK', order_number) AS label_i18n,
               jsonb_build_object(
                   'order_number', order_number, 'customer_code', customer_code,
                   'customer_name', customer_name, 'customer_contact', customer_contact,
                   'chip_name', chip_name, 'chip_model', chip_model,
                   'package_type', package_type, 'quantity', quantity,
                   'source_laboratory', source_laboratory,
                   'target_laboratory', target_laboratory,
                   'requested_due_date', requested_due_date,
                   'priority', priority, 'status', status,
                   'evaluation_result', evaluation_result, 'notes', notes
               ) AS values_json,
               NULL::integer AS source_row, '{}'::jsonb AS source_cells,
               id AS tree_record_id,
               version, updated_at
          FROM orbit_sales.customer_order
         WHERE id = %s
        """,
        (order_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Customer order not found")
    return _record_model(row, locale)


def _normalise_order_values(values: dict[str, Any]) -> dict[str, Any]:
    values = dict(values)
    if "quantity" in values and values["quantity"] not in (None, ""):
        try:
            values["quantity"] = int(values["quantity"])
        except (TypeError, ValueError) as error:
            raise HTTPException(status_code=400, detail="Quantity must be an integer") from error
    return values


def _update_customer_order(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    order_id: UUID,
    request: RecordUpdateRequest,
) -> WorkflowRecord:
    values = _normalise_order_values(
        _editable_values(
            WorkflowDetail.model_construct(columns=_customer_order_columns()),
            request.values,
        )
    )
    assignments = [sql.SQL("{} = %s").format(sql.Identifier(key)) for key in values]
    if not assignments:
        raise HTTPException(status_code=400, detail="No order fields supplied")
    params: list[Any] = [values[key] for key in values]
    params.extend([order_id, request.version, user.scope.organization_id])
    updated = connection.execute(
        sql.SQL("UPDATE orbit_sales.customer_order SET ")
        + sql.SQL(", ").join(assignments)
        + sql.SQL(" WHERE id = %s AND version = %s AND organization_id = %s RETURNING id"),
        params,
    ).fetchone()
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Order was changed by another user; refresh before saving",
        )
    return _customer_order_record(connection, updated["id"], request.locale)


def update_record(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    record_id: UUID,
    request: RecordUpdateRequest,
) -> WorkflowRecord:
    require_workflow_access(connection, user.user_id, workflow_key, "edit")
    definition = get_workflow(connection, user, workflow_key, request.locale)
    if _is_customer_relations_workflow(definition):
        return _update_customer_order(connection, user, record_id, request)
    if _is_runtime_workflow(definition):
        return _update_runtime_instance(connection, user, workflow_key, record_id, request)
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
          FROM orbit_workflow.workflow_business_record r
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
        UPDATE orbit_workflow.workflow_business_record
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
        VALUES (%s, 'record.update', 'workflow_business_record', %s, %s, %s, %s, %s)
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


def _editable_values(
    definition: WorkflowDetail,
    values: dict[str, Any],
    *,
    allow_missing: bool = True,
) -> dict[str, Any]:
    columns = {column.key: column for column in definition.columns}
    unknown = sorted(set(values) - set(columns))
    if unknown:
        raise HTTPException(
            status_code=400, detail={"message": "Unknown fields", "fields": unknown}
        )
    rejected = sorted(key for key in values if not columns[key].editable)
    if rejected:
        raise HTTPException(
            status_code=400,
            detail={"message": "One or more fields are not editable", "fields": rejected},
        )
    editable_keys = {column.key for column in definition.columns if column.editable}
    if not allow_missing and set(values) != editable_keys:
        raise HTTPException(status_code=400, detail="All editable fields are required")
    return values


def create_record(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    request: RecordCreateRequest,
) -> WorkflowRecord:
    require_workflow_access(connection, user.user_id, workflow_key, "edit")
    definition = get_workflow(connection, user, workflow_key, request.locale)
    if _is_customer_relations_workflow(definition):
        values = _normalise_order_values(
            _editable_values(
                WorkflowDetail.model_construct(columns=_customer_order_columns()),
                request.values,
            )
        )
        order_number = str(values.get("order_number") or f"OE-{uuid4().hex[:12].upper()}")
        stored_values = {
            "order_number": order_number,
            "customer_code": values.get("customer_code"),
            "customer_name": values.get("customer_name") or " ",
            "customer_contact": values.get("customer_contact"),
            "chip_name": values.get("chip_name") or " ",
            "chip_model": values.get("chip_model"),
            "package_type": values.get("package_type") or " ",
            "quantity": values.get("quantity") or 1,
            "source_laboratory": values.get("source_laboratory"),
            "target_laboratory": values.get("target_laboratory"),
            "requested_due_date": values.get("requested_due_date") or None,
            "priority": values.get("priority") or "normal",
            "status": values.get("status") or "draft",
            "evaluation_result": values.get("evaluation_result"),
            "notes": values.get("notes"),
        }
        duplicate = connection.execute(
            """
            SELECT id
              FROM orbit_sales.customer_order
             WHERE organization_id = %s
               AND order_number IS NOT DISTINCT FROM %s
               AND customer_code IS NOT DISTINCT FROM %s
               AND customer_name IS NOT DISTINCT FROM %s
               AND customer_contact IS NOT DISTINCT FROM %s
               AND chip_name IS NOT DISTINCT FROM %s
               AND chip_model IS NOT DISTINCT FROM %s
               AND package_type IS NOT DISTINCT FROM %s
               AND quantity IS NOT DISTINCT FROM %s
               AND source_laboratory IS NOT DISTINCT FROM %s
               AND target_laboratory IS NOT DISTINCT FROM %s
               AND requested_due_date IS NOT DISTINCT FROM %s
               AND priority IS NOT DISTINCT FROM %s
               AND status IS NOT DISTINCT FROM %s
               AND evaluation_result IS NOT DISTINCT FROM %s
               AND notes IS NOT DISTINCT FROM %s
             LIMIT 1
            """,
            (user.scope.organization_id, *stored_values.values()),
        ).fetchone()
        if duplicate is not None:
            raise HTTPException(
                status_code=409,
                detail="An identical order already exists; change at least one field before saving",
            )
        orphan_runtime_ids = connection.execute(
            """
            SELECT i.id
              FROM orbit_runtime.workflow_instance i
              JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
             WHERE w.workflow_key = %s
               AND i.organization_id = %s
               AND i.business_key = %s
               AND NOT EXISTS (
                   SELECT 1
                     FROM orbit_sales.customer_order existing_order
                    WHERE existing_order.id::text = i.context_json ->> 'order_id'
               )
            """,
            (workflow_key, user.scope.organization_id, order_number),
        ).fetchall()
        for runtime_row in orphan_runtime_ids:
            WorkflowRuntimeService(connection).delete_record(
                runtime_row["id"], workflow_key, user.scope.organization_id
            )
        try:
            created = connection.execute(
                """
                INSERT INTO orbit_sales.customer_order (
                    order_number, customer_code, customer_name, customer_contact,
                    chip_name, chip_model, package_type, quantity,
                    source_laboratory, target_laboratory, requested_due_date,
                    priority, status, evaluation_result, notes,
                    organization_id, department_id, laboratory_id, created_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, COALESCE(NULLIF(%s, ''), ' '),
                        COALESCE(%s, 1), %s, %s, NULLIF(%s, '')::date,
                        COALESCE(NULLIF(%s, ''), 'normal'),
                        COALESCE(NULLIF(%s, ''), 'draft'), %s, %s,
                        %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    order_number,
                    values.get("customer_code"),
                    values.get("customer_name") or " ",
                    values.get("customer_contact"),
                    values.get("chip_name") or " ",
                    values.get("chip_model"),
                    values.get("package_type"),
                    values.get("quantity") or 1,
                    values.get("source_laboratory"),
                    values.get("target_laboratory"),
                    values.get("requested_due_date"),
                    values.get("priority"),
                    values.get("status"),
                    values.get("evaluation_result"),
                    values.get("notes"),
                    user.scope.organization_id,
                    user.scope.department_id,
                    user.scope.laboratory_id,
                    user.user_id,
                ),
            ).fetchone()
        except Exception as error:
            if getattr(error, "sqlstate", None) == "23505":
                raise HTTPException(
                    status_code=409,
                    detail="A record with this order number already exists. Enter a different order number.",
                ) from error
            raise
        # Creating an order completes the first intake step. Keep this
        # transition in the same database transaction as the order insert so
        # the workflow cannot remain on step 01 when the order is saved.
        workflow = connection.execute(
            """
            SELECT id, catalog_version
              FROM orbit_workflow.workflow_definition
             WHERE workflow_key = %s AND is_active
            """,
            (workflow_key,),
        ).fetchone()
        if workflow is not None:
            runtime = WorkflowRuntimeService(connection)
            try:
                instance = runtime.start(
                    workflow_id=workflow["id"],
                    workflow_key=workflow_key,
                    business_key=order_number,
                    context={"order_id": str(created["id"]), "order_number": order_number},
                    organization_id=user.scope.organization_id,
                    department_id=user.scope.department_id,
                    laboratory_id=user.scope.laboratory_id,
                    started_by=user.user_id,
                    catalog_version=workflow["catalog_version"],
                )
            except Exception as error:
                if getattr(error, "sqlstate", None) == "23505":
                    raise HTTPException(
                        status_code=409,
                        detail="A stale workflow instance still uses this order number. Delete the orphaned workflow instance before recreating the order.",
                    ) from error
                raise
            runtime.transition(
                instance_id=instance["id"],
                expected_version=instance["version"],
                target_record_key=None,
                outcome="submit",
                payload={"source": "order.create"},
                actor_user_id=user.user_id,
                workflow_key=workflow_key,
            )
        return _customer_order_record(connection, created["id"], request.locale)
    if _is_runtime_workflow(definition):
        values = _editable_values(definition, request.values)
        business_key = str(values.get("business_key") or f"{workflow_key}-{uuid4().hex[:12]}")
        context = values.get("context") if isinstance(values.get("context"), dict) else {}
        workflow_row = connection.execute(
            """
            SELECT w.id, w.catalog_version,
                   (SELECT record_key FROM orbit_workflow.workflow_record r
                     WHERE r.workflow_id = w.id ORDER BY record_order LIMIT 1) AS first_record_key
              FROM orbit_workflow.workflow_definition w
             WHERE w.workflow_key = %s AND w.is_active
            """,
            (workflow_key,),
        ).fetchone()
        if workflow_row is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        try:
            created = WorkflowRuntimeService(connection).create_record(
                workflow_id=workflow_row["id"], workflow_key=workflow_key,
                business_key=business_key, status=values.get("status") or "draft",
                context=context, organization_id=user.scope.organization_id,
                department_id=user.scope.department_id, laboratory_id=user.scope.laboratory_id,
                started_by=user.user_id, catalog_version=workflow_row["catalog_version"],
            )
        except Exception as error:
            if getattr(error, "sqlstate", None) == "23505":
                raise HTTPException(
                    status_code=409, detail="Business key already exists"
                ) from error
            raise
        return _runtime_record(connection, created["id"], request.locale)
    values = _editable_values(definition, request.values)
    scope_text, scope_values = _scope_clause(user)
    workflow_row = connection.execute(
        "SELECT id FROM orbit_workflow.workflow_definition WHERE workflow_key = %s AND is_active",
        (workflow_key,),
    ).fetchone()
    if workflow_row is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    record_key = request.record_key or f"{workflow_key}-{uuid4().hex[:12]}"
    order_row = connection.execute(
        """
        SELECT COALESCE(MAX(record_order), 0) + 1 AS next_order
          FROM orbit_workflow.workflow_business_record
         WHERE workflow_id = %s
        """,
        (workflow_row["id"],),
    ).fetchone()
    record_order = request.record_order or order_row["next_order"]
    label = next((str(value) for value in values.values() if value not in (None, "")), record_key)
    label_i18n = {"en": label, "zh_CN": label, "zh_HK": label}
    try:
        created = connection.execute(
            """
            INSERT INTO orbit_workflow.workflow_business_record (
                workflow_id, record_key, record_order, label_i18n, values_json,
                organization_id, department_id, laboratory_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                workflow_row["id"], record_key, record_order, Jsonb(label_i18n), Jsonb(values),
                user.scope.organization_id, user.scope.department_id, user.scope.laboratory_id,
            ),
        ).fetchone()
    except Exception as error:
        if getattr(error, "sqlstate", None) == "23505":
            raise HTTPException(
                status_code=409, detail="Record key or order already exists"
            ) from error
        raise
    connection.execute(
        """
        INSERT INTO orbit_audit.audit_event (actor_user_id, action, entity_type, entity_id,
            organization_id, after_json, metadata)
        VALUES (%s, 'record.create', 'workflow_business_record', %s, %s, %s, %s)
        """,
        (
            user.user_id,
            str(created["id"]),
            user.scope.organization_id,
            Jsonb(created["values_json"]),
            Jsonb({"workflow_key": workflow_key}),
        ),
    )
    return _record_model(created, request.locale)


def delete_record(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    record_id: UUID,
) -> None:
    require_workflow_access(connection, user.user_id, workflow_key, "edit")
    definition = get_workflow(connection, user, workflow_key, "en")
    if _is_customer_relations_workflow(definition):
        order = connection.execute(
            """
            SELECT id, order_number
              FROM orbit_sales.customer_order
             WHERE id = %s AND organization_id = %s
            """,
            (record_id, user.scope.organization_id),
        ).fetchone()
        if order is None:
            raise HTTPException(status_code=404, detail="Customer order not found")
        runtime_ids = connection.execute(
            """
            SELECT i.id
              FROM orbit_runtime.workflow_instance i
              JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
             WHERE w.workflow_key = %s
               AND i.organization_id = %s
               AND (
                   i.context_json ->> 'order_id' = %s
                   OR i.business_key = %s
               )
            """,
            (workflow_key, user.scope.organization_id, str(record_id), order["order_number"]),
        ).fetchall()
        deleted = connection.execute(
            """
            DELETE FROM orbit_sales.customer_order
             WHERE id = %s AND organization_id = %s
            RETURNING id
            """,
            (record_id, user.scope.organization_id),
        ).fetchone()
        if deleted is None:
            raise HTTPException(status_code=404, detail="Customer order not found")
        for runtime_row in runtime_ids:
            WorkflowRuntimeService(connection).delete_record(
                runtime_row["id"], workflow_key, user.scope.organization_id
            )
        return
    if _is_runtime_workflow(definition):
        deleted_id = WorkflowRuntimeService(connection).delete_record(
            record_id, workflow_key, user.scope.organization_id
        )
        deleted = {"id": deleted_id} if deleted_id else None
        if deleted is None:
            raise HTTPException(status_code=404, detail="Workflow instance not found")
        return
    scope_text, scope_values = _scope_clause(user)
    before = connection.execute(
        f"""
        SELECT r.* FROM orbit_workflow.workflow_business_record r
        JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
        WHERE r.id = %s AND w.workflow_key = %s {scope_text}
        """,
        (record_id, workflow_key, *scope_values),
    ).fetchone()
    if before is None:
        raise HTTPException(status_code=404, detail="Workflow record not found")
    connection.execute(
        "DELETE FROM orbit_workflow.workflow_business_record WHERE id = %s", (record_id,)
    )
    connection.execute(
        """
        INSERT INTO orbit_audit.audit_event (actor_user_id, action, entity_type, entity_id,
            organization_id, before_json, metadata)
        VALUES (%s, 'record.delete', 'workflow_business_record', %s, %s, %s, %s)
        """,
        (user.user_id, str(record_id), user.scope.organization_id, Jsonb(before["values_json"]),
         Jsonb({"workflow_key": workflow_key})),
    )


def get_tree(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    locale: str,
    selected_record_id: UUID | None,
    selected_cell_key: str | None,
    requested_step_key: str | None = None,
) -> WorkflowTree:
    definition = get_workflow(connection, user, workflow_key, locale)
    if not _is_runtime_workflow(definition):
        return WorkflowTree(
            workflow_key=workflow_key,
            workflow_name=definition.name,
            selected_record_id=None,
            selected_cell_key=None,
            selected_cell_value=None,
            nodes=[],
            edges=[],
        )
    rows = connection.execute(
        """
        SELECT r.id, r.record_key, r.record_order, r.label_i18n, r.values_json,
               assignment.contact_name AS assigned_contact_name,
               assignment.contact_name AS assigned_owner_name,
               assignment.contact_email AS assigned_contact_email,
               assignment.business_entity AS assigned_business_entity,
               assignment."documentAction" AS assigned_document_action,
               assignment."decisionAction" AS decision_action,
               assignment.sla AS assigned_sla,
               sla.sla_i18n,
               sla.sla
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
          LEFT JOIN orbit_workflow.workflow_step_assignment assignment
            ON assignment.workflow_record_id = r.id
          LEFT JOIN orbit_workflow.sla_lookup sla
            ON sla.group_name = COALESCE(w.group_name_i18n ->> 'en', w.group_key)
           AND sla.workflow_name = COALESCE(w.name_i18n ->> 'en', w.workflow_key)
           AND sla.record_key = r.record_key
           AND sla.current_workflow_step = COALESCE(r.label_i18n ->> 'en', r.record_key)
           AND sla.is_active
         WHERE w.workflow_key = %s
         ORDER BY r.record_order
        """,
        (workflow_key,),
    ).fetchall()
    selected_step_key: str | None = requested_step_key
    if selected_record_id is not None and _is_runtime_workflow(definition):
        if _is_customer_relations_workflow(definition):
            runtime_filter = """
                   AND (
                       i.id = %s
                       OR i.context_json ->> 'order_id' = %s
                       OR i.business_key = (
                           SELECT order_number
                             FROM orbit_sales.customer_order
                            WHERE id = %s
                       )
                   )
            """
            runtime_parameters = (
                workflow_key,
                user.scope.organization_id,
                selected_record_id,
                str(selected_record_id),
                selected_record_id,
            )
        else:
            runtime_filter = "AND i.id = %s"
            runtime_parameters = (
                workflow_key,
                user.scope.organization_id,
                selected_record_id,
            )
        runtime_row = connection.execute(
            f"""
            SELECT i.current_record_key, n.status AS current_step_status
              FROM orbit_runtime.workflow_instance i
              JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
              LEFT JOIN orbit_runtime.workflow_node_instance n
                ON n.instance_id = i.id AND n.record_key = i.current_record_key
             WHERE w.workflow_key = %s
               AND i.organization_id = %s
               {runtime_filter}
             ORDER BY i.updated_at DESC
             LIMIT 1
            """,
            runtime_parameters,
        ).fetchone()
        if selected_step_key is None:
            selected_step_key = (
                runtime_row["current_record_key"]
                if runtime_row and runtime_row["current_step_status"] in {"active", "waiting"}
                else None
            )
        if (
            selected_step_key is None
            and _is_customer_relations_workflow(definition)
            and workflow_key not in _SUBWORKFLOW_PREREQUISITES
            and rows
        ):
            # The runtime projection may initialize a new instance in a
            # parallel request. Keep the tree aligned with that instance's
            # deterministic first step until the projection is available.
            selected_step_key = rows[0]["record_key"]

    # DocumentAction starts incomplete for every business-entity step. Do not expose
    # the legacy shared assignment flag, which can contain stale true data
    # from another order.
    for row in rows:
        row["assigned_document_action"] = False if row["assigned_business_entity"] else None

    selected_order = next(
        (
            row["record_order"]
            for row in rows
            if row["record_key"] == selected_step_key
            or (selected_step_key is None and row["id"] == selected_record_id)
        ),
        None,
    )
    selected_row = next(
        (
            row
            for row in rows
            if row["record_key"] == selected_step_key
            or (selected_step_key is None and row["id"] == selected_record_id)
        ),
        None,
    )
    tree_selected_record_id = selected_record_id
    nodes = [
        TreeNode(
            record_id=row["id"],
            record_key=row["record_key"],
            order=row["record_order"],
            label=localized_value(row["label_i18n"], locale),
            owner_role=_localized_step_value(row["values_json"].get("owner_role"), locale),
            owner_name=row["assigned_owner_name"] or None,
            time_limit=_localized_step_value(row["values_json"].get("time_limit"), locale),
            ContactName=(row["assigned_contact_name"] or _step_contact_value(
                row["values_json"], "ContactName", "contact_name", "联系人姓名"
            )),
            Email=(row["assigned_contact_email"] or _step_contact_value(
                row["values_json"], "Email", "email", "联系人邮箱"
            )),
            Messages=_step_messages(row["values_json"]),
            business_entity=row["assigned_business_entity"],
            DocumentAction=row["assigned_document_action"],
            decisionAction=bool(row["decision_action"]),
            sla=_localized_step_value(row["assigned_sla"], locale) or localized_value(row["sla_i18n"], locale, row["sla"]),
            is_selected=(
                row["record_key"] == selected_step_key
                or row["id"] == selected_record_id
            ),
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
        selected_record_id=tree_selected_record_id,
        selected_cell_key=selected_cell_key,
        selected_cell_value=(
            selected_row["values_json"].get(selected_cell_key)
            if selected_row and selected_cell_key
            else None
        ),
        nodes=nodes,
        edges=[TreeEdge(**edge) for edge in definition_row["edges_json"]],
    )


def append_workflow_step_message(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    workflow_key: str,
    record_id: UUID,
    request: WorkflowStepMessageRequest,
) -> WorkflowStepMessagesResponse:
    require_workflow_access(connection, user.user_id, workflow_key, "execute")
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Message cannot be blank")
    before = connection.execute(
        """
        SELECT r.*
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
         WHERE r.id = %s AND w.workflow_key = %s
         FOR UPDATE
        """,
        (record_id, workflow_key),
    ).fetchone()
    if before is None:
        raise HTTPException(status_code=404, detail="Workflow step not found")
    messages = [*_step_messages(before["values_json"]), message]
    updated = connection.execute(
        """
        UPDATE orbit_workflow.workflow_record
           SET values_json = jsonb_set(values_json, '{Messages}', %s),
               version = version + 1,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = %s
        RETURNING values_json
        """,
        (Jsonb(messages), record_id),
    ).fetchone()
    if updated is None:
        raise HTTPException(status_code=404, detail="Workflow step not found")
    connection.execute(
        """
        INSERT INTO orbit_audit.audit_event (
            actor_user_id, action, entity_type, entity_id,
            organization_id, before_json, after_json, metadata
        )
        VALUES (%s, 'workflow_step.message_append', 'workflow_record', %s, %s, %s, %s, %s)
        """,
        (
            user.user_id,
            str(record_id),
            user.scope.organization_id,
            Jsonb(before["values_json"]),
            Jsonb(updated["values_json"]),
            Jsonb({"workflow_key": workflow_key}),
        ),
    )
    return WorkflowStepMessagesResponse(record_id=record_id, Messages=messages)


def _instance_model(row: dict[str, Any]) -> WorkflowInstance:
    return WorkflowInstance(
        id=row["id"],
        workflow_key=row["workflow_key"],
        catalog_version=row["catalog_version"],
        business_key=row["business_key"],
        current_record_key=row["current_record_key"],
        status=row["status"],
        context=row["context_json"],
        version=row["version"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        updated_at=row["updated_at"],
    )


def _available_actions(status: str, can_execute: bool) -> list[str]:
    if not can_execute:
        return []
    if status == "active":
        return ["submit", "email", "abort"]
    if status in {"failed", "blocked"}:
        return ["resubmit", "abort"]
    if status == "waiting":
        return ["acknowledge", "abort"]
    if status == "pending":
        return []
    return []


def _subworkflow_dependency_ready(
    connection: Connection[dict[str, Any]],
    current: dict[str, Any],
) -> bool:
    """Return whether one of the catalog-derived predecessor paths is done."""
    prerequisites = _SUBWORKFLOW_PREREQUISITES.get(current["workflow_key"])
    if not prerequisites:
        return True
    business_key = str(current.get("business_key") or "").strip()
    order_id = (current.get("context_json") or {}).get("order_id")
    for prerequisite in prerequisites:
        row = connection.execute(
            """
            SELECT n.status AS last_step_status, i.status AS instance_status
              FROM orbit_runtime.workflow_instance i
              JOIN orbit_workflow.workflow_definition w
                ON w.id = i.workflow_id
              JOIN LATERAL (
                  SELECT record_key
                    FROM orbit_workflow.workflow_record
                   WHERE workflow_id = i.workflow_id
                   ORDER BY record_order DESC
                   LIMIT 1
              ) last_record ON true
              LEFT JOIN orbit_runtime.workflow_node_instance n
                ON n.instance_id = i.id AND n.record_key = last_record.record_key
             WHERE w.workflow_key = %s
               AND (
                   btrim(i.business_key) = %s
                   OR i.context_json ->> 'order_id' = %s
               )
             ORDER BY i.updated_at DESC
             LIMIT 1
            """,
            (prerequisite, business_key, str(order_id) if order_id else ""),
        ).fetchone()
        if row and row["instance_status"] == "completed" and row["last_step_status"] == "completed":
            return True
    return False


def _synchronize_subworkflow_dependency(
    connection: Connection[dict[str, Any]],
    current: dict[str, Any],
) -> dict[str, Any]:
    """Gate or release the first node of a dependent subworkflow."""
    if current["workflow_key"] not in _SUBWORKFLOW_PREREQUISITES:
        return current
    first = connection.execute(
        """
        SELECT record_key
          FROM orbit_workflow.workflow_record
         WHERE workflow_id = %s
         ORDER BY record_order
         LIMIT 1
        """,
        (current["workflow_id"],),
    ).fetchone()
    first_key = first["record_key"] if first else None
    if not first_key or current["current_record_key"] != first_key:
        return current
    ready = _subworkflow_dependency_ready(connection, current)
    changed = False
    if not ready and current["status"] in {"active", "waiting"}:
        connection.execute(
            """
            UPDATE orbit_runtime.workflow_instance
               SET status = 'waiting'
             WHERE id = %s AND status <> 'waiting'
            """,
            (current["id"],),
        )
        connection.execute(
            """
            UPDATE orbit_runtime.workflow_node_instance
               SET status = 'pending', started_at = NULL,
                   start_time = NULL, action_time = NULL, action_type = NULL
             WHERE instance_id = %s AND record_key = %s
               AND status = 'active'
            """,
            (current["id"], first_key),
        )
        connection.execute(
            """
            UPDATE orbit_runtime.workflow_task
               SET state = 'cancelled', completed_at = CURRENT_TIMESTAMP
             WHERE instance_id = %s AND record_key = %s
               AND state IN ('open', 'claimed')
            """,
            (current["id"], first_key),
        )
        changed = True
    elif ready and current["status"] == "waiting":
        connection.execute(
            """
            UPDATE orbit_runtime.workflow_instance
               SET status = 'active'
             WHERE id = %s AND status = 'waiting'
            """,
            (current["id"],),
        )
        connection.execute(
            """
            UPDATE orbit_runtime.workflow_node_instance
               SET status = 'active', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
             WHERE instance_id = %s AND record_key = %s
               AND status = 'pending'
            """,
            (current["id"], first_key),
        )
        connection.execute(
            """
            INSERT INTO orbit_runtime.workflow_task (instance_id, record_key, state, payload)
            VALUES (%s, %s, 'open', '{}'::jsonb)
            ON CONFLICT (instance_id, record_key) WHERE state IN ('open', 'claimed') DO NOTHING
            """,
            (current["id"], first_key),
        )
        changed = True
    if not changed:
        return current
    return connection.execute(
        """
        SELECT i.*, w.workflow_key, w.id AS definition_id
          FROM orbit_runtime.workflow_instance i
          JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
         WHERE i.id = %s
        """,
        (current["id"],),
    ).fetchone()


def get_runtime_projection(
    connection: Connection[dict[str, Any]], user: SessionInfo, instance_id: UUID,
    workflow_key: str | None = None,
) -> WorkflowRuntimeProjection:
    current = connection.execute(
        """
        SELECT i.*, w.workflow_key, w.id AS definition_id
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
    workflow = None
    if current is None and workflow_key:
        workflow = connection.execute(
            """
            SELECT id, catalog_version, group_key, definition_type
              FROM orbit_workflow.workflow_definition
             WHERE workflow_key = %s AND is_active
            """,
            (workflow_key,),
        ).fetchone()
    if (
        current is None
        and workflow is not None
        and workflow["group_key"] != "hr"
        and workflow["definition_type"] == "workflow"
    ):
        order = connection.execute(
            "SELECT order_number FROM orbit_sales.customer_order "
            "WHERE id = %s AND organization_id = %s",
            (instance_id, user.scope.organization_id),
        ).fetchone()
        if order and workflow:
            current = connection.execute(
                """
                SELECT i.*, w.workflow_key, w.id AS definition_id
                  FROM orbit_runtime.workflow_instance i
                  JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
                 WHERE i.workflow_id = %s AND i.business_key = %s
                """,
                (workflow["id"], order["order_number"]),
            ).fetchone()
            if current is None:
                created = WorkflowRuntimeService(connection).start(
                    workflow_id=workflow["id"], workflow_key=workflow_key,
                    business_key=order["order_number"],
                    context={"order_id": str(instance_id), "order_number": order["order_number"]},
                    organization_id=user.scope.organization_id,
                    department_id=user.scope.department_id,
                    laboratory_id=user.scope.laboratory_id,
                    started_by=user.user_id,
                    catalog_version=workflow["catalog_version"],
                )
                current = dict(created)
                current["workflow_key"] = workflow_key
                current["definition_id"] = workflow["id"]
            instance_id = current["id"]
    if current is None:
        raise HTTPException(status_code=404, detail="Workflow instance not found")
    current = _synchronize_subworkflow_dependency(connection, current)
    access = require_workflow_access(connection, user.user_id, current["workflow_key"], "view")
    WorkflowRuntimeService(connection).ensure_nodes(
        instance_id, current["workflow_id"], current["current_record_key"]
    )
    rows = connection.execute(
        """
        SELECT n.*, r.values_json, assignment.sla AS assigned_sla,
               CASE
                   WHEN n.status IN ('active', 'waiting')
                    AND orbit_workflow.extract_sla_days(COALESCE(assignment.sla, r.values_json ->> 'time_limit')) IS NOT NULL
                    AND CURRENT_TIMESTAMP >= COALESCE(n.start_time, n.started_at, i.started_at)
                        + make_interval(
                            days => orbit_workflow.extract_sla_days(
                                COALESCE(assignment.sla, r.values_json ->> 'time_limit')
                            )::integer
                        )
                   THEN true
                   ELSE false
               END AS sla_violated
          FROM orbit_runtime.workflow_node_instance n
          JOIN orbit_runtime.workflow_instance i ON i.id = n.instance_id
          JOIN orbit_workflow.workflow_record r
            ON r.workflow_id = %s AND r.record_key = n.record_key
          LEFT JOIN orbit_workflow.workflow_step_assignment assignment
            ON assignment.workflow_record_id = r.id
         WHERE n.instance_id = %s
         ORDER BY r.record_order
        """,
        (current["workflow_id"], instance_id),
    ).fetchall()
    instance = _instance_model(current)
    return WorkflowRuntimeProjection(
        instance=instance,
        nodes=[
            WorkflowNodeRuntime(
                record_key=row["record_key"],
                status=row["status"],
                completion_source=row["completion_source"],
                assigned_role=row["values_json"].get("owner_role"),
                assigned_user_id=row["assigned_user_id"],
                attempt_count=row["attempt_count"],
                error_code=row["error_code"],
                error_message=row["error_message"],
                started_at=row["started_at"],
                completed_at=row["completed_at"],
                start_time=row["start_time"],
                complete_time=row["complete_time"],
                action_time=row["action_time"],
                action_type=row["action_type"],
                sla_violated=row["sla_violated"],
                version=row["version"],
                available_actions=(
                    _available_actions(row["status"], bool(access["can_execute"]))
                    if row["record_key"] == current["current_record_key"]
                    else []
                ),
            )
            for row in rows
        ],
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
               w.catalog_version,
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
        row = WorkflowRuntimeService(connection).start(
            workflow_id=workflow["id"],
            workflow_key=workflow_key,
            business_key=request.business_key,
            context=request.context,
            organization_id=user.scope.organization_id,
            department_id=request.department_id or user.scope.department_id,
            laboratory_id=request.laboratory_id or user.scope.laboratory_id,
            started_by=user.user_id,
            catalog_version=workflow["catalog_version"],
        )
    except Exception as error:
        if getattr(error, "sqlstate", None) == "23505":
            raise HTTPException(status_code=409, detail="Business key already exists") from error
        raise
    row = _synchronize_subworkflow_dependency(connection, row)
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
    current = _synchronize_subworkflow_dependency(connection, current)
    if (
        current["workflow_key"] in _SUBWORKFLOW_PREREQUISITES
        and current["status"] == "waiting"
        and not _subworkflow_dependency_ready(connection, current)
    ):
        raise HTTPException(
            status_code=409,
            detail="This workflow is waiting for its predecessor workflow to complete",
        )
    if current["status"] not in {"active", "waiting"}:
        raise HTTPException(status_code=409, detail="Workflow instance is not active")
    try:
        updated = WorkflowRuntimeService(connection).transition(
            instance_id=instance_id,
            expected_version=request.version,
            target_record_key=request.target_record_key,
            outcome=request.outcome,
            payload=request.payload,
            actor_user_id=user.user_id,
            workflow_key=current["workflow_key"],
        )
    except Exception as error:
        sqlstate = getattr(error, "sqlstate", None)
        if sqlstate == "40001":
            raise HTTPException(status_code=409, detail="Instance version is stale") from error
        if sqlstate == "22023":
            raise HTTPException(
                status_code=400, detail="Target is not a valid workflow edge"
            ) from error
        raise
    return _instance_model(updated)


def command_instance(
    connection: Connection[dict[str, Any]],
    user: SessionInfo,
    instance_id: UUID,
    request: WorkflowCommandRequest,
) -> WorkflowRuntimeProjection:
    """Apply a user-facing workflow command and return the fresh projection."""
    current = connection.execute(
        """
        SELECT i.*, w.workflow_key
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
        # The grid identifies customer orders by order id, while the command
        # endpoint operates on workflow-instance ids. Resolve that identifier
        # here as a safety net for commands issued during a runtime rebind.
        current = connection.execute(
            """
            SELECT i.*, w.workflow_key
              FROM orbit_runtime.workflow_instance i
              JOIN orbit_workflow.workflow_definition w ON w.id = i.workflow_id
             WHERE w.group_key <> 'hr'
               AND w.definition_type = 'workflow'
               AND i.organization_id = %s
               AND (i.department_id IS NULL OR i.department_id = %s)
               AND (i.laboratory_id IS NULL OR i.laboratory_id = %s)
               AND (
                   i.context_json ->> 'order_id' = %s
                   OR i.business_key = (
                       SELECT order_number
                         FROM orbit_sales.customer_order
                        WHERE id = %s
                          AND organization_id = %s
                   )
               )
             ORDER BY i.updated_at DESC
             LIMIT 1
            """,
            (
                user.scope.organization_id,
                user.scope.department_id,
                user.scope.laboratory_id,
                str(instance_id),
                instance_id,
                user.scope.organization_id,
            ),
        ).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="Workflow instance not found")
        instance_id = current["id"]
    require_workflow_access(connection, user.user_id, current["workflow_key"], "execute")
    node_key = request.node_key or current["current_record_key"]
    if node_key != current["current_record_key"]:
        raise HTTPException(status_code=409, detail="Command must target the current workflow node")

    if request.command in {"abort", "cancel"}:
        if not request.reason or not request.reason.strip():
            raise HTTPException(status_code=422, detail="A reason is required to abort or cancel")
        try:
            WorkflowRuntimeService(connection).cancel(
                instance_id, request.version, node_key, request.reason.strip(),
                user.user_id, request.command, current["workflow_key"],
            )
        except Exception as error:
            if getattr(error, "sqlstate", None) == "40001":
                raise HTTPException(
                    status_code=409, detail="Instance version is stale or not cancellable"
                ) from error
            raise
        return get_runtime_projection(connection, user, instance_id)

    if request.command in {"reject", "request_changes"}:
        if not request.reason or not request.reason.strip():
            raise HTTPException(
                status_code=422, detail="A reason is required for this exception outcome"
            )
        try:
            WorkflowRuntimeService(connection).block(
                instance_id, request.version, node_key, request.command,
                request.reason.strip(), user.user_id, current["workflow_key"],
            )
        except Exception as error:
            if getattr(error, "sqlstate", None) == "40001":
                raise HTTPException(
                    status_code=409, detail="Instance version is stale or not active"
                ) from error
            raise
        return get_runtime_projection(connection, user, instance_id)

    if request.command == "email":
        recipient = request.payload.get("recipient_email")
        if not isinstance(recipient, str) or not recipient.strip():
            raise HTTPException(status_code=422, detail="recipient_email is required")
        WorkflowRuntimeService(connection).queue_notification(
            instance_id, node_key, recipient.strip(),
            str(request.payload.get("subject", "")),
            str(request.payload.get("body", "")),
            request.payload, user.user_id,
        )
        return get_runtime_projection(connection, user, instance_id)

    if request.command in {"retry", "resubmit"}:
        try:
            WorkflowRuntimeService(connection).resume(
                instance_id, request.version, node_key, request.payload,
                current["workflow_key"], user.user_id,
            )
        except Exception as error:
            if getattr(error, "sqlstate", None) == "40001":
                raise HTTPException(
                    status_code=409, detail="Instance version is stale or not retryable"
                ) from error
            raise
        return get_runtime_projection(connection, user, instance_id)

    if request.command not in {"submit", "acknowledge"}:
        raise HTTPException(
            status_code=409,
            detail="This workflow definition does not yet expose a transition for that command",
        )

    transition_instance(
        connection,
        user,
        instance_id,
        InstanceTransitionRequest(
            outcome=request.command,
            payload={**request.payload, **({"reason": request.reason} if request.reason else {})},
            version=request.version,
        ),
    )
    return get_runtime_projection(connection, user, instance_id)
