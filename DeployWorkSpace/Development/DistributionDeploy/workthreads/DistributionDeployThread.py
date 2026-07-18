"""JSON manifest work-thread matching the foreign DistributionDeploy shape."""

from __future__ import annotations

import importlib
import json
from pathlib import Path


class DistributionDeployThread:
    def __init__(self, manifest: Path):
        self.manifest_path = manifest.resolve()
        self.orbit_root = self.manifest_path.parents[4]
        self.config = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.environment: dict[str, str] = {}

    def run(self) -> bool:
        for action_node in self.config.get("Actions", []):
            action_name, action = next(iter(action_node.items()))
            if action.get("skip", False):
                continue
            state = self._state(action_name, action)
            if not state.run():
                return False
        return True

    def _state(self, name: str, action: dict):
        module = importlib.import_module(
            f"DeployWorkSpace.Development.DistributionDeploy.workstates.{name}_state"
        )
        state_type = getattr(module, f"{name}_state", None)
        if state_type is None:
            module = importlib.import_module(
                "DeployWorkSpace.Development.DistributionDeploy.workstates.executeShellCommand_state"
            )
            state_type = module.executeShellCommand_state
        return state_type(self, name, action)
