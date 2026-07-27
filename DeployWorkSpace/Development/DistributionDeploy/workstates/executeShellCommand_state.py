"""Generic manifest command state used by non-build Orbit actions."""

from __future__ import annotations

import os
import subprocess

from .distributionDeploy_state import distributionDeploy_state


class executeShellCommand_state(distributionDeploy_state):
    def run(self) -> bool:
        command = self.action.get("actionData", {}).get("command")
        if not command:
            self.success = True
            return True
        environment = os.environ.copy()
        environment.update(self.thread.environment)
        if os.name == "nt":
            command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]
        result = subprocess.run(
            command,
            cwd=self.thread.working_directory(self.action_name),
            shell=os.name != "nt",
            check=False,
            env=environment,
        )
        self.success = result.returncode == 0
        return self.success
