"""Shared utilities for Orbit AutomationPy work states."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from AutomationPy.buildingblocks.workflow.workstate import WorkState


class OrbitAutomationState(WorkState):
    def __init__(self, parent):
        super().__init__(parent)
        self.project_root: Path = parent.project_root
        self.action_name = type(self).__name__.removesuffix("_state")

    @property
    def action_config(self) -> dict:
        return self.ParentWorkThread.action_config(self.action_name)

    @property
    def action_data(self) -> dict:
        return self.action_config.get("actionData", {})

    def project_path(self, configured: str) -> Path:
        path = Path(configured).expanduser()
        return (
            path.resolve()
            if path.is_absolute()
            else (self.project_root / path).resolve()
        )

    def load_json(self, configured: str) -> dict:
        with self.project_path(configured).open("r", encoding="utf-8") as source:
            return json.load(source)

    def python_executable(self) -> str:
        candidate = self.project_root / ".venv" / "bin" / "python"
        return str(candidate) if candidate.is_file() else sys.executable

    def run_project_script(self, script: str, *arguments: str) -> None:
        command = [
            self.python_executable(),
            str(self.project_root / script),
            *arguments,
        ]
        completed = subprocess.run(
            command,
            cwd=self.project_root,
            check=False,
            text=True,
            capture_output=True,
            timeout=float(self.action_config.get("timeout", 120)),
        )
        if completed.stdout:
            print(completed.stdout.rstrip())
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or f"Command failed: {command}")
