"""Import the generated workbook catalog through the shared service."""

from __future__ import annotations

from automation.workstates.orbitAutomation_state import OrbitAutomationState


class importWorkflowCatalog_state(OrbitAutomationState):
    def DoWork(self):
        self.run_project_script("scripts/import_catalog.py")
        self._success = True
