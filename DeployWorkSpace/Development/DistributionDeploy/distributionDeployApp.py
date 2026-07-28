#!/usr/bin/env python3
"""Build the Orbit source-preserving distribution described by the JSON manifest."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent
ORBIT_ROOT = PACKAGE_ROOT.parents[2]
if str(ORBIT_ROOT) not in sys.path:
    sys.path.insert(0, str(ORBIT_ROOT))

from DeployWorkSpace.Development.DistributionDeploy.workthreads.DistributionDeployThread import (  # noqa: E402
    DistributionDeployThread,
)

PACKAGE_ROOT = Path(__file__).resolve().parent
ORBIT_ROOT = PACKAGE_ROOT.parents[2]
DEFAULT_MANIFEST = PACKAGE_ROOT / "Json" / "DistributionDeploy.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-j", "--json", type=Path, default=DEFAULT_MANIFEST)
    args = parser.parse_args()
    manifest_path = args.json.expanduser().resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    print(f"Manifest: {manifest_path}")
    print(f"Actions: {len(manifest['Actions'])}")
    return 0 if DistributionDeployThread(manifest_path).run() else 1


if __name__ == "__main__":
    raise SystemExit(main())
