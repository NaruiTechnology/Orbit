"""Orbit Automation FastAPI application."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.config import get_settings
from app.database import close_pool, open_pool


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    open_pool()
    try:
        yield
    finally:
        close_pool()


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title=settings.application_name,
        version="0.1.0",
        description=("UTF-8 workflow management API generated from the Orbit business workbook."),
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type", "X-Orbit-User"],
    )
    application.include_router(api_router)

    @application.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {
            "application": settings.application_name,
            "health": "/api/v1/health",
            "docs": "/docs",
        }

    return application


app = create_app()
