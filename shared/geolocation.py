"""Canonical geolocation/site data shared by Orbit's Python services."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import TypedDict


class GeolocationSite(TypedDict):
    id: str
    value: str
    name: str
    name_zh: str
    label_key: str


class GeolocationCatalog(TypedDict):
    version: int
    default_site: str
    sites: list[GeolocationSite]
    legacy_aliases: dict[str, str]


CATALOG_PATH = Path(__file__).with_name("geolocation.json")


@lru_cache(maxsize=1)
def get_geolocation_catalog() -> GeolocationCatalog:
    """Load the persisted catalog once and return a fresh immutable-by-convention value."""

    with CATALOG_PATH.open("r", encoding="utf-8") as source:
        return json.load(source)


GEOLOCATION_CATALOG = get_geolocation_catalog()
GEOLOCATION_SITES = tuple(site["value"] for site in GEOLOCATION_CATALOG["sites"])
DEFAULT_SITE = GEOLOCATION_CATALOG["default_site"]
LEGACY_SITE_ALIASES = GEOLOCATION_CATALOG["legacy_aliases"]


def normalize_site(value: object) -> str:
    """Return a canonical site value, falling back to the configured default."""

    site = str(value or "").strip()
    canonical = LEGACY_SITE_ALIASES.get(site, site)
    return canonical if canonical in GEOLOCATION_SITES else DEFAULT_SITE
