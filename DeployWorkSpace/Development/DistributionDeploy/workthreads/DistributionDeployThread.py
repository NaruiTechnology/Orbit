"""JSON manifest work-thread matching the foreign DistributionDeploy shape."""

from __future__ import annotations

import importlib
import json
import os
from pathlib import Path


class DistributionDeployThread:
    def __init__(self, manifest: Path):
        self.manifest_path = manifest.resolve()
        # DistributionDeploy/Json/manifest is five path components below the
        # extracted Orbit root (Json, DistributionDeploy, Development,
        # DeployWorkSpace, Orbit root).
        self.source_root = self.manifest_path.parents[4]
        self.config = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        deploy_root = self.config.get("Deployment", {}).get("DeployRoot", "~/OrbitAutomation")
        self.deploy_root = Path(os.path.expanduser(deploy_root)).resolve()
        self.environment: dict[str, str] = {}

    def working_directory(self, action_name: str) -> Path:
        # The archive is read from the extracted handoff package, while all
        # application commands must run from the deployed source tree.
        if action_name in {"createDeployFolder", "unzipDistribution"}:
            return self.source_root
        return self.deploy_root

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
        module_name = (
            f"DeployWorkSpace.Development.DistributionDeploy.workstates.{name}_state"
        )
        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError as error:
            # Command-only actions intentionally use the generic state and do
            # not need a one-file-per-action wrapper. Do not hide missing
            # imports raised from inside a real state module.
            if error.name != module_name:
                raise
            module = importlib.import_module(
                "DeployWorkSpace.Development.DistributionDeploy.workstates.executeShellCommand_state"
            )
        state_type = getattr(module, f"{name}_state", None)
        if state_type is None:
            module = importlib.import_module(
                "DeployWorkSpace.Development.DistributionDeploy.workstates.executeShellCommand_state"
            )
            state_type = module.executeShellCommand_state
        return state_type(self, name, action)
