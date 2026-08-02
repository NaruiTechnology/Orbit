"""Operational health and encoding diagnostics."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from psycopg import Connection

from app.config import get_settings
from app.database import get_connection
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> HealthResponse:
    diagnostics = connection.execute(
        """
        SELECT current_database() AS database_name,
               pg_encoding_to_char(encoding) AS server_encoding,
               current_setting('client_encoding') AS client_encoding,
               current_setting('TimeZone') AS timezone,
               (
                   SELECT count(*)
                     FROM orbit_workflow.workflow_definition
                    WHERE is_active
               ) AS workflow_count,
               (SELECT count(*) FROM orbit_workflow.workflow_business_record) AS record_count
          FROM pg_database
         WHERE datname = current_database()
        """
    ).fetchone()
    return HealthResponse(
        status="ok",
        application=get_settings().application_name,
        is_production=get_settings().is_production,
        database=diagnostics["database_name"],
        server_encoding=diagnostics["server_encoding"],
        client_encoding=diagnostics["client_encoding"],
        timezone=diagnostics["timezone"],
        workflow_count=diagnostics["workflow_count"],
        record_count=diagnostics["record_count"],
    )
