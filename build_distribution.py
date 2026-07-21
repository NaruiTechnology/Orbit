#!/usr/bin/env python3
"""Build Orbit's raw-source dist_app.zip and timestamped DeployWorkSpace archive."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEPLOY_PACKAGE = ROOT / "DeployWorkSpace" / "Development" / "DistributionDeploy"
DIST_DIR = DEPLOY_PACKAGE / "dist_app"
DIST_ZIP = DEPLOY_PACKAGE / "dist_app.zip"

REQUIRED_DEPLOYMENT_FILES = {
    "scripts/start_local_postgres.sh",
    "scripts/bootstrap_database.py",
    "scripts/check_database.py",
    "scripts/run_api.py",
    "scripts/orbit_service.py",
    "scripts/install_orbit_service_cron.py",
    "config/orbit_service.json",
    "database/006_sla_orbit_service.sql",
    "scripts/orbit_service.cron.example",
    "DeployWorkSpace/Development/DistributionDeploy/Json/DistributionDeploy.json",
    "DeployWorkSpace/Development/DistributionDeploy/workstates/verifyDatabase_state.py",
}


def ignored(relative: Path) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "--quiet", "--", relative.as_posix()],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    return result.returncode == 0


def source_files() -> list[Path]:
    result: list[Path] = []
    output_paths = {DIST_DIR.resolve(), DIST_ZIP.resolve()}
    for current, directories, names in os.walk(ROOT):
        current_path = Path(current)
        kept: list[str] = []
        for name in directories:
            directory = current_path / name
            relative = directory.relative_to(ROOT)
            if name == ".git" or directory.resolve() in output_paths:
                continue
            if ignored(Path(f"{relative.as_posix()}/")):
                continue
            kept.append(name)
        directories[:] = kept
        for name in names:
            path = current_path / name
            relative = path.relative_to(ROOT)
            if path.resolve() in output_paths or ignored(relative):
                continue
            # Existing archives are generated artifacts, never source inputs.
            if path.suffix.lower() == ".zip":
                continue
            result.append(relative)
    return sorted(result)


def copy_source_tree() -> list[Path]:
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True)
    files = source_files()
    for relative in files:
        destination = DIST_DIR / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, destination)
    return files


def zip_directory(source: Path, archive: Path, *, top_level: str | None = None) -> None:
    if archive.exists():
        archive.unlink()
    archive.parent.mkdir(parents=True, exist_ok=True)
    base = top_level or ""
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                relative = path.relative_to(source).as_posix()
                bundle.write(path, f"{base}/{relative}" if base else relative)


def version_label() -> str:
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r"^version\s*=\s*['\"]([^'\"]+)", text, re.MULTILINE)
    version = match.group(1) if match else "0.0.0"
    return f"v{version}"


def build() -> tuple[Path, Path, int]:
    files = copy_source_tree()
    missing = sorted(REQUIRED_DEPLOYMENT_FILES - {path.as_posix() for path in files})
    if missing:
        shutil.rmtree(DIST_DIR)
        raise RuntimeError(
            "Distribution is missing required deployment files: " + ", ".join(missing)
        )
    zip_directory(DIST_DIR, DIST_ZIP)
    shutil.rmtree(DIST_DIR)

    stamp = datetime.now().strftime("%m%d%y_%H%M")
    workspace_archive = ROOT / f"DeployWorkspace_{version_label()}_{stamp}.zip"
    zip_directory(ROOT / "DeployWorkSpace", workspace_archive, top_level="DeployWorkSpace")
    print(
        f"Built {len(files)} source files; Python source preserved; "
        "no byte compilation performed."
    )
    print(f"Embedded distribution: {DIST_ZIP}")
    print(f"Timestamped handoff:   {workspace_archive}")
    return DIST_ZIP, workspace_archive, len(files)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path, help="Compatibility option; must resolve to the Orbit root"
    )
    args = parser.parse_args()
    if args.source and args.source.expanduser().resolve() != ROOT:
        raise SystemExit(f"--source must be {ROOT}")
    build()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
