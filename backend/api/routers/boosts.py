"""Boosts API — read-only status of the X2 множитель.

Activation moved to services/boost_service.py; the ONLY activation path is a paid
Telegram Stars invoice (successful_payment handler, task 7.4). The former
POST /boosts/buy — which activated a boost without payment — has been removed.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/boosts", tags=["boosts"])


class ActiveBoostResponse(BaseModel):
    active: bool
    boost_type: str | None = None
    expires_at: str | None = None
    hours_left: float | None = None


@router.get("/active", response_model=ActiveBoostResponse)
async def get_active_boost(user: dict = Depends(get_current_user)):
    """Проверить активный буст для текущего игрока."""
    db = await get_supabase()

    user_res = (
        await db.table("users")
        .select("id")
        .eq("telegram_id", user["telegram_id"])
        .maybe_single()
        .execute()
    )
    if not user_res or not user_res.data:
        raise HTTPException(status_code=404, detail="User not found")
    user_id = user_res.data["id"]

    # Найти партнёрство где я — Player
    partnership_res = (
        await db.table("partnerships")
        .select("id")
        .eq("player_id", user_id)
        .eq("status", "active")
        .maybe_single()
        .execute()
    )

    if not partnership_res or not partnership_res.data:
        return ActiveBoostResponse(active=False)

    partnership_id = partnership_res.data["id"]
    now = datetime.now(timezone.utc).isoformat()

    # Найти активный буст (expires_at > now)
    boost_res = (
        await db.table("boosts")
        .select("*")
        .eq("partnership_id", partnership_id)
        .gt("expires_at", now)
        .order("expires_at", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )

    if not boost_res or not boost_res.data:
        return ActiveBoostResponse(active=False)

    b = boost_res.data
    expires = datetime.fromisoformat(b["expires_at"])
    hours_left = (expires - datetime.now(timezone.utc)).total_seconds() / 3600

    return ActiveBoostResponse(
        active=True,
        boost_type=b["boost_type"],
        expires_at=b["expires_at"],
        hours_left=round(hours_left, 1),
    )
