#!/usr/bin/env python3
"""Import the generated workflow catalog into OrbitAutomation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import psycopg
from app.config import get_settings
from app.services.catalog_importer import import_catalog
from psycopg.rows import dict_row


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, help="Catalog JSON override")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    settings = get_settings()
    catalog_path = (args.catalog or settings.workflow_catalog).resolve()
    with catalog_path.open("r", encoding="utf-8") as source:
        catalog = json.load(source)

    with psycopg.connect(
        settings.database.conninfo,
        row_factory=dict_row,
        **settings.database.connect_kwargs,
    ) as connection:
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
    print(
        f"Imported {result['workflow_count']} workflows and "
        f"{result['record_count']} records from {catalog_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
