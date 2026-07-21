#!/usr/bin/env python3
"""Install or update the Orbit SLA worker in the current user's crontab."""

from __future__ import annotations

import subprocess
from pathlib import Path

MARKER = "# orbit-automation-sla-service"


def main() -> int:
    project_root = Path.cwd().resolve()
    python = project_root / ".venv/bin/python"
    worker = project_root / "scripts/orbit_service.py"
    config = project_root / "config/orbit_service.json"
    log_file = Path("/tmp/orbit_service.log")
    line = (
        f"* * * * * cd {project_root} && {python} {worker} --config {config} "
        f"2>&1 | /usr/bin/tee -a {log_file} {MARKER}"
    )

    try:
        current = subprocess.run(
            ["crontab", "-l"], capture_output=True, text=True, check=False
        )
    except FileNotFoundError as error:
        raise SystemExit("crontab is not installed on this host") from error

    existing = [row for row in current.stdout.splitlines() if MARKER not in row]
    existing.append(line)
    installed = subprocess.run(
        ["crontab", "-"], input="\n".join(existing) + "\n", text=True, check=False
    )
    if installed.returncode != 0:
        raise SystemExit(installed.returncode)
    print(f"Installed Orbit SLA cron entry for {project_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
