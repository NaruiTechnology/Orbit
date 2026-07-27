"""Launch a long-running service without blocking later manifest actions."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .distributionDeploy_state import distributionDeploy_state


class detachedShellLaunch_state(distributionDeploy_state):
    def run(self) -> bool:
        data = self.action.get("actionData", {})
        command = data.get("command")
        if not command:
            self.success = True
            return True
        default_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "OrbitAutomation" if os.name == "nt" else Path("/tmp")
        log_path = Path(data.get("log", default_dir / f"orbit-{self.action_name}.log")).expanduser()
        pid_path = Path(data.get("pid", default_dir / f"orbit-{self.action_name}.pid")).expanduser()
        if not log_path.is_absolute():
            log_path = self.thread.deploy_root / log_path
        if not pid_path.is_absolute():
            pid_path = self.thread.deploy_root / pid_path
        log_path.parent.mkdir(parents=True, exist_ok=True)
        environment = os.environ.copy()
        environment.update(self.thread.environment)
        handle = log_path.open("ab")
        launch = command
        creationflags = 0
        if os.name == "nt":
            launch = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        process = subprocess.Popen(
            launch, cwd=self.thread.deploy_root, shell=os.name != "nt", env=environment,
            stdout=handle, stderr=subprocess.STDOUT, start_new_session=os.name != "nt",
            creationflags=creationflags,
        )
        pid_path.write_text(str(process.pid), encoding="utf-8")
        handle.close()
        self.success = True
        return True
