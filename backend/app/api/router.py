"""Top-level versioned API router."""

from fastapi import APIRouter

from app.api.routes import health, session, workflows

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(session.router)
api_router.include_router(workflows.router)
