"""Generic manifest command state used by non-build Orbit actions."""

from __future__ import annotations

import subprocess
import os

from .distributionDeploy_state import distributionDeploy_state


class executeShellCommand_state(distributionDeploy_state):
    def run(self) -> bool:
        command = self.action.get("actionData", {}).get("command")
        if not command:
            self.success = True
            return True
        environment = os.environ.copy()
        environment.update(self.thread.environment)
        result = subprocess.run(command, cwd=self.thread.orbit_root, shell=True, check=False, env=environment)
        self.success = result.returncode == 0
        return self.success
