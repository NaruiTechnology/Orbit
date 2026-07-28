"""Read-only geolocation catalog endpoint."""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas import GeolocationCatalog
from app.services.geolocation import GEOLOCATION_CATALOG

router = APIRouter(prefix="/geolocation", tags=["geolocation"])


@router.get("", response_model=GeolocationCatalog)
def geolocation() -> GeolocationCatalog:
    """Return the shared site catalog used by services and clients."""

    return GeolocationCatalog.model_validate(GEOLOCATION_CATALOG)
