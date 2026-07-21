"""Idempotently load workbook-derived definitions into PostgreSQL."""

from __future__ import annotations

import re
from typing import Any

from psycopg import Connection
from psycopg.types.json import Jsonb

_ENGLISH_DAY_DURATION_PATTERN = re.compile(
    r"(?P<days>\d+(?:\.\d+)?)\s*(?:business\s+days?|working\s+days?|days?|day)",
    re.IGNORECASE,
)
_CHINESE_DAY_DURATION_PATTERN = re.compile(
    r"(?P<days>\d+(?:\.\d+)?)\s*(?P<unit>个工作日|工作日|天|日)(?P<suffix>内|以内)?",
)


def _sla_days(time_limit: Any) -> float | None:
    """Return the numeric duration before a Chinese work-day/day marker."""
    text = str(time_limit or "").strip()
    if not text or any(
        marker in text for marker in ("每月", "每季度", "每年", "当月", "当天", "当日")
    ):
        return None
    match = _CHINESE_DAY_DURATION_PATTERN.search(text)
    if not match:
        return None
    days = float(match.group("days"))
    return days if days >= 1 else None


def _sla_i18n(time_limit: Any) -> dict[str, str]:
    """Build locale-keyed SLA text instead of storing one source-language string."""
    text = str(time_limit or "").strip()
    chinese_match = _CHINESE_DAY_DURATION_PATTERN.search(text)
    if chinese_match:
        days = chinese_match.group("days")
        suffix = "内" if chinese_match.group("suffix") else ""
        return {
            "en": f"Within {days} business day" + ("s" if days != "1" else ""),
            "zh_CN": f"{days}个工作日{suffix}",
            "zh_HK": f"{days}個工作日{'內' if suffix else ''}",
        }
    english_match = _ENGLISH_DAY_DURATION_PATTERN.fullmatch(text)
    if english_match:
        days = english_match.group("days")
        return {
            "en": text,
            "zh_CN": f"{days}个工作日内",
            "zh_HK": f"{days}個工作日內",
        }
    return {"en": text, "zh_CN": text, "zh_HK": text}


def _english_i18n_value(values: dict[str, Any], fallback: str) -> str:
    value = values.get("en") or values.get("zh_CN") or fallback
    return str(value)


