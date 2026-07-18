#!/usr/bin/env python3
"""Compatibility entry point matching the Iobeam distribution package."""

from __future__ import annotations

import runpy
from pathlib import Path


if __name__ == "__main__":
    runpy.run_path(
        str(Path(__file__).resolve().parents[2] / "build_distribution.py"),
        run_name="__main__",
    )
