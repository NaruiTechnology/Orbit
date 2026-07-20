"""Service accessors for Orbit's shared geolocation catalog."""

from __future__ import annotations

from shared.geolocation import (
    DEFAULT_SITE,
    GEOLOCATION_CATALOG,
    GEOLOCATION_SITES,
    LEGACY_SITE_ALIASES,
    normalize_site,
)

__all__ = [
    "DEFAULT_SITE",
    "GEOLOCATION_CATALOG",
    "GEOLOCATION_SITES",
    "LEGACY_SITE_ALIASES",
    "normalize_site",
]
