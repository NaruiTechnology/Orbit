"""Application-facing gateway for PostgreSQL workflow runtime functions."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.types.json import Jsonb


class WorkflowRuntimeService:
    """Coordinates durable workflow state without workflow-specific assumptions."""

    def __init__(self, connection: Connection[dict[str, Any]]) -> None:
        self.connection = connection

    def start(
        self,
        workflow_id: UUID,
        workflow_key: str,
        business_key: str,
        context: dict[str, Any],
        organization_id: UUID,
        department_id: UUID | None,
        laboratory_id: UUID | None,
        started_by: UUID,
        catalog_version: int,
    ) -> dict[str, Any]:
        return self.connection.execute(
            """
            SELECT instance.*, %s::varchar AS workflow_key
              FROM orbit_runtime.start_workflow_instance(
                %s, %s, %s, %s, %s, %s, %s, %s::integer
              ) AS instance
            """,
            (
                workflow_key,
                workflow_id,
                business_key,
                Jsonb(context),
                organization_id,
                department_id,
                laboratory_id,
                started_by,
                catalog_version,
            ),
        ).fetchone()

    def ensure_nodes(
        self, instance_id: UUID, workflow_id: UUID, current_record_key: str | None
    ) -> None:
        self.connection.execute(
            "SELECT orbit_runtime.ensure_workflow_node_instances(%s, %s, %s)",
            (instance_id, workflow_id, current_record_key),
        )

    def update_record(
        self,
        instance_id: UUID,
        expected_version: int,
        business_key: str | None,
        status: str | None,
        context: dict[str, Any] | None,
        workflow_key: str,
    ) -> dict[str, Any]:
        return self.connection.execute(
            """
            SELECT instance.*, %s::varchar AS workflow_key
              FROM orbit_runtime.update_workflow_instance_record(
                %s, %s, %s, %s, %s
              ) AS instance
            """,
            (
                workflow_key,
                instance_id,
                expected_version,
                business_key,
                status,
                Jsonb(context) if context is not None else None,
            ),
        ).fetchone()

    def create_record(
        self,
        workflow_id: UUID,
        workflow_key: str,
        business_key: str,
        status: str,
        context: dict[str, Any],
        organization_id: UUID,
        department_id: UUID | None,
        laboratory_id: UUID | None,
        started_by: UUID,
        catalog_version: int,
    ) -> dict[str, Any]:
        return self.connection.execute(
            """
            SELECT instance.*, %s::varchar AS workflow_key
              FROM orbit_runtime.create_workflow_instance_record(
                %s, %s, %s, %s, %s, %s, %s, %s, %s::integer
              ) AS instance
            """,
            (
                workflow_key,
                workflow_id,
                business_key,
                status,
                Jsonb(context),
                organization_id,
                department_id,
                laboratory_id,
                started_by,
                catalog_version,
            ),
        ).fetchone()

    def delete_record(
        self, instance_id: UUID, workflow_key: str, organization_id: UUID
    ) -> UUID | None:
        row = self.connection.execute(
            "SELECT orbit_runtime.delete_workflow_instance_record(%s, %s, %s) AS id",
            (instance_id, workflow_key, organization_id),
        ).fetchone()
        return row["id"] if row else None

    def transition(
        self,
        instance_id: UUID,
        expected_version: int,
        target_record_key: str | None,
        outcome: str,
        payload: dict[str, Any],
        actor_user_id: UUID,
        workflow_key: str,
    ) -> dict[str, Any]:
        return self.connection.execute(
            """
            SELECT instance.*, %s::varchar AS workflow_key
              FROM orbit_runtime.transition_workflow_instance(
                %s, %s, %s, %s, %s, %s
              ) AS instance
            """,
            (
                workflow_key,
                instance_id,
                expected_version,
                target_record_key,
                outcome,
                Jsonb(payload),
                actor_user_id,
            ),
        ).fetchone()

    def cancel(
        self,
        instance_id: UUID,
        expected_version: int,
        record_key: str,
        reason: str,
        actor_user_id: UUID,
        outcome: str,
        workflow_key: str,
    ) -> dict[str, Any]:
        return self.connection.execute(
            """
            SELECT instance.*, %s::varchar AS workflow_key
              FROM orbit_runtime.cancel_workflow_instance(
                %s, %s, %s, %s, %s, %s
              ) AS instance
            """,
            (
                workflow_key,
                instance_id,
                expected_version,
                record_key,
                reason,
                actor_user_id,
                outcome,
            ),
        ).fetchone()

    def block(
        self,
        instance_id: UUID,
        expected_version: int,
        record_key: str,
        outcome: str,
        reason: str,
        actor_user_id: UUID,
        workflow_key: str,
    ) -> dict[str, Any]:
        return self.connection.execute(
            """
            SELECT instance.*, %s::varchar AS workflow_key
              FROM orbit_runtime.block_workflow_node(
                %s, %s, %s, %s, %s, %s
              ) AS instance
            """,
            (
                workflow_key,
                instance_id,
                expected_version,
                record_key,
                outcome,
                reason,
                actor_user_id,
            ),
        ).fetchone()

    def resume(
        self,
        instance_id: UUID,
        expected_version: int,
        record_key: str,
        payload: dict[str, Any],
        workflow_key: str,
    ) -> dict[str, Any]:
        return self.connection.execute(
            """
            SELECT instance.*, %s::varchar AS workflow_key
              FROM orbit_runtime.resume_workflow_node(
                %s, %s, %s, %s
              ) AS instance
            """,
            (
                workflow_key,
                instance_id,
                expected_version,
                record_key,
                Jsonb(payload),
            ),
        ).fetchone()

    def queue_notification(
        self,
        instance_id: UUID,
        record_key: str,
        recipient: str,
        subject: str,
        body: str,
        payload: dict[str, Any],
        actor_user_id: UUID,
    ) -> None:
        self.connection.execute(
            """
            SELECT orbit_runtime.queue_workflow_notification(
                %s, %s, %s, %s, %s, %s, %s
            )
            """,
            (
                instance_id,
                record_key,
                recipient,
                subject,
                body,
                Jsonb(payload),
                actor_user_id,
            ),
        )

    def claim_system_tasks(self, limit: int) -> list[dict[str, Any]]:
        return self.connection.execute(
            "SELECT * FROM orbit_runtime.claim_system_workflow_tasks(%s)",
            (limit,),
        ).fetchall()

    def complete_system_task(
        self, task_id: UUID, output: dict[str, Any]
    ) -> dict[str, Any]:
        return self.connection.execute(
            """
            SELECT instance.*
              FROM orbit_runtime.complete_system_workflow_task(%s, %s) AS instance
            """,
            (task_id, Jsonb(output)),
        ).fetchone()

    def fail_system_task(self, task_id: UUID, message: str) -> None:
        self.connection.execute(
            "SELECT orbit_runtime.fail_system_workflow_task(%s, %s)",
            (task_id, message),
        )