def import_catalog(
    connection: Connection[Any],
    catalog: dict[str, Any],
    actor_user_id: str | None = None,
) -> dict[str, int]:
    """Upsert all definitions and rows in one caller-managed transaction."""

    definition_ids: dict[str, str] = {}
    imported_records = 0
    sla_count = 0

    for workflow in catalog["workflows"]:
        metadata = {
            "header_row": workflow["header_row"],
            "merged_ranges": workflow["merged_ranges"],
            "source_timezone": catalog["source_timezone"],
            "encoding": catalog["encoding"],
        }
        row = connection.execute(
            """
            INSERT INTO orbit_workflow.workflow_definition (
                workflow_key,
                group_key,
                definition_type,
                name_i18n,
                group_name_i18n,
                source_sheet,
                source_sheet_index,
                source_sha256,
                is_master,
                display_order,
                schema_json,
                edges_json,
                metadata,
                catalog_version,
                is_active
            )
            VALUES (
                %(workflow_key)s,
                %(group_key)s,
                %(definition_type)s,
                %(name_i18n)s,
                %(group_name_i18n)s,
                %(source_sheet)s,
                %(source_sheet_index)s,
                %(source_sha256)s,
                %(is_master)s,
                %(display_order)s,
                %(schema_json)s,
                %(edges_json)s,
                %(metadata)s,
                %(catalog_version)s,
                true
            )
            ON CONFLICT (workflow_key) DO UPDATE
            SET group_key = EXCLUDED.group_key,
                definition_type = EXCLUDED.definition_type,
                name_i18n = EXCLUDED.name_i18n,
                group_name_i18n = EXCLUDED.group_name_i18n,
                source_sheet = EXCLUDED.source_sheet,
                source_sheet_index = EXCLUDED.source_sheet_index,
                source_sha256 = EXCLUDED.source_sha256,
                is_master = EXCLUDED.is_master,
                display_order = EXCLUDED.display_order,
                schema_json = EXCLUDED.schema_json,
                edges_json = EXCLUDED.edges_json,
                metadata = EXCLUDED.metadata,
                catalog_version = EXCLUDED.catalog_version,
                is_active = true,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id
            """,
            {
                "workflow_key": workflow["key"],
                "group_key": workflow["group_key"],
                "definition_type": workflow["definition_type"],
                "name_i18n": Jsonb(workflow["name_i18n"]),
                "group_name_i18n": Jsonb(workflow["group_name_i18n"]),
                "source_sheet": workflow["source_sheet"],
                "source_sheet_index": workflow["source_sheet_index"],
                "source_sha256": catalog["source_sha256"],
                "is_master": workflow["is_master"],
                "display_order": workflow["display_order"],
                "schema_json": Jsonb(workflow["columns"]),
                "edges_json": Jsonb(workflow["edges"]),
                "metadata": Jsonb(metadata),
                "catalog_version": catalog["catalog_version"],
            },
        ).fetchone()
        if row is None:
            raise RuntimeError(f"Could not import workflow '{workflow['key']}'")
        definition_id = str(row["id"])
        definition_ids[workflow["key"]] = definition_id

        if workflow["key"] == "customer-pool-rules":
            connection.execute(
                "DELETE FROM orbit_workflow.customer_pool_rule WHERE definition_id = %s",
                (definition_id,),
            )
            for record in workflow["records"]:
                values = record["values"]
                connection.execute(
                    """
                    INSERT INTO orbit_workflow.customer_pool_rule (
                        definition_id, rule_key, record_order, reclaim_trigger,
                        decision_criteria, reclaim_period_options, alert_milestones,
                        post_reclaim_action, reclaim_exceptions, implementation_method,
                        values_json, source_row, source_cells
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        definition_id,
                        record["record_key"],
                        record["record_order"],
                        values.get("reclaim_trigger"),
                        values.get("decision_criteria"),
                        values.get("reclaim_period_options"),
                        values.get("alert_milestones"),
                        values.get("post_reclaim_action"),
                        values.get("reclaim_exceptions"),
                        values.get("implementation_method"),
                        Jsonb(values),
                        record["source_row"],
                        Jsonb(record["source_cells"]),
                    ),
                )
                imported_records += 1
            continue

        if workflow["key"] == "business-alert-rules":
            connection.execute(
                "DELETE FROM orbit_workflow.business_alert_rule WHERE definition_id = %s",
                (definition_id,),
            )
            for record in workflow["records"]:
                values = record["values"]
                connection.execute(
                    """
                    INSERT INTO orbit_workflow.business_alert_rule (
                        definition_id, rule_key, record_order, sequence_number,
                        alert_name, module_name, trigger_condition, alert_level,
                        notification_audience, notification_channel,
                        notification_summary, resolution_action, performance_link,
                        is_enabled, values_json, source_row, source_cells
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s)
                    """,
                    (
                        definition_id,
                        record["record_key"],
                        record["record_order"],
                        values.get("sequence_number"),
                        values.get("alert_name"),
                        values.get("module_name"),
                        values.get("trigger_condition"),
                        values.get("alert_level"),
                        values.get("notification_audience"),
                        values.get("notification_channel"),
                        values.get("notification_summary"),
                        values.get("resolution_action"),
                        values.get("performance_link"),
                        values.get("is_enabled"),
                        Jsonb(values),
                        record["source_row"],
                        Jsonb(record["source_cells"]),
                    ),
                )
                imported_records += 1
            continue

        if workflow["definition_type"] == "lookup_table":
            # Lookup rows have their own stable table. Do not delete from
            # workflow_record or workflow_business_record here: those tables
            # belong to the workflow definition/runtime data and are not an
            # import staging area for lookup rows.
            connection.execute(
                "DELETE FROM orbit_workflow.notification_template WHERE definition_id = %s",
                (definition_id,),
            )
            for record in workflow["records"]:
                values = record["values"]
                connection.execute(
                    """
                    INSERT INTO orbit_workflow.notification_template (
                        definition_id, template_key, record_order,
                        notification_scenario, notification_channel, recipient,
                        template_title, template_body, is_customizable,
                        values_json, source_row, source_cells
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        definition_id,
                        record["record_key"],
                        record["record_order"],
                        values.get("notification_scenario"),
                        values.get("notification_channel"),
                        values.get("recipient"),
                        values.get("template_title"),
                        values.get("template_body"),
                        values.get("is_customizable"),
                        Jsonb(values),
                        record["source_row"],
                        Jsonb(record["source_cells"]),
                    ),
                )
                imported_records += 1
            continue

        # Move existing positions out of the positive range before an upsert so
        # reordered source rows cannot collide with the unique order key.
        connection.execute(
            """
            UPDATE orbit_workflow.workflow_record
               SET record_order = -record_order
             WHERE workflow_id = %s AND record_order > 0
            """,
            (definition_id,),
        )
        connection.execute(
            """
            UPDATE orbit_workflow.workflow_business_record
               SET record_order = -record_order
             WHERE workflow_id = %s AND record_order > 0
            """,
            (definition_id,),
        )

        active_record_keys: list[str] = []
        for record in workflow["records"]:
            active_record_keys.append(record["record_key"])
            connection.execute(
                """
                INSERT INTO orbit_workflow.workflow_record (
                    workflow_id,
                    record_key,
                    record_order,
                    label_i18n,
                    values_json,
                    source_row,
                    source_cells
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (workflow_id, record_key) DO UPDATE
                SET record_order = EXCLUDED.record_order,
                    label_i18n = EXCLUDED.label_i18n,
                    values_json = EXCLUDED.values_json,
                    source_row = EXCLUDED.source_row,
                    source_cells = EXCLUDED.source_cells
                """,
                (
                    definition_id,
                    record["record_key"],
                    record["record_order"],
                    Jsonb(record["label_i18n"]),
                    Jsonb(record["values"]),
                    record["source_row"],
                    Jsonb(record["source_cells"]),
                ),
            )
            # Workflow definitions are process sources, not business-grid
            # rows. In particular, never materialize Order Evaluation's
            # process steps as editable records with a missing table id.
            if workflow["definition_type"] != "workflow":
                connection.execute(
                    """
                    INSERT INTO orbit_workflow.workflow_business_record (
                        workflow_id, workflow_record_id, record_key, record_order,
                        label_i18n, values_json, source_row, source_cells
                    )
                    SELECT workflow_id, id, record_key, record_order,
                           label_i18n, values_json, source_row, source_cells
                      FROM orbit_workflow.workflow_record
                     WHERE workflow_id = %s AND record_key = %s
                    ON CONFLICT (workflow_id, record_key) DO UPDATE
                       SET workflow_record_id = EXCLUDED.workflow_record_id,
                           record_order = EXCLUDED.record_order,
                           label_i18n = EXCLUDED.label_i18n,
                           values_json = EXCLUDED.values_json,
                           source_row = EXCLUDED.source_row,
                           source_cells = EXCLUDED.source_cells
                    """,
                    (definition_id, record["record_key"]),
                )
            imported_records += 1

        connection.execute(
            """
            DELETE FROM orbit_workflow.workflow_record
             WHERE workflow_id = %s
               AND NOT (record_key = ANY(%s))
            """,
            (definition_id, active_record_keys),
        )
        connection.execute(
            """
            DELETE FROM orbit_workflow.workflow_business_record
             WHERE workflow_id = %s
               AND source_row IS NOT NULL
               AND NOT (record_key = ANY(%s))
            """,
            (definition_id, active_record_keys),
        )
        if workflow["definition_type"] == "workflow":
            connection.execute(
                "DELETE FROM orbit_workflow.workflow_business_record WHERE workflow_id = %s",
                (definition_id,),
            )

    for workflow in catalog["workflows"]:
        parent_key = workflow["parent_key"]
        connection.execute(
            """
            UPDATE orbit_workflow.workflow_definition
               SET parent_id = %s
             WHERE id = %s
            """,
            (
                definition_ids.get(parent_key) if parent_key else None,
                definition_ids[workflow["key"]],
            ),
        )

    # SLA rows are derived entirely from the catalog's workflow-step time
    # limits. Replacing the generated container makes catalog imports
    # idempotent and removes rows for deleted or shortened source steps.
    connection.execute("DELETE FROM orbit_workflow.sla_lookup")
    for workflow in catalog["workflows"]:
        if workflow["definition_type"] != "workflow":
            continue
        group_name = _english_i18n_value(workflow["group_name_i18n"], workflow["group_key"])
        workflow_name = _english_i18n_value(workflow["name_i18n"], workflow["key"])
        for record in workflow["records"]:
            values = record.get("values", {})
            sla_days = _sla_days(values.get("time_limit"))
            if sla_days is None:
                continue
            current_step = _english_i18n_value(record["label_i18n"], record["record_key"])
            sla_i18n = _sla_i18n(values["time_limit"])
            lookup_key = " | ".join(
                (group_name, workflow_name, record["record_key"], current_step)
            )
            connection.execute(
                """
                INSERT INTO orbit_workflow.sla_lookup (
                    lookup_key, group_name, workflow_name, record_key,
                    current_workflow_step, sla, sla_i18n, sla_days,
                    source_sha256, catalog_version, is_active
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true)
                ON CONFLICT (lookup_key) DO UPDATE
                SET group_name = EXCLUDED.group_name,
                    workflow_name = EXCLUDED.workflow_name,
                    record_key = EXCLUDED.record_key,
                    current_workflow_step = EXCLUDED.current_workflow_step,
                    sla = EXCLUDED.sla,
                    sla_i18n = EXCLUDED.sla_i18n,
                    sla_days = EXCLUDED.sla_days,
                    source_sha256 = EXCLUDED.source_sha256,
                    catalog_version = EXCLUDED.catalog_version,
                    is_active = true,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    lookup_key,
                    group_name,
                    workflow_name,
                    record["record_key"],
                    current_step,
                    str(values["time_limit"]),
                    Jsonb(sla_i18n),
                    sla_days,
                    catalog["source_sha256"],
                    catalog["catalog_version"],
                ),
            )
            sla_count += 1

    connection.execute(
        """
        INSERT INTO orbit_audit.audit_event (
            actor_user_id, action, entity_type, entity_id, after_json, metadata
        )
        VALUES (%s, 'catalog.import', 'workflow_catalog', %s, %s, %s)
        """,
        (
            actor_user_id,
            catalog["source_sha256"],
            Jsonb(
                {
                    "workflow_count": len(catalog["workflows"]),
                    "record_count": imported_records,
                    "sla_count": sla_count,
                }
            ),
            Jsonb(
                {
                    "source_file": catalog["source_file"],
                    "catalog_version": catalog["catalog_version"],
                    "encoding": catalog["encoding"],
                }
            ),
        ),
    )
    return {
        "workflow_count": len(definition_ids),
        "record_count": imported_records,
        "sla_count": sla_count,
    }
