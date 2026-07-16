from __future__ import annotations

import os
from uuid import uuid4

import psycopg
import pytest

from app.config import get_settings

pytestmark = [
    pytest.mark.skipif(
        os.getenv("ORBIT_RUN_INTEGRATION") != "1",
        reason="Set ORBIT_RUN_INTEGRATION=1 to exercise the local PostgreSQL database.",
    ),
    pytest.mark.filterwarnings(
        "ignore:Using `httpx` with `starlette.testclient` is deprecated"
    ),
]


def test_localized_read_edit_restore_and_runtime_transition() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    settings = get_settings()
    business_key = f"INTEGRATION-{uuid4()}"
    instance_id: str | None = None

    try:
        with TestClient(app) as client:
            health = client.get("/api/v1/health")
            assert health.status_code == 200
            assert health.json()["server_encoding"] == "UTF8"
            assert health.json()["client_encoding"] == "UTF8"

            workflows = client.get("/api/v1/workflows", params={"locale": "zh-HK"})
            assert workflows.status_code == 200
            assert len(workflows.json()) == 24
            assert workflows.json()[0]["name"] == "全流程圖"

            records = client.get(
                "/api/v1/workflows/master-workflow/records",
                params={"locale": "zh-CN", "limit": 10},
            )
            assert records.status_code == 200
            record = records.json()["items"][0]
            original_notes = record["values"]["notes"]
            mixed_value = "UTF-8 验证 / Mixed language verification"

            changed = client.patch(
                f"/api/v1/workflows/master-workflow/records/{record['id']}",
                json={
                    "values": {"notes": mixed_value},
                    "version": record["version"],
                    "locale": "zh-CN",
                },
            )
            assert changed.status_code == 200
            assert changed.json()["values"]["notes"] == mixed_value

            restored = client.patch(
                f"/api/v1/workflows/master-workflow/records/{record['id']}",
                json={
                    "values": {"notes": original_notes},
                    "version": changed.json()["version"],
                    "locale": "zh-CN",
                },
            )
            assert restored.status_code == 200
            assert restored.json()["values"]["notes"] == original_notes

            started = client.post(
                "/api/v1/workflows/technical-intake/instances",
                json={
                    "business_key": business_key,
                    "context": {"customer": "测试客户 / Test Customer"},
                },
            )
            assert started.status_code == 201
            instance_id = started.json()["id"]

            transitioned = client.post(
                f"/api/v1/workflows/instances/{instance_id}/transitions",
                json={
                    "outcome": "complete",
                    "version": started.json()["version"],
                    "payload": {"comment": "评估通过 / approved"},
                },
            )
            assert transitioned.status_code == 200
            assert transitioned.json()["version"] == started.json()["version"] + 1
    finally:
        if instance_id:
            with psycopg.connect(
                settings.database.conninfo,
                **settings.database.connect_kwargs,
            ) as connection:
                connection.execute(
                    "DELETE FROM orbit_runtime.workflow_instance WHERE id = %s",
                    (instance_id,),
                )
                connection.commit()
