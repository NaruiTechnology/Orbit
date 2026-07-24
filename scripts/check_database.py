#!/usr/bin/env python3
"""Fail-fast PostgreSQL readiness check used before database bootstrap or API startup."""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import psycopg

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--timeout",
        type=float,
        default=60,
        help="Maximum seconds to wait for PostgreSQL (default: 60).",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=2,
        help="Seconds between connection attempts (default: 2).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    from app.config import get_settings

    database = get_settings().database
    connection_url = os.getenv("ORBIT_DATABASE_URL", database.conninfo).strip()
    parsed = urlsplit(connection_url) if "://" in connection_url else None
    endpoint_host = (
        parsed.hostname if parsed and parsed.hostname else os.getenv("ORBIT_DB_HOST", database.host)
    )
    endpoint_port = (
        parsed.port if parsed and parsed.port else int(os.getenv("ORBIT_DB_PORT", database.port))
    )
    endpoint_database = (
        parsed.path.lstrip("/")
        if parsed and parsed.path
        else os.getenv("ORBIT_DB_NAME", database.database_name)
    )
    endpoint = f"{endpoint_host}:{endpoint_port}/{endpoint_database}"
    deadline = time.monotonic() + args.timeout
    last_error: Exception | None = None

    while True:
        try:
            with psycopg.connect(
                database.conninfo,
                **database.connect_kwargs,
            ) as connection:
                diagnostics = connection.execute(
                    "SELECT current_database(), current_setting('client_encoding')"
                ).fetchone()
            print(
                f"Database preflight passed: {endpoint} "
                f"database={diagnostics[0]} encoding={diagnostics[1]}"
            )
            return 0
        except Exception as error:
            last_error = error
            # A fresh deployment has a running PostgreSQL server before the
            # application role/database exists. Confirm the server through
            # the bootstrap administrator so the next action can create them.
            admin_host = os.getenv("ORBIT_DB_ADMIN_HOST")
            if admin_host is None:
                admin_host = (
                    "/var/run/postgresql"
                    if not database.admin_password
                    and database.host in {"127.0.0.1", "localhost"}
                    else database.host
                )
            try:
                with psycopg.connect(
                    dbname=database.admin_database_name,
                    user=os.getenv("ORBIT_DB_ADMIN_USER", database.admin_user),
                    password=os.getenv(
                        "ORBIT_DB_ADMIN_PASSWORD", database.admin_password
                    ),
                    host=admin_host,
                    port=database.port,
                ) as connection:
                    admin_database = connection.execute(
                        "SELECT current_database()"
                    ).fetchone()[0]
                print(
                    f"Database server preflight passed: "
                    f"{endpoint_host}:{endpoint_port}/{admin_database}; "
                    f"{endpoint_database} will be prepared by bootstrap"
                )
                return 0
            except Exception as admin_error:
                last_error = admin_error
            if time.monotonic() >= deadline:
                break
            time.sleep(max(args.interval, 0))

    error_type = type(last_error).__name__ if last_error else "unknown error"
    print(
        f"Database preflight failed after {args.timeout:.0f}s: {endpoint} "
        f"({error_type}). Start PostgreSQL and verify ORBIT_DB_* settings.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
