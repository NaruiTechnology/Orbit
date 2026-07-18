#!/usr/bin/env python3
"""Insert repeatable development-only business fixture data."""

from __future__ import annotations

from pathlib import Path

import psycopg

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    from app.config import get_settings

    settings = get_settings()
    seed_path = PROJECT_ROOT / "database" / "003_seed_mock_business.sql"
    with psycopg.connect(
        settings.database.conninfo,
        **settings.database.connect_kwargs,
    ) as connection:
        connection.execute(seed_path.read_text(encoding="utf-8"))
        connection.commit()
    print("Development mock business data seeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
