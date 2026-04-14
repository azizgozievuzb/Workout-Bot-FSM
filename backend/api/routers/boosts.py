"""Boosts API — X2 множитель от Responsible."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/boosts", tags=["boosts"])


class BuyBoostRequest(BaseModel):
    player_id: str
    boost_type: str  # "1_day" | "1_week"


class BuyBoostResponse(BaseModel):
    success: bool
    expires_at: str
    message: str


class ActiveBoostResponse(BaseModel):
    active: bool
    boost_type: str | None = None
    expires_at: str | None = None
    hours_left: float | None = None


BOOST_DURATIONS = {
    "1_day": timedelta(days=1),
    "1_week": timedelta(weeks=1),
}


@router.post("/buy", response_model=BuyBoostResponse)
async def buy_boost(
    body: BuyBoostRequest,
    user: dict = Depends(get_current_user),
):
    """Responsible покупает буст для своего игрока."""
    db = await get_supabase()

    if body.boost_type not in BOOST_DURATIONS:
        raise HTTPException(status_code=400, detail="Invalid boost_type")

    # Получить user_id ответственного
    user_res = (
        await db.table("users")
        .select("id")
        .eq("telegram_id", user["telegram_id"])
        .maybe_single()
        .execute()
    )
    if not user_res or not user_res.data:
        raise HTTPException(status_code=404, detail="User not found")
    responsible_id = user_res.data["id"]

    # Проверить партнёрство
    partnership_res = (
        await db.table("partnerships")
        .select("id")
        .eq("responsible_id", responsible_id)
        .eq("player_id", body.player_id)
        .eq("status", "active")
        .maybe_single()
        .execute()
    )

    if not partnership_res or not partnership_res.data:
        raise HTTPException(status_code=403, detail="Partnership not found")

    partnership_id = partnership_res.data["id"]

    now = datetime.now(timezone.utc)
    expires = now + BOOST_DURATIONS[body.boost_type]

    await (
        db.table("boosts")
        .insert({
            "partnership_id": partnership_id,
            "boost_type": body.boost_type,
            "activated_at": now.isoformat(),
            "expires_at": expires.isoformat(),
        })
        .execute()
    )

    return BuyBoostResponse(
        success=True,
        expires_at=expires.isoformat(),
        message=f"Буст X2 активирован на {'24 часа' if body.boost_type == '1_day' else '7 дней'}",
    )


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
