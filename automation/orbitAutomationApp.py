#!/usr/bin/env python3
"""Entry point for the Orbit JSON-configured AutomationPy fiber."""

from __future__ import annotations

import argparse
import gc
import json
from pathlib import Path

from automation.workthreads.OrbitAutomationThread import OrbitAutomationThread
from AutomationPy.buildingblocks.automation_config import AutomationConfig

AUTOMATION_ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = AUTOMATION_ROOT / "Json" / "OrbitAutomation.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-j", "--json", dest="json_file", type=Path, default=DEFAULT_CONFIG
    )
    parser.add_argument(
        "--include-skipped",
        action="store_true",
        help="Execute states marked skip=true (intended for explicit bootstrap/launch runs).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config_path = args.json_file.expanduser().resolve()
    with config_path.open("r", encoding="utf-8") as source:
        raw_config = json.load(source)

    # AutomationConfig accepts JSON text; reading it here keeps the source
    # encoding explicit while preserving the reference framework contract.
    config = AutomationConfig(json.dumps(raw_config, ensure_ascii=False))
    config._jsonFile = str(config_path)
    config.Runtime["IncludeSkipped"] = args.include_skipped

    thread = OrbitAutomationThread(config)
    thread.Start()
    thread.join()
    gc.collect()
    return 0 if thread.succeeded else 1


if __name__ == "__main__":
    raise SystemExit(main())
