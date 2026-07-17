"""Verify server/client encoding, timezone, and imported catalog counts."""

from __future__ import annotations

from automation.workstates.orbitAutomation_state import OrbitAutomationState


class verifyDatabase_state(OrbitAutomationState):
    def DoWork(self):
        import psycopg
        from app.config import get_settings
        from psycopg.rows import dict_row

        settings = get_settings().database
        with psycopg.connect(
            settings.conninfo,
            row_factory=dict_row,
            **settings.connect_kwargs,
        ) as connection:
            row = connection.execute(
                """
                SELECT pg_encoding_to_char(encoding) AS server_encoding,
                       current_setting('client_encoding') AS client_encoding,
                       current_setting('TimeZone') AS timezone,
                       (SELECT count(*) FROM orbit_workflow.workflow_definition) AS workflows
                  FROM pg_database WHERE datname = current_database()
                """
            ).fetchone()
        expected_encoding = self.action_data.get("expectedEncoding", "UTF8")
        expected_timezone = self.action_data.get("expectedTimezone", "Asia/Shanghai")
        if row["server_encoding"] != expected_encoding:
            raise RuntimeError(f"Unexpected server encoding: {row['server_encoding']}")
        if row["client_encoding"] != expected_encoding:
            raise RuntimeError(f"Unexpected client encoding: {row['client_encoding']}")
        if row["timezone"] != expected_timezone:
            raise RuntimeError(f"Unexpected timezone: {row['timezone']}")
        self._success = True
        print(f"Database verified with {row['workflows']} workflow definitions")
