"""Validate UTF-8 JSON configuration and catalog inputs."""

from __future__ import annotations

from automation.workstates.orbitAutomation_state import OrbitAutomationState


class validateConfiguration_state(OrbitAutomationState):
    def DoWork(self):
        runtime = self.ParentWorkThread._config.Runtime
        for key in ("ApplicationConfig", "DatabaseConfig", "WorkflowCatalog"):
            path = self.project_path(runtime[key])
            if not path.is_file():
                raise FileNotFoundError(f"{key} not found: {path}")
            self.load_json(runtime[key])
        self._success = True
        print("Orbit UTF-8 configuration and workflow catalog are valid")
