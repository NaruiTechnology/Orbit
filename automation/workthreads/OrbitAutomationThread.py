"""AutomationPy work-thread implementation for Orbit operations."""

from __future__ import annotations

import queue
from pathlib import Path

from automation.workstates.bootstrapDatabase_state import bootstrapDatabase_state
from automation.workstates.importWorkflowCatalog_state import importWorkflowCatalog_state
from automation.workstates.launchApi_state import launchApi_state
from automation.workstates.processWorkflowTasks_state import processWorkflowTasks_state
from automation.workstates.validateConfiguration_state import validateConfiguration_state
from automation.workstates.verifyDatabase_state import verifyDatabase_state
from AutomationPy.buildingblocks.decorators import overrides
from AutomationPy.buildingblocks.workflow.work_thread import WorkThread

STATE_TYPES = {
    "validateConfiguration": validateConfiguration_state,
    "bootstrapDatabase": bootstrapDatabase_state,
    "verifyDatabase": verifyDatabase_state,
    "importWorkflowCatalog": importWorkflowCatalog_state,
    "launchApi": launchApi_state,
    "processWorkflowTasks": processWorkflowTasks_state,
}


class OrbitAutomationThread(WorkThread):
    """Queue configured operational states and stop on the first failure."""

    def __init__(self, config):
        super().__init__()
        self._config = config
        self._queue: queue.Queue = queue.Queue()
        self._succeeded = True
        config_path = Path(config._jsonFile).resolve()
        configured_root = Path(config.Runtime.get("ProjectRoot", "../.."))
        self.project_root = (
            configured_root.resolve()
            if configured_root.is_absolute()
            else (config_path.parent / configured_root).resolve()
        )

    @property
    def succeeded(self) -> bool:
        return self._succeeded

    def action_config(self, action_name: str) -> dict:
        for action in self._config.Actions:
            if action_name in action:
                return action[action_name]
        raise KeyError(f"Action '{action_name}' is not configured")

    @overrides(WorkThread)
    def IntialWork(self):
        include_skipped = bool(self._config.Runtime.get("IncludeSkipped", False))
        for action in self._config.Actions:
            action_name, action_config = next(iter(action.items()))
            if action_config.get("transactionComplete", False):
                continue
            if action_config.get("skip", False) and not include_skipped:
                print(f"[skip=true] {action_name}")
                continue
            state_type = STATE_TYPES.get(action_name)
            if state_type is None:
                raise ValueError(f"No work-state registered for '{action_name}'")
            self._queue.put(state_type(self))
        return self._queue.get_nowait() if not self._queue.empty() else None

    @overrides(WorkThread)
    def StateFactory(self, work_state=None):
        if work_state is None:
            return self.IntialWork()
        if not work_state._success:
            self._succeeded = False
            print(f"State {type(work_state).__name__} failed; aborting Orbit fiber")
            return None
        action_name = type(work_state).__name__.removesuffix("_state")
        self.action_config(action_name)["transactionComplete"] = True
        return self._queue.get_nowait() if not self._queue.empty() else None
