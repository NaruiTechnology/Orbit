#!/usr/bin/env python3
"""Run Orbit FastAPI using the JSON-configured host and port."""

from __future__ import annotations

import argparse
from pathlib import Path

import uvicorn
from app.config import get_settings

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
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
