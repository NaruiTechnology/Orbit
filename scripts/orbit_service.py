#!/usr/bin/env python3
"""Run one configured Orbit SLA cycle; intended to be invoked by cron."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="config/orbit_service.json")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Run immediately even when the configured interval has not elapsed.",
    )
    args = parser.parse_args()
    settings = _read_config(PROJECT_ROOT / args.config)
    lock_path = Path(settings.get("lock_file", "/tmp/orbit_service.lock"))
    last_run_path = Path(settings.get("last_run_file", "/tmp/orbit_service.last-run"))
    interval_minutes = max(1, int(settings.get("interval_minutes", 60)))
    run_on_start = bool(settings.get("run_on_start", True))
    print(
        f"[orbit_service] starting; config={PROJECT_ROOT / args.config}; "
        f"interval_minutes={interval_minutes}",
        flush=True,
    )
    if not args.force and not last_run_path.exists() and not run_on_start:
        print("[orbit_service] not due: run_on_start is disabled", flush=True)
        return 0
    if not args.force and _too_soon(last_run_path, interval_minutes):
        print("[orbit_service] not due: configured interval has not elapsed", flush=True)
        return 0
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        print("[orbit_service] not started: another instance holds the lock", flush=True)
        return 0
    try:
        os.write(fd, f"{os.getpid()}\n".encode())
        os.close(fd)
        print(f"[orbit_service] started successfully; pid={os.getpid()}", flush=True)
        from app.config import get_settings
        from app.services.workflow_sla_service import run_sla_cycle

        app_settings = get_settings()
        with psycopg.connect(
            app_settings.database.conninfo,
            row_factory=dict_row,
            **app_settings.database.connect_kwargs,
        ) as connection:
            result = run_sla_cycle(
                connection,
                str(settings.get("access_url_base", "http://127.0.0.1:5274")),
                locale=str(settings.get("locale", app_settings.default_locale)),
            )
            connection.commit()
        last_run_path.write_text(str(time.time()), encoding="utf-8")
        print(json.dumps(result, default=str, ensure_ascii=False))
        print(
            f"[orbit_service] completed successfully; checked={result['checked']}; "
            f"violations={result['violations']}; emails_sent={result['emails_sent']}",
            flush=True,
        )
        return 0 if not result["email_errors"] else 1
    except Exception as error:
        print(f"[orbit_service] failed: {error}", file=sys.stderr, flush=True)
        return 1
    finally:
        lock_path.unlink(missing_ok=True)
        print(f"[orbit_service] stopped; pid={os.getpid()}", flush=True)


def _read_config(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def _too_soon(path: Path, interval_minutes: int) -> bool:
    if not path.exists():
        return False
    try:
        import time

        return time.time() - float(path.read_text(encoding="utf-8")) < interval_minutes * 60
    except (OSError, ValueError):
        return False


if __name__ == "__main__":
    raise SystemExit(main())
