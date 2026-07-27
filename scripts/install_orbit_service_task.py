"""Install or update the Orbit SLA worker as a Windows scheduled task."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    project_root = Path.cwd().resolve()
    python = project_root / ".venv" / "Scripts" / "python.exe"
    worker = project_root / "scripts" / "orbit_service.py"
    config = project_root / "config" / "orbit_service.json"
    task_name = "Orbit Automation SLA Service"
    command = f'"{python}" "{worker}" --config "{config}"'
    result = subprocess.run(
        ["schtasks.exe", "/Create", "/TN", task_name, "/SC", "MINUTE", "/MO", "1",
         "/TR", command, "/F"],
        check=False,
    )
    if result.returncode:
        raise SystemExit(result.returncode)
    print(f"Installed Orbit SLA scheduled task: {task_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
