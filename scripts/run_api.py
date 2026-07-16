#!/usr/bin/env python3
"""Run Orbit FastAPI using the JSON-configured host and port."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

import uvicorn  # noqa: E402

from app.config import get_settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        app_dir=str(PROJECT_ROOT / "backend"),
        host=settings.api_host,
        port=settings.api_port,
        reload=args.reload,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
