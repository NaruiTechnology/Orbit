"""Process one durable batch of system-owned workflow tasks."""

from __future__ import annotations

from workstates.orbitAutomation_state import OrbitAutomationState


class processWorkflowTasks_state(OrbitAutomationState):
    def DoWork(self):
        limit = str(self.action_data.get("limit", 20))
        self.run_project_script("scripts/process_workflow_tasks.py", "--limit", limit)
        self._success = True
