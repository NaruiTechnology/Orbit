#!/usr/bin/env python3
"""Run one durable batch of system-owned workflow tasks."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.services.workflow_task_runner import process_system_tasks  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()
    settings = get_settings()
    with psycopg.connect(
        settings.database.conninfo,
        row_factory=dict_row,
        **settings.database.connect_kwargs,
    ) as connection:
        result = process_system_tasks(connection, max(1, min(args.limit, 100)))
        connection.commit()
    print(result)
    return 0 if result["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
