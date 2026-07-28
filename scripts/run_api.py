#!/usr/bin/env python3
"""Run Orbit FastAPI using the JSON-configured host and port."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import uvicorn

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))


def main() -> int:
    from app.config import get_settings

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=args.reload,
        reload_dirs=[str(PROJECT_ROOT / "backend")] if args.reload else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
