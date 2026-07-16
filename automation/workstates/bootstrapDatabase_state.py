"""Run the privileged-capable PostgreSQL bootstrap script."""

from __future__ import annotations

from workstates.orbitAutomation_state import OrbitAutomationState


class bootstrapDatabase_state(OrbitAutomationState):
    def DoWork(self):
        arguments: list[str] = []
        admin_host = self.action_data.get("adminHost")
        if admin_host:
            arguments.extend(["--admin-host", str(admin_host)])
        self.run_project_script("scripts/bootstrap_database.py", *arguments)
        self._success = True
