#!/usr/bin/env python3
"""Entry point for the Orbit JSON-configured AutomationPy fiber."""

from __future__ import annotations

import argparse
import gc
import json
import os
import sys
from pathlib import Path

AUTOMATION_ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = AUTOMATION_ROOT / "Json" / "OrbitAutomation.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-j", "--json", dest="json_file", type=Path, default=DEFAULT_CONFIG
    )
    parser.add_argument(
        "--framework-root",
        type=Path,
        help="Directory containing the existing AutomationPy package.",
    )
    parser.add_argument(
        "--include-skipped",
        action="store_true",
        help="Execute states marked skip=true (intended for explicit bootstrap/launch runs).",
    )
    return parser.parse_args()


def _resolve_framework_root(
    config_path: Path, raw_config: dict[str, object], override: Path | None
) -> Path:
    if override is not None:
        return override.expanduser().resolve()
    environment_root = os.getenv("AUTOMATION_PY_ROOT")
    configured = environment_root or raw_config["Runtime"]["AutomationPyRoot"]
    path = Path(str(configured)).expanduser()
    return (
        path.resolve() if path.is_absolute() else (config_path.parent / path).resolve()
    )


def main() -> int:
    args = parse_args()
    config_path = args.json_file.expanduser().resolve()
    with config_path.open("r", encoding="utf-8") as source:
        raw_config = json.load(source)
    framework_root = _resolve_framework_root(
        config_path, raw_config, args.framework_root
    )
    if not (framework_root / "AutomationPy").is_dir():
        raise FileNotFoundError(
            f"AutomationPy package not found below {framework_root}"
        )

    sys.path.insert(0, str(framework_root))
    sys.path.insert(0, str(AUTOMATION_ROOT))

    from AutomationPy.buildingblocks.automation_config import AutomationConfig
    from workthreads.OrbitAutomationThread import OrbitAutomationThread

    # AutomationConfig accepts JSON text; reading it here keeps the source
    # encoding explicit while preserving the reference framework contract.
    config = AutomationConfig(json.dumps(raw_config, ensure_ascii=False))
    config._jsonFile = str(config_path)
    config.Runtime["FrameworkRoot"] = str(framework_root)
    config.Runtime["IncludeSkipped"] = args.include_skipped

    thread = OrbitAutomationThread(config)
    thread.Start()
    thread.join()
    gc.collect()
    return 0 if thread.succeeded else 1


if __name__ == "__main__":
    raise SystemExit(main())
