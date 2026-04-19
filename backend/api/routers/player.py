"""Player-specific endpoints (rest-day, etc.)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...core.deps import get_current_user
from ...db.client import get_supabase

router = APIRouter(prefix="/player", tags=["player"])


class UseRestDayResp(BaseModel):
    rest_days_remaining: int
    last_rest_day_date: str  # ISO date


@router.post("/use-rest-day", response_model=UseRestDayResp)
async def use_rest_day(user: dict = Depends(get_current_user)) -> UseRestDayResp:
    db = await get_supabase()
    tg_id = user["telegram_id"]
    today = date.today().isoformat()

    # 1. Resolve player row + gender
    u = await (
        db.table("users")
        .select("id, role, gender")
        .eq("telegram_id", tg_id)
        .maybe_single()
        .execute()
    )
    if not u or not u.data:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})
    if u.data.get("role") != "player":
        raise HTTPException(status_code=403, detail={"code": "NOT_PLAYER"})
    if u.data.get("gender") != "female":
        raise HTTPException(
            status_code=422,
            detail={"code": "NOT_ELIGIBLE", "message": "Rest-day доступен только женщинам"},
        )
    me_id = u.data["id"]

    # 2. Read player_stats
    ps = await (
        db.table("player_stats")
        .select("rest_days_remaining,last_rest_day_date,rest_days_used_this_month")
        .eq("player_id", me_id)
        .maybe_single()
        .execute()
    )
    if not ps or not ps.data:
        raise HTTPException(status_code=404, detail={"code": "STATS_NOT_FOUND"})
    cur_remaining = int(ps.data.get("rest_days_remaining") or 0)
    cur_used_month = int(ps.data.get("rest_days_used_this_month") or 0)
    last_date = ps.data.get("last_rest_day_date")

    if cur_remaining <= 0:
        raise HTTPException(status_code=422, detail={"code": "NO_REST_DAYS_LEFT"})
    if last_date == today:
        raise HTTPException(status_code=409, detail={"code": "ALREADY_USED_TODAY"})

    # 3. Atomic UPDATE with optimistic lock
    upd = await (
        db.table("player_stats")
        .update({
            "rest_days_remaining": cur_remaining - 1,
            "last_rest_day_date": today,
            "rest_days_used_this_month": cur_used_month + 1,
        })
        .eq("player_id", me_id)
        .eq("rest_days_remaining", cur_remaining)
        .execute()
    )
    if not upd.data:
        raise HTTPException(status_code=409, detail={"code": "RACE"})

    return UseRestDayResp(
        rest_days_remaining=cur_remaining - 1,
        last_rest_day_date=today,
    )
