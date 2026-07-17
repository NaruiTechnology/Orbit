"""Idempotently load workbook-derived definitions into PostgreSQL."""

from __future__ import annotations

from typing import Any

from psycopg import Connection
from psycopg.types.json import Jsonb


def import_catalog(
    connection: Connection[Any],
    catalog: dict[str, Any],
    actor_user_id: str | None = None,
) -> dict[str, int]:
    """Upsert all definitions and rows in one caller-managed transaction."""

    definition_ids: dict[str, str] = {}
    imported_records = 0

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
    }
