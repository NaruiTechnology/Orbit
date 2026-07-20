"""Top-level versioned API router."""

from fastapi import APIRouter

from app.api.routes import auth, geolocation, health, mail, session, workflows

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(session.router)
api_router.include_router(workflows.router)
api_router.include_router(mail.router)
api_router.include_router(geolocation.router)
