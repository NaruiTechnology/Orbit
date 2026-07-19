"""Durable system-task execution used by the AutomationPy adapter."""

from __future__ import annotations

from typing import Any

from psycopg import Connection

from app.services.workflow_runtime_service import WorkflowRuntimeService


def process_system_tasks(
    connection: Connection[dict[str, Any]], limit: int = 20,
) -> dict[str, int]:
    """Claim and execute system-owned tasks once.

    Human-owned tasks stay open for the UI.  The worker only advances nodes
    whose catalog owner is ``系统`` (or ``System``), making it safe to run
    repeatedly and from multiple AutomationPy processes.
    """
    runtime = WorkflowRuntimeService(connection)
    tasks = runtime.claim_system_tasks(limit)
    processed = 0
    failed = 0
    for task in tasks:
        try:
            output = _execute_system_action(task)
            runtime.complete_system_task(task["task_id"], output)
            processed += 1
        except Exception as error:  # noqa: BLE001 - persist worker failure before continuing
            runtime.fail_system_task(task["task_id"], str(error))
            failed += 1
    return {"claimed": len(tasks), "processed": processed, "failed": failed}


def _execute_system_action(task: dict[str, Any]) -> dict[str, Any]:
    """Execute the first safe system action; external actions can be registered here."""
    return {
        "executed": True,
        "record_key": task["record_key"],
        "action": task["values_json"].get("system_action", ""),
    }
