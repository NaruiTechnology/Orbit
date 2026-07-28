"""Launch FastAPI as a detached process when explicitly enabled."""

from __future__ import annotations

import subprocess

from automation.workstates.orbitAutomation_state import OrbitAutomationState


class launchApi_state(OrbitAutomationState):
    def DoWork(self):
        runtime = self.ParentWorkThread._config.Runtime
        command = [
            self.python_executable(),
            "-m",
            "uvicorn",
            runtime.get("ApiModule", "app.main:app"),
            "--host",
            str(runtime.get("ApiHost", "127.0.0.1")),
            "--port",
            str(runtime.get("ApiPort", 8120)),
        ]
        if self.action_data.get("reload", False):
            command.append("--reload")
        log_path = self.project_path(runtime.get("ApiLog", "/tmp/orbit-api.log"))
        pid_path = self.project_path(runtime.get("ApiPid", "/tmp/orbit-api.pid"))
        with log_path.open("a", encoding="utf-8") as output:
            process = subprocess.Popen(
                command,
                cwd=self.project_root,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        pid_path.write_text(f"{process.pid}\n", encoding="ascii")
        self._success = True
        print(f"Orbit API launched with PID {process.pid}")
