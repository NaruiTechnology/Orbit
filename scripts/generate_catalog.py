#!/usr/bin/env python3
"""Generate Orbit's workflow catalog from the source requirements workbook."""

from __future__ import annotations

import argparse
from pathlib import Path

from app.services.workbook import build_catalog, workflow_counts, write_catalog

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path.home() / "Downloads" / "单束系统 初版.xlsx",
        help="Source XLSX requirements workbook.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "data" / "workflow_catalog.json",
        help="Destination catalog JSON.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    catalog = build_catalog(args.source.resolve())
    write_catalog(catalog, args.output.resolve())
    record_count = sum(count for _, count in workflow_counts(catalog))
    print(
        f"Generated {len(catalog['workflows'])} workflows and "
        f"{record_count} records at {args.output.resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
