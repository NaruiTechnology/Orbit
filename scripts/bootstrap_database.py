#!/usr/bin/env python3
"""Create the local UTF-8 database, schemas, seed identity, and catalog."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--admin-host",
        default=os.getenv("ORBIT_DB_ADMIN_HOST"),
        help="PostgreSQL admin host or local socket directory.",
    )
    parser.add_argument(
        "--skip-catalog",
        action="store_true",
        help="Create schemas and seed identity without importing workbook data.",
    )
    return parser.parse_args()


def _admin_connection(args: argparse.Namespace) -> psycopg.Connection:
    from app.config import get_settings

    database = get_settings().database
    host = args.admin_host
    if host is None:
        host = (
            "/var/run/postgresql"
            if not database.admin_password
            and database.host in {"127.0.0.1", "localhost"}
            else database.host
        )
    return psycopg.connect(
        dbname=database.admin_database_name,
        user=os.getenv("ORBIT_DB_ADMIN_USER", database.admin_user),
        password=os.getenv("ORBIT_DB_ADMIN_PASSWORD", database.admin_password),
        host=host,
        port=database.port,
        autocommit=True,
        row_factory=dict_row,
    )


def _ensure_role_and_database(args: argparse.Namespace) -> None:
    from app.config import get_settings

    database = get_settings().database
    with _admin_connection(args) as connection:
        role_exists = connection.execute(
            "SELECT 1 FROM pg_roles WHERE rolname = %s", (database.user,)
        ).fetchone()
        if role_exists:
            connection.execute(
                sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(
                    sql.Identifier(database.user), sql.Literal(database.password)
                )
            )
        else:
            connection.execute(
                sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD {}").format(
                    sql.Identifier(database.user), sql.Literal(database.password)
                )
            )

        database_row = connection.execute(
            "SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = %s",
            (database.database_name,),
        ).fetchone()
        if database_row is None:
            statement = sql.SQL(
                "CREATE DATABASE {} WITH OWNER {} ENCODING 'UTF8' "
                "LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0"
            ).format(
                sql.Identifier(database.database_name),
                sql.Identifier(database.user),
            )
            try:
                connection.execute(statement)
            except (
                psycopg.errors.FeatureNotSupported,
                psycopg.errors.InvalidParameterValue,
            ):
                fallback = sql.SQL(
                    "CREATE DATABASE {} WITH OWNER {} ENCODING 'UTF8' "
                    "LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0"
                ).format(
                    sql.Identifier(database.database_name),
                    sql.Identifier(database.user),
                )
                connection.execute(fallback)
        elif database_row["encoding"] != "UTF8":
            raise RuntimeError(
                f"Database {database.database_name!r} uses {database_row['encoding']}, not UTF8"
            )


def _apply_schema_and_seed(skip_catalog: bool) -> dict[str, int] | None:
    from app.config import get_settings
    from app.services.catalog_importer import import_catalog

    settings = get_settings()
    database = settings.database
    with psycopg.connect(
        database.conninfo,
        row_factory=dict_row,
        **database.connect_kwargs,
    ) as connection:
        connection.execute(
            sql.SQL("ALTER DATABASE {} SET timezone TO {}").format(
                sql.Identifier(database.database_name),
                sql.Literal(database.timezone),
            )
        )
        connection.execute(
            sql.SQL("ALTER DATABASE {} SET client_encoding TO {}").format(
                sql.Identifier(database.database_name),
                sql.Literal(database.client_encoding),
            )
        )
        for script_name in (
            "001_schema.sql",
            "002_seed_identity.sql",
            "004_workflow_node_runtime.sql",
            "005_workflow_runtime_functions.sql",
        ):
            script_path = PROJECT_ROOT / "database" / script_name
            connection.execute(script_path.read_text(encoding="utf-8"))

        result = None
        if not skip_catalog:
            with settings.workflow_catalog.open("r", encoding="utf-8") as source:
                catalog = json.load(source)
            actor = connection.execute(
                "SELECT id FROM orbit_identity.app_user WHERE login_name = %s",
                (settings.default_user_login,),
            ).fetchone()
            result = import_catalog(
                connection,
                catalog,
                str(actor["id"]) if actor else None,
            )
        connection.commit()

        diagnostics = connection.execute(
            """
            SELECT current_database() AS database_name,
                   pg_encoding_to_char(encoding) AS server_encoding,
                   current_setting('client_encoding') AS client_encoding,
                   current_setting('TimeZone') AS timezone
              FROM pg_database
             WHERE datname = current_database()
            """
        ).fetchone()
        print(
            "Database ready: "
            f"{diagnostics['database_name']} "
            f"server={diagnostics['server_encoding']} "
            f"client={diagnostics['client_encoding']} "
            f"timezone={diagnostics['timezone']}"
        )
        return result


def main() -> int:
    args = parse_args()
    _ensure_role_and_database(args)
    result = _apply_schema_and_seed(args.skip_catalog)
    if result:
        print(
            f"Catalog ready: {result['workflow_count']} workflows, {result['record_count']} records"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
