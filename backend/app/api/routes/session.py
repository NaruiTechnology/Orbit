"""Current scoped-user session endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.schemas import SessionInfo

router = APIRouter(prefix="/session", tags=["session"])


@router.get("", response_model=SessionInfo)
def session(user: SessionInfo = Depends(get_current_user)) -> SessionInfo:
    return user
